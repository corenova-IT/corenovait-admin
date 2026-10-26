import "server-only";
import { and, count, desc, eq, gte, like, lt, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type Db, type Tx } from "@/lib/db";
import type { AppModule } from "@/lib/permissions";
import { requirePerm, type Actor } from "./guard";

const { auditLog } = schema;

export const AUDIT_ACTIONS = [
  "create",
  "update",
  "delete",
  "export",
  "sign_in",
  "sign_out",
  "lockout",
  "invite",
  "invite_accepted",
  "password_reset",
  "permissions",
  "preset",
  "sessions_reset",
  "activate",
  "deactivate",
  "mfa_enabled",
  "mfa_reset",
  "recovery_code_used",
  "recovery_codes_regenerated",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditEntry = {
  action: AuditAction;
  entity: string;
  entityId?: string | null;
  summary?: string | null;
  before?: unknown;
  after?: unknown;
};

/**
 * Append one audit row inside the caller's transaction, so the change and its
 * record commit (or roll back) together. There is deliberately no function to
 * update or delete audit rows.
 */
export async function writeAudit(
  db: Db | Tx,
  who: { userId: string | null; email: string | null } | null,
  e: AuditEntry,
  ip?: string | null
) {
  await db.insert(auditLog).values({
    actorId: who?.userId ?? null,
    actorEmail: who?.email ?? null,
    action: e.action,
    entity: e.entity,
    entityId: e.entityId ?? null,
    summary: e.summary ? e.summary.slice(0, 500) : null,
    before: e.before ?? null,
    after: e.after ?? null,
    ip: ip ?? null,
  });
}

/** Many audit rows in one insert (CSV imports), inside the caller's transaction. */
export async function writeAuditMany(db: Db | Tx, who: { userId: string | null; email: string | null } | null, entries: AuditEntry[]) {
  if (!entries.length) return;
  await db.insert(auditLog).values(
    entries.map((e) => ({
      actorId: who?.userId ?? null,
      actorEmail: who?.email ?? null,
      action: e.action,
      entity: e.entity,
      entityId: e.entityId ?? null,
      summary: e.summary ? e.summary.slice(0, 500) : null,
      before: e.before ?? null,
      after: e.after ?? null,
    }))
  );
}

export const actorRef = (a: Actor) => ({ userId: a.userId, email: a.email });

/** Exports are logged only for people allowed to export that module. */
export async function logExport(actor: Actor, module: AppModule, summary: string) {
  requirePerm(actor, module, "export");
  await writeAudit(getDb(), actorRef(actor), { action: "export", entity: module, summary });
}

export const auditFilters = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  action: z.enum(AUDIT_ACTIONS).optional().catch(undefined),
  entity: z.string().regex(/^[a-z_]{1,64}$/).optional().catch(undefined),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).optional().catch(1),
});
export type AuditFilters = z.infer<typeof auditFilters>;

export type AuditRowOut = {
  id: number;
  at: string;
  actor_email: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  summary: string | null;
  before: Record<string, unknown> | unknown[] | null;
  after: Record<string, unknown> | unknown[] | null;
};

export async function listAudit(actor: Actor, f: AuditFilters, pageSize = 50): Promise<{ rows: AuditRowOut[]; total: number }> {
  requirePerm(actor, "audit", "view");
  const db = getDb();
  const conds: SQL[] = [];
  if (f.action) conds.push(eq(auditLog.action, f.action));
  if (f.entity) conds.push(eq(auditLog.entity, f.entity));
  if (f.from) conds.push(gte(auditLog.at, new Date(`${f.from}T00:00:00Z`)));
  if (f.to) conds.push(lt(auditLog.at, new Date(Date.parse(`${f.to}T00:00:00Z`) + 86_400_000)));
  if (f.q) {
    const term = `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conds.push(or(like(auditLog.actorEmail, term), like(auditLog.summary, term), like(auditLog.entityId, term))!);
  }
  const where = conds.length ? and(...conds) : undefined;
  const page = f.page ?? 1;
  const [rows, [{ n }]] = await Promise.all([
    db
      .select()
      .from(auditLog)
      .where(where)
      .orderBy(desc(auditLog.at), desc(auditLog.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ n: count() }).from(auditLog).where(where),
  ]);
  return {
    total: n,
    rows: rows.map((r) => ({
      id: r.id,
      at: r.at.toISOString(),
      actor_email: r.actorEmail,
      action: r.action,
      entity: r.entity,
      entity_id: r.entityId,
      summary: r.summary,
      before: (r.before ?? null) as AuditRowOut["before"],
      after: (r.after ?? null) as AuditRowOut["after"],
    })),
  };
}
