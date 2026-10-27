# CoreNovaIT Admin and Staff Portal

Private portal for CoreNovaIT finances, marketing, calendar, tasks and team chat.
It is a separate app from the public website, with its own database.

- Next.js 16 (App Router, TypeScript), Tailwind CSS 4
- MySQL 8 with Drizzle ORM and versioned migrations (`/drizzle`)
- Sign-in built into the app: argon2id passwords, database sessions, TOTP two-factor
- Permissions are enforced on the server by one data-access layer (`lib/dal`).
  Nothing else may query the database; a test fails the build if anything tries.

**Phase 1 (this build):** design system, sign-in, two-factor, roles and permissions,
the data-access layer, Team page, audit log. Later modules show a "coming in Phase N" page.

---

## 1. Local setup

Requires Node.js 20.9+.

### The one-command way (Windows, macOS or Linux; no Docker or installer)

```bash
npm install
npm run db:local
```

`db:local` downloads the official MySQL 8.4 build once (cached in your temp folder), keeps its data
in `%LOCALAPPDATA%\CoreNovaIT\mysql-data` (outside the project: MySQL on Windows can't start from a
path with a space, like `CoreNovaIT 2.0`; override with `DEV_DB_DIR`), listens on `127.0.0.1:3307`
only, creates `.env.local` if you don't have one,
applies the migrations, and the first time loads clearly fake **sample data**: the same people as
the `/dev` pages plus 12 months of sample income and expenses. It prints a local-only password for
the sample accounts once. Keep that window open, and in a second terminal run `npm run dev`.

- Ctrl+C stops MySQL; running `npm run db:local` again picks up where you left off.
- `npm run db:local -- --reset` wipes the local data and starts fresh (and shows a new password).
- While sample rows exist, pages show a **Sample data** badge (development only).
- The sample-data seed refuses to run in production or against any database not on this PC.

### Or use your own MySQL 8 (pick one)

- **Docker:**
  ```bash
  docker run -d --name corenovait-mysql -p 3306:3306 -e MYSQL_ROOT_PASSWORD=devroot -e MYSQL_DATABASE=corenovait_admin mysql:8.4
  ```
  Then `DATABASE_URL=mysql://root:devroot@127.0.0.1:3306/corenovait_admin`.
- **Normal install:** MySQL Community Server 8.4 from mysql.com (or `winget install Oracle.MySQL`),
  then create a database and user:
  ```sql
  CREATE DATABASE corenovait_admin CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
  CREATE USER 'corenovait'@'localhost' IDENTIFIED BY 'a-local-password';
  GRANT ALL ON corenovait_admin.* TO 'corenovait'@'localhost';
  ```

Then:

```bash
npm install
cp .env.example .env.local      # fill in DATABASE_URL and APP_ENCRYPTION_KEY (npm run gen:key)
npm run db:migrate              # creates the tables
npm run seed:dev                # optional: sample data (local databases only)
npm run dev                     # http://localhost:3000
```

Without sample data, create your admin with `npm run seed:admin` (section 4). In development, invite and
password-reset emails are printed in the `npm run dev` terminal unless `RESEND_API_KEY` is set.

**Design preview without a database** (development only, returns 404 in production, every name is fake):
`/dev/ui`, `/dev/team`, `/dev/audit`, `/dev/login`.

## 2. Environment variables

All are server-only. See `.env.example` for comments.

| Name | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | `mysql://user:password@host:3306/database` |
| `APP_ENCRYPTION_KEY` | yes | 32 bytes base64 (`npm run gen:key`). Encrypts two-factor secrets. Keep a copy in your password manager. If it's lost, everyone must set up two-factor again. |
| `SITE_URL` | yes | e.g. `https://admin.corenovait.com.au`. Used in email links. |
| `RESEND_API_KEY`, `MAIL_FROM` | production | Resend key and a sender on your verified domain. |
| `UPLOAD_DIR` | production | Absolute path **outside** the app folder and `public_html`. |
| `SESSION_IDLE_MINUTES` | no | Default 30. |
| `SESSION_MAX_HOURS` | no | Default 12. Sessions end after this even if active. |
| `DATABASE_POOL_SIZE` | no | Default 5. |
| `UPLOAD_MAX_MB` | no | Default 10. |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_NAME` | once | Only while running `npm run seed:admin`. Delete afterwards. |
| `TEST_DATABASE_URL` | no | Run tests on an existing MySQL server instead of a temporary one. |

`.env`, `.env.local` and every other `.env.*` file except `.env.example` are git-ignored.

## 3. Database and migrations

- The schema lives in `lib/db/schema.ts`. Migrations in `/drizzle` are generated from it:
  ```bash
  npm run db:generate   # writes a new SQL file to /drizzle; connects to nothing
  ```
  Review the SQL, commit it, and never edit a migration that has been deployed.
- `npm run db:migrate` applies new migrations to `DATABASE_URL`. It is safe to repeat
  (applied ones are recorded in `__drizzle_migrations`).
- **`npm start` runs `db:migrate` first**, so every deploy upgrades the schema before serving.
- `0000_core_schema.sql` creates the tables; `0001_seed_reference_data.sql` adds the role
  presets, the 5 revenue streams and the 3 countries.

Conventions: timestamps are UTC `DATETIME(3)`; money is `BIGINT` minor units (cents/pence);
exchange rates are `DECIMAL(18,8)`; the base-currency amount is a MySQL generated column.

## 4. Create the first admin

1. Set `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` (12+ characters, at least 3 of: lowercase,
   uppercase, number, symbol) and optionally `SEED_ADMIN_NAME`, in `.env.local` locally or as
   environment variables on the server.
2. Run `npm run seed:admin`. It refuses if an active admin exists and never prints the password.
3. Delete the `SEED_ADMIN_*` values.
4. Sign in. You'll set up two-factor before anything else loads, and get 10 recovery codes.
   Save them in a password manager.
5. Invite the second admin from **Team and permissions → Invite person** with the Admin role.
   Keep at least two admins so one can recover the other's access.

### No SSH? Create the first admin through phpMyAdmin

```bash
npm run admin:sql
```

Run it on your own PC. It asks for the admin's email, name and password (typed hidden, twice),
hashes the password with argon2id, and writes `.private/first-admin-<date>.sql` (git-ignored). The
file contains **the hash only**: the password is never written to disk, printed or logged, and the
script never connects to any database. Then:

1. Make sure the site has been deployed once (so `npm start` has created the tables).
2. hPanel → Databases → **phpMyAdmin** → open the portal's database → **Import** → choose the file → **Go**.
3. The result row should say "First admin created". If an admin already exists it changes nothing
   and says "NOT CREATED".
4. Delete the file, sign in, and set up two-factor.

## 5. Sign-in security

- **Passwords:** argon2id (19 MiB, 2 passes). 12+ characters, mixed types, not containing your email name.
- **Sessions:** the cookie holds a random token (`__Host-cn_session`, httpOnly, Secure, SameSite=Lax);
  the database stores only its SHA-256. Sessions end after 30 idle minutes or 12 hours, when an admin
  resets them or deactivates the person, or after a password reset.
- **Lockout:** 5 wrong passwords in a row lock the account for 15 minutes. Separately, each IP gets
  20 attempts per 15 minutes. Unknown emails get exactly the same answer, in the same time.
- **Two-factor:** required for admins and anyone with any access to Finances, Transactions, Team,
  Settings or the Audit log (the Manager preset included); optional for everyone else. Secrets are AES-256-GCM encrypted with `APP_ENCRYPTION_KEY`; codes can't be reused.
- **CSRF:** server actions only accept same-origin requests (Next.js checks Origin vs Host);
  cookies are SameSite=Lax.

### Lost authenticator: how access is recovered

1. **Recovery code.** On the two-factor screen choose "Lost your phone? Use a recovery code".
   Each of the 10 codes works once. Then go to **Security → Move to a new phone**, which also
   issues new recovery codes.
2. **Another admin.** If the codes are gone too, another admin opens **Team → Manage → Reset
   two-factor** (after confirming it's really them, for example by phone). The person is signed
   out everywhere and sets up a new authenticator at their next sign-in. It's audit-logged.
3. **Server command (last resort).** If no other admin can help, run on the server over SSH:
   ```bash
   npm run reset-2fa -- person@corenovait.com.au --yes
   ```
   Same effect as step 2, also audit-logged. This is why you should keep two admins.

## 6. Roles and permissions

- Presets: **Admin**, **Manager**, **Staff**, **Custom**. Admins can edit Manager and Staff;
  everyone on that preset updates. Admin is fixed so you can't lock yourself out.
- Editing one person's matrix switches them to **Custom**.
- Every module has view / create / edit / delete / export, plus a scope: **own** (rows they
  created), **assigned** (also rows assigned to them), or **all**.
- New people start as **Staff**: home, their own tasks, calendar and chat. No finance access.
- The last active admin can't be deactivated or demoted.

**How it's enforced:** pages, server actions and route handlers never touch the database.
They call `lib/dal/*`, where every function takes the signed-in `Actor` and checks
`has_perm(module, action)` and the data scope before querying. An `Actor` can only be created
from a real database session, so a hand-made one is rejected.

### Transactions, revenue and commission (Phase 2A)

- **Transactions** (`/transactions`): income and expenses with search, date range, stream, country,
  status, representative, category and type filters; sortable columns; server-side paging; add, edit
  and delete (with confirmation); an optional invoice or receipt on each entry; CSV import and export.
- **Scope:** *own* shows entries you created; *assigned* also shows income credited to the
  representative record linked to your login; *all* shows everything. Exports follow the same rule.
- **Money:** amounts are typed with up to 2 decimals and stored as whole cents. The exchange rate is
  entered by hand (up to 8 decimals) and MySQL computes the base-currency amount, rounding half away
  from zero. Totals are sums of those stored cents.
- **CSV:** columns `date, stream, country, client, description, amount, currency, fx_rate, invoice_ref,
  status, representative, notes` (income) or `date, category, vendor, description, amount, currency,
  fx_rate, recurring, country, notes` (expenses; leave `country` empty for a shared cost). Streams and representatives are matched by name, countries by
  code (GB, AU, OTHER) or name. An import is all or nothing: if any row is invalid, nothing is saved and
  the problem rows are listed. Up to 1,000 rows / 1 MB per file. Exports neutralise spreadsheet
  formulas and are recorded in the audit log.
- **Revenue streams** (`/streams`), **countries** (`/streams/countries`, with amounts as received in
  GBP and their AUD value) and **representatives** (`/streams/representatives`).
- **Commission:** earned only when a credited deal is marked **paid**, at the rate stored on that deal
  when it was credited (changing a rep's rate affects new deals only), rounded to the cent per deal.
  Owed = earned − payouts recorded in the payout log.

### Finances, payments and settings (Phase 2B)

- **Revenue means paid.** Every revenue total, chart and comparison counts income marked **paid** only.
  Pending and overdue invoices are shown separately as **Outstanding** and are never added to revenue.
- **Home** (`/home`) and **Finances** (`/analytics`): the last 12 months up to today (Sydney time),
  compared with the 12 months before. Revenue, expenses, profit and margin; month, quarter and year
  comparisons; revenue by stream and by country; stream × country; top clients; expenses by category.
  The current month is still running, so charts draw it dashed and mark it "month to date".
  The finance export (`/api/export/finances`) is audited.
- **Country switch (All / UK / AUS):** income follows the client country. Expenses and subscriptions
  tagged with a country follow it too; **untagged (shared) costs are left out** of a country view, and
  the page says how much was left out.
- **Payments** (`/payments`): subscriptions and regular costs with a billing cycle (weekly, monthly,
  quarterly, yearly or one-off), a reminder window and the person responsible. The timeline shows what
  falls due in the next 30, 60 or 90 days. **Mark paid** records the expense and moves the next due date
  on; pause, resume, cancel and delete are under **Manage**. Monthly recurring = active subscriptions as
  a monthly cost (weekly × 52 ÷ 12, quarterly ÷ 3, yearly ÷ 12).
- **Payouts above what's owed** are allowed, but the form asks for confirmation first, and the audit log
  records who confirmed it and both amounts.
- **Settings** (`/settings`, admins only): the revenue stream, country and expense category lists.
  Every change is audited. A stream or category already used by entries can't be deleted, only
  archived (hidden from new entries, kept on old ones); a country in use can be renamed but not deleted.
- **Sample data** (`npm run db:local`, development only) covers the 24 months up to the day it's loaded,
  so the "vs prior year" figures have something to compare with. Every sample row is flagged and the
  pages show a **Sample data** badge. Production never shows invented numbers.

### Marketing (Phase 3)

- **Marketing** (`/marketing`): every call, email, referral or message is one **activity**: when it
  happened, the channel (email, cold calling, direct, individual referral, social, other), an optional
  campaign, who was contacted, the outcome (no response, replied, meeting booked, deal won, deal lost),
  an optional deal value on a won deal, and the owner (who did the outreach).
- **Log activity** opens a short form. After each save it clears and stays open, so a run of calls can
  be logged one after another. Times are typed in the company time zone (Settings, default
  Australia/Sydney) and stored in UTC; activity in the future is refused.
- **The numbers** (for the filters on screen: channel, campaign, month and owner; the default view is
  the last 12 months):
  - *Touches* = activities logged (every call, email, referral or message).
  - *Contacts reached* = unique contacts in the period: each **company** counts once, or each
    **person** when no company was given (compared ignoring upper/lower case and spaces at the ends).
    Calling Example Dental three times is 3 touches and 1 contact.
  - *Response rate* = touches that got any answer (replied, meeting booked, deal won or deal lost)
    ÷ touches. It's per touch, so it matches the heatmap and the best day and time.
  - *Deals won* and *Revenue from marketing* (the value of won deals, converted to the base currency
    by MySQL with the rate typed on the deal, rounded half away from zero).
  - Each compares with the period before; the response rate change is in percentage points.
  - *Channel performance*, *deals won by month*, and *campaigns with results* (all time).
- **Heatmap and insights** use the company time zone, daylight saving included (computed with Intl,
  so MySQL's time-zone tables aren't needed). Hours with fewer than 3 touches aren't coloured.
  *Best day* needs at least 20 touches on a weekday and *best time* at least 15 in an hour; below
  that the card says "Not enough activity yet" instead of guessing. *Best month* is the month in view
  with the most deals won.
- **Permissions and scope** (module "marketing", set per person on the Team page):
  - *own*: only activity you logged; *assigned*: also activity someone logged with you as the owner;
    *all*: everything. Figures, campaign results and exports follow the same scope.
  - Only people with *all* can log activity for someone else or create, edit and delete campaigns
    (campaigns are shared by everyone). A campaign with logged activity can't be deleted; mark it
    finished instead.
  - The default **Staff** preset has no marketing access (least privilege). The **Marketing staff**
    preset is Staff plus marketing *view* and *create* with scope *own*: they log their own calls and
    see only their own figures, and can't edit or delete afterwards. Admins can edit either preset on
    the Team page.
  - Every create, edit and delete is in the audit log with before and after values; exports
    (`/api/export/marketing`, needs marketing export) are logged too.
- **Sample data**: 24 months of clearly fake activity (about 1,600 rows) across seven sample campaigns,
  logged by Alex (admin), Devon (manager) and Emery (`marketing@example.test`, on the Marketing staff
  preset). Sign in as Emery to see the *own* scope.
- **Company time zone** (Settings, admins only): "today" for due dates, calendar times, and the marketing
  heatmap and insights. Times are stored in UTC, so changing it doesn't alter any record. Audited with
  the old and new value.

### Calendar, tasks and My Day (Phase 4)

- **Calendar** (`/calendar`): month, week and agenda (next 30 days) views, in the company time zone.
  - Shows events (meetings, deadlines, other), plus **task due dates** for people who can see tasks
    and **payment due dates** for people who can see payments, each in its own colour *and* with a
    word or time on the chip ("Due", "Pay"), so colour is never the only signal.
  - Events have a title, type, start and end (or all day), place, video link (https only), a reminder
    and who's invited. Reminders are saved now and sent once notifications arrive in Phase 5.
  - **Drag to reschedule**: drag your own event to another day; its local time and length are kept
    (also across a daylight-saving change). The Edit form does the same from the keyboard.
  - **.ics**: anyone can download an event they can see ("Add to my calendar"). *Export .ics*
    (`/api/calendar/ics`, every event in your scope from 30 days ago to a year ahead) needs calendar
    export and is in the audit log.
  - Scope: *own* = events you created; *assigned* = also events you're invited to (the Staff default:
    staff see only the events they're invited to); *all* = every event. Only the creator, or someone
    with *all*, can change, move or delete an event; invited people see it but can't change it.
- **Tasks** (`/tasks`):
  - **Board** (To do, In progress, Review, Done): drag a card to another column; the status menu in
    the task panel does the same from the keyboard. **List**: soonest due first; for people who see
    everyone's tasks it's split into a to-do list per person.
  - Each task: title, details, assignee, priority, due date, labels, a checklist (ticks are kept when
    you edit the list) and comments. Overdue tasks are marked in red with the word "Overdue".
  - Filters: person, priority, label, due (overdue / this week), search; **My tasks** = assigned to you.
  - **Progress this week** (people who see all tasks): per person, how many tasks due this week are
    done, open tasks and overdue ones.
  - Scope: *own* = tasks you created; *assigned* = also tasks assigned to you (the Staff default);
    *all* = everything. Below *all* you can only assign a task to yourself or leave it unassigned.
    People who can see a task and create tasks can comment; you can delete your own comments (and
    people with delete + *all* can remove any). Deleting a task keeps it, with its comments, in the
    audit log.
- **Home**: *Next meetings* and *Team tasks this week* (or *My tasks* for people who only see their
  own) use real data.
- **My Day** (Home for people without finance access): today's meetings (and later this week), my tasks
  due (overdue, this week, undated), quick actions for exactly what this person may do (new task, new
  event, log activity, add income, add payment; each opens the form directly), payments this week and
  my marketing only when they have access. Unread chat arrives with Phase 5.
- Every create, edit, move, status change, checklist tick, comment and delete is audited with before and
  after values.
- **Sample data**: about 45 events five weeks either side of today (weekly stand-up, sprint planning,
  client calls, deadlines, an offsite) and about 35 tasks across the team with checklists and comments.
  `web.dev@example.test` (Casey, staff) shows the *My Day* view.

## 7. Uploads

Files are stored in `UPLOAD_DIR` under random names, never in `public/`. Only PDF, PNG, JPG and WebP
are accepted (checked from the file's bytes, not its name), up to `UPLOAD_MAX_MB`. They're served only
by `/api/files/[id]`, which checks the person's permission and scope on every download.

## 8. Tests

```bash
npm test
npm run typecheck
```

Tests run against a real MySQL 8.4: if `TEST_DATABASE_URL` isn't set, the first run downloads the
official MySQL build once (cached afterwards) and starts it temporarily. Each test file gets
a fresh database with the real migrations. Nothing touches your local or production data.

- `tests/dal/permissions.test.ts`: staff can't read or change finance, team or audit data; forged
  Actors are rejected; two-factor gating; own/assigned/all scopes; money; last-admin guards; audit
  before/after.
- `tests/dal/routes.test.ts`: **every** server action, the guarded pages and the file route, called
  as a signed-in staff user: each is refused and the database is unchanged.
- `tests/dal/auth.test.ts`: argon2id, lockout, idle and absolute timeouts, TOTP setup, replay and
  recovery codes, reset and invite links, server-side two-factor reset.
- `tests/dal/marketing.test.ts`: staff without marketing access can't read or change anything; the
  own / assigned / all scopes; nobody below *all* can log for someone else or manage campaigns; audit
  before/after; deal values in other currencies; the heatmap in Sydney time across daylight saving;
  the "not enough data" rules for the insights.
- `tests/dal/work.test.ts`: calendar and task scope (staff see only events they're invited to and tasks
  they created or are assigned), who can change what, drag to reschedule across daylight saving,
  .ics, checklists, comments, My tasks, team progress, audit.
- `tests/dal/settings.test.ts`: the company time zone (admin only, validated, audited, used by the
  marketing heatmap).
- `tests/dal/boundaries.test.ts`: nothing outside `lib/dal` imports the database.
- `tests/unit/`: TOTP against the RFC test vectors, encryption, upload type checks, money, passwords,
  date labels.

### Layout test (every page, every width)

```bash
npm run test:layout
```

Builds the app, starts it against a throwaway MySQL with the sample data, and opens every page in
the installed Chrome at 1920, 1536, 1440, 1366, 1280, 1152, 1024, 768 and 390 px, in both themes
(these widths also cover Windows display scaling at 125% and 150%). It fails if any text is clipped,
anything sticks out of its card, a heading runs onto three lines, the page scrolls sideways, or a
table needs sideways scrolling from 1280 px up. The same run also does the interactive flows in
`tests/e2e/flows.spec.ts`: dragging a task between board columns, ticking a checklist and commenting,
dragging a calendar event to another day, logging marketing activity, and a My Day quick action, each
checked again after a reload. For a quicker run, limit it, e.g.
`E2E_WIDTHS=1366,390 E2E_THEMES=dark npx playwright test` (after `npx next build --webpack`).

The shared sizes live in `app/globals.css`: `--space-card` / `--space-gap` (fluid padding and gaps),
`.kpi-number` (big figures, sized to their card), `.title-card`, `.clamp-2` (names wrap to two lines
instead of being cut off) and `.scroll-x` (wide tables on small screens, with an edge fade). Page grids
use container queries on the content area (`@min-[60rem]:grid-cols-4` etc.), so columns depend on the
space beside the sidebar rather than the window width.

## 9. Deploy to Hostinger (Node.js)

**Create the database (hPanel → Databases → MySQL Databases):**

1. Create a database (e.g. `u123_corenovait`) and a user with a long random password.
2. Leave **Remote MySQL** off. The app connects as `localhost` from the same server; your PC never
   connects to the production database.
3. `DATABASE_URL=mysql://u123_user:PASSWORD@localhost:3306/u123_corenovait` (URL-encode special
   characters in the password).

> **Back up the database before any deploy that changes the schema.** `npm start` applies new
> migrations automatically as soon as the deploy starts, and they can't be undone with a click.
> A deploy changes the schema whenever it adds a file to `/drizzle` (check the commit or pull
> request). Before pushing it: hPanel → Databases → phpMyAdmin → Export (or `mysqldump`, section 10),
> and download the file. If the migration goes wrong, restore that export and redeploy the previous commit.

**Create the app:**

1. Push this repo to GitHub (`corenova-IT/corenovait-admin`).
2. hPanel → **Websites → Add website → Node.js app**, connect the GitHub repo, branch `main`, auto-deploy on.
3. Build settings: Node 20 or 22 · install `npm ci` · build `npm run build` · start `npm start`
   (which migrates, then starts).
4. Environment variables: everything in section 2 except `SEED_ADMIN_*` and `TEST_DATABASE_URL`.
   Set `SITE_URL=https://admin.corenovait.com.au` and `UPLOAD_DIR` to a folder in your home
   directory outside the app, e.g. `/home/u123/corenovait-uploads`.
5. Domain: attach `admin.corenovait.com.au` and turn on SSL.
6. Create the first admin once: over SSH (hPanel → Advanced → SSH access), from the app folder,
   `SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... npm run seed:admin`, then clear your shell
   history (`history -c`). No SSH: use `npm run admin:sql` and phpMyAdmin (section 4).
7. Sign in at the live URL, set up two-factor, and check **Audit log** shows the sign-in.

**Email:** in Resend, verify `corenovait.com.au` (the public site may already have done this), create an
API key, and set `RESEND_API_KEY` and `MAIL_FROM`.

## 10. Backups

- **Hostinger:** hPanel → Files → Backups keeps automatic daily backups of files and databases
  (retention depends on your plan). Restore a database from there in a few clicks.
- **Before every deploy that adds a file to `/drizzle`** (a schema change): take a copy first, as below.
  Migrations run automatically on start, so this is your undo button.
- **Your own copy (monthly, and before schema changes):** over SSH on the server:
  ```bash
  mysqldump --single-transaction --routines --no-tablespaces -u u123_user -p u123_corenovait | gzip > ~/backups/corenovait-$(date +%F).sql.gz
  ```
  Download it via the File Manager and store it encrypted (not in this repo). hPanel →
  Databases → phpMyAdmin → Export does the same thing from the browser.
- **Uploads:** back up `UPLOAD_DIR` too (`tar czf ~/backups/uploads-$(date +%F).tgz /home/u123/corenovait-uploads`).
- **Keys:** keep `APP_ENCRYPTION_KEY` in your password manager. A database backup without it
  can't verify two-factor codes.
- **Restore:** `gunzip < corenovait-YYYY-MM-DD.sql.gz | mysql -u u123_user -p u123_corenovait`.
