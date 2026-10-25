# CoreNovaIT Admin and Staff Portal

Private portal for CoreNovaIT finances, marketing, calendar, tasks and team chat.
It is a separate app from the public website, with its own Supabase project.

- Next.js 16 (App Router, TypeScript), Tailwind CSS 4
- Supabase: Postgres with row-level security, Auth with TOTP two-factor
- Permissions are enforced in the database. Hiding a button is never the only check.

**Phase 1 (this build):** design system, sign-in, two-factor, roles and permissions,
row-level security, Team page, audit log. Later modules show a "coming in Phase N" page.

---

## 1. Local setup

Requires Node.js 20.9 or newer.

```bash
npm install
cp .env.example .env.local      # then fill in the values (see section 2)
npm run dev                     # http://localhost:3000
```

Without a Supabase project you can still review the design at these
development-only pages (they return 404 in production and every name on them is fake):

- `/dev/ui`: components, stat cards, states
- `/dev/team`: Team and permissions page, with the Manage drawer
- `/dev/audit`: audit log
- `/login`: the real sign-in page

## 2. Environment variables

| Name | Where it's used | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser + server | the anon / publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | Bypasses row-level security. Never prefix it with `NEXT_PUBLIC_`, never commit it. |
| `SITE_URL` | server | The portal's public URL, e.g. `https://admin.corenovait.com.au`. Used in invite and reset links. |
| `SESSION_IDLE_MINUTES` | server | Sign out after this many idle minutes (default 30, minimum 5). |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_NAME` | seed script only | Set locally, run the seed once, then delete them. |

`.env`, `.env.local` and every other `.env.*` file except `.env.example` are git-ignored.

## 3. Create the Supabase project

1. In Supabase, create a **new** project (do not reuse the public site's project).
   Pick the Sydney region if available.
2. **Run the migrations**, in order. Either paste each file into SQL Editor and run it:
   - `supabase/migrations/0001_core.sql`
   - `supabase/migrations/0002_finance_core.sql`

   or with the Supabase CLI: `supabase link --project-ref <ref>` then `supabase db push`.
3. **Authentication → Sign In / Providers**
   - Turn **off** "Allow new users to sign up". People only get in by invite.
   - Email provider: on. Turn on "Secure email change" and leaked-password protection.
   - Minimum password length: 12.
4. **Authentication → Multi-Factor**: enable **TOTP** (authenticator app).
5. **Authentication → URL Configuration**
   - Site URL: your `SITE_URL`
   - Redirect URLs: `SITE_URL/auth/confirm` (and `http://localhost:3000/auth/confirm` for development)
6. **Authentication → Sessions** (if on a paid plan): set an inactivity timeout to match
   `SESSION_IDLE_MINUTES`. The app enforces the idle timeout either way.
7. **Authentication → Emails → SMTP**: use Resend (host `smtp.resend.com`, port 465,
   user `resend`, password = a Resend API key) with a sender on a verified domain.
   Supabase's built-in mailer is rate-limited and not for production.
8. **Email templates**: change the link in these two templates so it goes through the portal:
   - **Invite user**: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/set-password`
   - **Reset password**: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/set-password`

## 4. Create the first admin

1. In `.env.local`, add `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` (12+ characters,
   at least 3 of: lowercase, uppercase, number, symbol) and optionally `SEED_ADMIN_NAME`.
2. Run:

   ```bash
   npm run seed:admin
   ```

   It refuses to run if an active admin already exists, and never prints the password.
3. **Delete the `SEED_ADMIN_*` lines** from `.env.local`.
4. Sign in. You'll be asked to set up two-factor before anything else loads.
5. Invite the second admin from **Team and permissions → Invite person** with the Admin role.
   Keep at least two admins so one can recover the other's access.

## 5. Roles and permissions

- Each person has a role preset: **Admin**, **Manager**, **Staff** or **Custom**.
- Admins can edit what Manager and Staff allow; everyone on that preset updates.
  Admin is fixed (full access) so you can't lock yourself out.
- Editing one person's matrix switches them to **Custom**.
- Every module has view / create / edit / delete / export, plus a scope:
  **own** (rows they created), **assigned** (rows assigned to them), or **all**.
- New people start as **Staff**: home, their own tasks, calendar and chat. No finance access.
- Anyone with access to Team, Settings or the Audit log must use two-factor. The
  database refuses their requests until they have.
- The last active admin can't be deactivated or demoted.

## 6. Tests

```bash
npm test          # all tests
npm run typecheck
```

- `tests/db/`: runs the real migrations in an in-memory Postgres (PGlite) with
  Supabase's roles and default grants, then checks row-level security directly:
  a staff user can't read, add, change or delete finance rows, can't read the
  audit log or other people's profiles, and can't raise their own permissions;
  an admin without two-factor is blocked; scopes, deactivation, session resets,
  last-admin guards and audit before/after records all behave.
- `tests/unit/`: money (integer cents, exchange-rate rounding), password rules,
  rate limiting, safe redirects.

Money is stored as integer minor units (cents/pence) with exchange rates as
`numeric(18,8)`. The base-currency amount is computed by the database.

## 7. Deploy to Hostinger (Node.js)

1. Push this repo to GitHub (`corenova-IT/corenovait-admin`).
2. In hPanel: **Websites → Add website → Node.js app**, connect the GitHub repo,
   branch `main`, and turn on auto-deploy.
3. Build settings:
   - Node version: 20 or 22
   - Install: `npm ci`
   - Build: `npm run build`
   - Start: `npm start`
4. Add the environment variables from section 2 (not the `SEED_ADMIN_*` ones).
   Set `SITE_URL` to `https://admin.corenovait.com.au`.
5. Domain: add the subdomain `admin.corenovait.com.au` to the app and turn on SSL.
6. Update Supabase **URL Configuration** (section 3, step 5) with the live URL.
7. Sign in at the live URL to confirm, then check **Audit log** shows the sign-in.

The app sends `noindex` headers and a strict Content-Security-Policy. Sign-in rate
limits are kept in memory, which is right for a single Hostinger Node process.

## 8. Backups

- Supabase Pro includes daily backups (7 days); add Point-in-Time Recovery if you
  need finer restores. The free plan has **no** backups, so use Pro for real data.
- Also take your own copy monthly (and before each migration):

  ```bash
  pg_dump "<connection string from Project Settings → Database>" -Fc -f corenovait-admin-YYYY-MM-DD.dump
  ```

  Store it somewhere private and encrypted, not in this repo.
- To restore into a fresh project: run `pg_restore -d "<connection string>" <file>.dump`.
- Receipts (from Phase 2) live in Supabase Storage. Back up that bucket too.
