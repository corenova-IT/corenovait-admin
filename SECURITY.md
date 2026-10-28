# Security review

Phase 6 review of the CoreNovaIT Admin and Staff Portal, done as an attacker would:
a signed-in **staff** user (the default Staff role: Home, Calendar, Tasks and Chat with the
"assigned" scope) trying to reach finance, other people's direct messages or admin data,
plus someone **not signed in** at all. Every finding below was fixed and has a test.
The tests named here run in `npm test` (and the browser checks in `npm run test:layout`).

To report a problem, email the admins privately. Don't open a public GitHub issue.

## Findings and fixes

| # | Finding | Risk | Fix | Test |
| --- | --- | --- | --- | --- |
| 1 | The sign-in proxy blocked the scheduler endpoint (no session cookie gave a 401), so the cron job could never run | Reminders and emails silently not sent | `/api/cron` is let through the proxy. The route checks its own `CRON_SECRET` with a constant-time compare and is rate-limited | `tests/unit/security-review.test.ts` (cron through, other API routes 401, look-alike paths blocked) |
| 2 | Rate limits keyed on the **first** `X-Forwarded-For` address, which the visitor writes themselves | Unlimited password guessing by sending a new fake address each time | The client address is taken from the right-hand end of the header, counting `TRUST_PROXY_HOPS` proxies (default 1, Hostinger's) | `tests/unit/security-review.test.ts` (spoofed header gets the same bucket) |
| 3 | The Content Security Policy allowed `'unsafe-inline'` scripts | An injected `<script>` could run if any text was ever rendered unescaped | A fresh nonce per request with `'strict-dynamic'`; no inline script runs without it | `tests/unit/security-review.test.ts` (nonce present, differs per request, no `unsafe-inline`) |
| 4 | `safeNextPath` accepted `"/<tab>/evil.com"` and `"/\evil.com"`; browsers drop the tab and read `\` as `/`, so after sign-in you could be sent to another site | Phishing: a real sign-in link that lands on a fake page | Control characters and backslashes are refused, and the result must resolve to this site | `tests/unit/security-review.test.ts` (redirect cases) |
| 5 | No limits on chat messages, uploads, whole-list downloads, or invite and reset links | Spam, filling the disk, scraping the ledger, guessing link tokens | Per-person limits: 30 messages a minute, 30 uploads per 10 minutes, 20 downloads per 10 minutes (then 429 with `Retry-After`). Invite and reset links: 10 tries per address per 15 minutes | `tests/dal/routes.test.ts` ("rate limits") |
| 6 | Dev sample data and sample accounts could be created against a production database | Known passwords on a live system | `lib/sample-guard.ts`: the sample seed refuses production, a non-local database or a non-local `SITE_URL`; invites, `seed:admin` and `admin:sql` refuse sample addresses (`example.*`, `.test`, `.invalid`, `localhost`) in production | `tests/unit/sample-guard.test.ts`, `tests/dal/production-guard.test.ts` |
| 7 | A deploy applied migrations with no backup unless someone remembered to take one | A bad migration with no way back | `npm start` writes a full SQL backup before applying any migration to a database with data. If the backup fails, nothing is migrated and the app doesn't start | `tests/dal/backup.test.ts` (restores every row; a failed backup blocks the migration) |
| 8 | Deleting a chat message left its attachment on disk | Files a person deleted could still be there | The cron job removes attachments no message uses (after a one-hour grace period) | `tests/dal/chat.test.ts` (attachment clean-up) |

## What was checked and found sound

**Every server action.** `tests/dal/routes.test.ts` finds every `"use server"` module by itself
and calls every exported action as a staff user with a hostile form (another person's ID, the
Admin role, all permissions). Admin and finance actions change nothing. Tasks, calendar and chat
actions are allowed for staff and are scope-tested in `tests/dal/work.test.ts` and
`tests/dal/chat.test.ts`. A new action that isn't guarded, public by design, or self-service
fails the test.

**Every page.** A staff user opening any finance, payments, streams, marketing, team, settings
or audit page is redirected to `/no-access`. Nobody signed in goes to `/login`.

**Every API route.**

| Route | Not signed in | Staff | Notes |
| --- | --- | --- | --- |
| `/api/files/[id]` | 401 | 404 for anything outside their scope | "Not allowed" and "not found" look the same, so IDs can't be probed |
| `/api/export/*`, `/api/calendar/ics` | 401 | 403 | Needs the export permission; scoped; audit-logged; rate-limited |
| `/api/calendar/event/[id]` | 401 | 404 unless invited | |
| `/api/chat/stream`, `/api/chat/sync` | 401 | Only conversations they're in | A DM they aren't in returns nothing |
| `/api/me/badges`, `/api/notifications/[id]/open` | 401 | Their own only | The open link only redirects to paths on this site |
| `/api/cron/notifications` | 401 without the secret | Same | 503 if `CRON_SECRET` isn't set; 6 runs a minute |

**Search.** The top-bar search runs each page's own data functions, and only for pages the person
can open, so it follows the same permissions and scope. Chat search only looks in conversations
the person is a member of (`tests/dal/search.test.ts`).

**Direct messages.** Admins can't read DMs they aren't in. Moderation ("Message removed by an
admin") works in channels only, and the audit entry records who, when and where, never the text.
Chat attachment names aren't written to the audit log.

**Headers** (every response):

- `Content-Security-Policy`: `default-src 'self'`; scripts by nonce with `'strict-dynamic'`;
  `frame-ancestors 'none'`; `form-action 'self'`; `object-src 'none'`; `base-uri 'self'`;
  `upgrade-insecure-requests`.
- `Strict-Transport-Security: max-age=63072000; includeSubDomains`.
- `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`.
- `Referrer-Policy: strict-origin-when-cross-origin`.
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
- `X-Robots-Tag: noindex, nofollow`. No `X-Powered-By`.

Downloads also send `Content-Disposition: attachment` (images inline), `Cache-Control: private,
no-store`, and a sandboxed CSP of their own.

**Cookies.** The session cookie is `__Host-cn_session`: `Secure`, `HttpOnly`, `SameSite=Lax`,
`Path=/`, no domain. The browser only holds a random token; the database stores its SHA-256.
Sessions end after 30 idle minutes and 12 hours at most, when a person is deactivated, or when
an admin uses "reset sessions". Server actions also check the request's origin (built into Next.js).

**Sign-in.**

- Passwords are hashed with argon2id (19 MiB, 2 passes).
- An account locks for 15 minutes after 5 wrong passwords.
- Two-factor is required for everyone. Secrets are encrypted at rest with `APP_ENCRYPTION_KEY`;
  recovery codes are stored hashed.
- Invite and reset links are single-use random tokens, stored hashed, and they expire.

**Uploads.**

- The type is decided by the file's contents, not its name: only PDF, PNG, JPEG and WebP are allowed.
- Up to `UPLOAD_MAX_MB`.
- Files are stored under random names in `UPLOAD_DIR`, outside the app and the web root, with
  owner-only permissions.
- They are only ever served by `/api/files/[id]` after a permission check.

**Audit coverage.** Every create, change and delete in the data layer writes an audit entry with
before and after values, as do sign-ins, exports and permission changes. A script checked every
data-layer function that writes. The ones without an entry are deliberate: session upkeep,
read markers, presence and typing, notification delivery, and sending a chat message. Chat
sending is left out so the audit log never becomes a copy of everyone's messages; edits,
deletions and moderation are logged.

**Secrets in logs.**

- Nothing logs passwords, tokens, keys, email bodies or message text.
- Unexpected errors in forms are logged by type only.
- Email failures log the status code, not the message or the API key.
- The scheduler never logs its secret.
- Backups log the file name and row counts, not the database URL.
- Tested in `tests/unit/no-secrets-in-logs.test.ts`.

**Database exposure.** Production connects to MySQL as `localhost`, and Remote MySQL stays off
(DEPLOY.md). There's no route or script that opens the production database to the internet or
connects to it from a PC; `npm run admin:sql` writes an SQL file instead.

**SQL injection.** All queries go through Drizzle with bound parameters. Search terms escape
`%` and `_` (`tests/dal/search.test.ts`).

**XSS.** React escapes everything rendered, and nothing uses `dangerouslySetInnerHTML` with
user data. Video links must be `https://`. Chat and notes are plain text.

## Accepted risks

- **Rate limits live in memory.** Hostinger runs one Node process, so this is enough. The
  counters reset when the app restarts; the database lockout (5 wrong passwords) does not.
- **`style-src 'unsafe-inline'`.** Charts set sizes and colours with `style=""`. That can't
  run scripts.
- **A payment's responsible person without payments access gets no reminder.** A reminder shows
  payment details, so it follows payments access (decision in Phase 5).
