import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Boots an embedded Postgres, recreates the parts of Supabase the migrations
 * rely on (the anon / authenticated / service_role roles, auth.users,
 * auth.sessions, auth.uid() and auth.jwt()), copies Supabase's default
 * grants, then applies the real migrations from supabase/migrations.
 *
 * Supabase grants ALL on public tables to anon and authenticated by default,
 * so these tests prove that row-level security, not missing grants, is what
 * keeps data private.
 */
const SUPABASE_SHIM = `
  create role anon nologin noinherit;
  create role authenticated nologin noinherit;
  create role service_role nologin noinherit bypassrls;

  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    raw_user_meta_data jsonb not null default '{}',
    raw_app_meta_data jsonb not null default '{}',
    invited_at timestamptz,
    created_at timestamptz not null default now()
  );
  create table auth.sessions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    created_at timestamptz not null default now()
  );
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claim', true), ''),
                    nullif(current_setting('request.jwt.claims', true), ''))::jsonb
  $$;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid
  $$;
  create function auth.role() returns text language sql stable as $$
    select auth.jwt() ->> 'role'
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

export type Aal = "aal1" | "aal2";

export class TestDb {
  private constructor(readonly pg: PGlite) {}

  static async create(): Promise<TestDb> {
    const pg = new PGlite();
    await pg.exec(SUPABASE_SHIM);
    const dir = path.resolve(import.meta.dirname, "../../supabase/migrations");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      try {
        await pg.exec(readFileSync(path.join(dir, file), "utf8"));
      } catch (err) {
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }
    return new TestDb(pg);
  }

  /** Create an auth user the way Supabase would (fires the profile trigger). */
  async createUser(
    email: string,
    opts: { invited?: boolean; provisioned?: boolean; fullName?: string } = {}
  ): Promise<string> {
    const res = await this.pg.query<{ id: string }>(
      `insert into auth.users (email, raw_user_meta_data, raw_app_meta_data, invited_at)
       values ($1, $2, $3, $4) returning id`,
      [
        email,
        JSON.stringify({ full_name: opts.fullName ?? "" }),
        JSON.stringify(opts.provisioned ? { provisioned: true } : {}),
        opts.invited ? new Date().toISOString() : null,
      ]
    );
    return res.rows[0].id;
  }

  /** Run fn as a signed-in user, exactly as PostgREST would. */
  async as<T>(userId: string, aal: Aal, fn: () => Promise<T>): Promise<T> {
    return this.withRole("authenticated", { sub: userId, role: "authenticated", aal }, fn);
  }

  async asAnon<T>(fn: () => Promise<T>): Promise<T> {
    return this.withRole("anon", { role: "anon" }, fn);
  }

  async asServiceRole<T>(fn: () => Promise<T>): Promise<T> {
    return this.withRole("service_role", { role: "service_role" }, fn);
  }

  private async withRole<T>(role: string, claims: object, fn: () => Promise<T>): Promise<T> {
    await this.pg.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(claims)]);
    await this.pg.exec(`set role ${role}`);
    try {
      return await fn();
    } finally {
      await this.pg.exec(`reset role`);
      await this.pg.query(`select set_config('request.jwt.claims', '', false)`);
    }
  }

  async rows<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.pg.query<T>(sql, params)).rows;
  }

  /** Returns the error message, or null if the statement succeeded. */
  async error(sql: string, params: unknown[] = []): Promise<string | null> {
    try {
      await this.pg.query(sql, params);
      return null;
    } catch (err) {
      return (err as Error).message;
    }
  }

  /** Superuser shortcut for test setup (bypasses RLS). */
  async seedAdmin(email = "admin@example.test"): Promise<string> {
    const id = await this.createUser(email, { provisioned: true });
    await this.asServiceRole(() => this.pg.query(`select public.bootstrap_first_admin($1)`, [id]));
    return id;
  }

  async close() {
    await this.pg.close();
  }
}

export function permsJson(rows: Array<Partial<Record<"view" | "create" | "edit" | "delete" | "export", boolean>> & { module: string; scope?: string }>) {
  return JSON.stringify(rows);
}
