# Stream partners: progress

Branch: `feature/stream-partners`. Spec: [stream-partners-spec.md](stream-partners-spec.md). Plan and owner decisions: [stream-partners-plan.md](stream-partners-plan.md).

Approval gate: Phase N+1 starts only when this file contains the line "Phase N approved by Umair".

## Current status (updated end of run 5)
- Phases 1 and 2 approved. **Phase 3 is finished** (all steps ticked; report below). I stopped at the approval gate: Phase 4 does not start until this file contains the line "Phase 3 approved by Umair".
- Test status: typecheck clean; full suite **513 passed, 0 failed** (42 files).
- Blockers: none. Not pushed, not deployed. The new migration `drizzle/0014_employees.sql` is a file only: it has not been run on any real database (only on throwaway test databases by the test suite).
- Needs your eyes: the migration file, and the "What I was unsure about" list in the Phase 3 report.

## Answers received after the Phase 2 report
1. Budgets: **skip for now** (no budgets are built or shown).
2. Partners marking subscriptions paid: **yes**, for subscriptions in their own streams (and countries), every change logged. It only records the cost and moves the due date on. **Done** (`markMySubscriptionPaid` in lib/dal/partner-writes.ts, "Mark as paid" button on /my-dashboard/subscriptions, 4 new tests).
3. Rows need a stream and a country; rows with the "Shared" country stay admin-only: **confirmed, no change**.
4. Unarchive: **later, after Phase 4** (see "Later" below).
Phase 2 is **not yet approved**: the line "Phase 2 approved by Umair" is still missing, so Phase 3 has not started.

## Later (agreed, not started)
- Admin "unarchive" for archived expenses and tasks (and cancelled subscriptions), logged. After Phase 4.

## Status at the end of run 1 (2026-11-18)

- **Phase 1 is finished** (all steps below ticked). I stopped here, as required: Phase 2 does not start until the line "Phase 1 approved by Umair" appears in this file.
- **Next:** wait for your review of Phase 1. After approval, the first step is 2.1 (partner "My dashboard").
- **Blockers:** none. One thing needs your eyes: the migration file `drizzle/0013_stream_partners.sql` (see the report).
- **Test status:** typecheck clean. Full suite: **395 tests passed, 0 failed** (32 files) on commit `1195811`, which is the 367 earlier tests plus 28 new ones. A second full run after the small audit-label commit was also green: 395 passed, 0 failed.
- **Nothing was pushed, deployed or run against any real database.** The migration was applied only to throwaway test databases by the test suite.
- **Not checked in a browser.** The new screens (invite form, user edit page, the two landing pages) are covered by tests and the type checker, but I did not open them in a running app. Please click through them (steps below) on your local database.

## Answers received after run 1 (2026-11-18)
1. Archived rows: yes, first Phase 2 task (older lists and totals must ignore archived rows).
2. Stream field on the admin expense and subscription forms: yes, Phase 2.
3. Hide the Employee option until Phase 3: **done** (hidden in the invite and role pickers, and refused by the server; test added).
4. One role or the other: keep as is.
Phase 1 is **not yet approved**: the line "Phase 1 approved by Umair" is still missing, so Phase 2 has not started.

## Checklist

### Phase 1: streams and countries, new roles, scoped helper, migration, access tests
- [x] 1.1 Migration file `drizzle/0013_stream_partners.sql` (a file only, never run on the live database)
- [x] 1.2 Schema for the new tables and columns (`lib/db/schema.ts`)
- [x] 1.3 Presets `stream_partner` and `employee`, new permission modules, 2FA rule, presets locked from hand-editing
- [x] 1.4 Shared scoped-query helper `lib/dal/scope.ts` and the `scoped` field on the Actor
- [x] 1.5 Stream and country assignment on the invite form and the user edit page, one stream one partner, audit log
- [x] 1.6 Placeholder landing pages (`/my-dashboard`, `/work`) and `/home` redirects
- [x] 1.7 Access tests (`tests/dal/stream-partners.test.ts`, plus new cases in `tests/dal/routes.test.ts`)
- [x] 1.8 Phase 1 report (below)

### Phase 2: partner dashboard, admin Partners, partner writes (finished; waiting for approval)
- [x] 2.0a Archived expenses and tasks ignored by every older reader (lists, lookups, exports, totals, team progress, calendar, reminders) + all-readers test `tests/dal/archived.test.ts`
- [x] 2.0b Stream field on the admin expense and subscription forms ("Company-wide" by default); marking a subscription paid keeps its stream; `tests/dal/cost-streams.test.ts`
- [x] 2.1 Partner "My dashboard" (data: lib/dal/partner-dashboard.ts; page: app/(portal)/my-dashboard; tests/dal/partner-dashboard.test.ts). Budgets: the system has no budgets concept yet, so none shown. Employees panel arrives in Phase 3/4.
- [x] 2.2 Admin Partners list (lib/dal/admin-partners.ts, /partners; filters stream, country, date range)
- [x] 2.3 Admin per-partner page with "Changes made" (/partners/[id]; tests/dal/admin-partners.test.ts). Employees section is a placeholder until Phase 3.
- [x] 2.4 Partner writes: expenses, subscriptions, tasks (audited, archive only): lib/dal/partner-writes.ts, pages under /my-dashboard, tests/dal/partner-writes.test.ts
- [x] 2.5 Phase 2 report (below)

### Phase 3: employees, projects, pay, Team visible, chat (finished; waiting for approval)
- [x] 3.1 Employee invites (by partner and by admin): lib/dal/partner-employees.ts, /my-dashboard/team, Team invite form; tests/dal/employees.test.ts
- [x] 3.2 Project assignment and partner project management: lib/dal/partner-projects.ts, /my-dashboard/projects; tests/dal/partner-projects.test.ts
- [x] 3.3 Tasks for employees and the employee page: lib/dal/employee-work.ts, /work; tests/dal/employee-work.test.ts
- [x] 3.4 Pay records and cost under the stream (counted once): lib/dal/employee-pay.ts; tests/dal/employee-pay.test.ts
- [x] 3.5 Per-project "Team visible" (done with 3.2/3.3)
- [x] 3.6 Chat with the agreed visibility rules: lib/dal/scoped-chat.ts, /messages, /partners/chats; tests/dal/scoped-chat.test.ts
- [x] 3.7 Phase 3 report (below)

### Phase 4: shifts and admin Employees (not started)
- [ ] 4.1 Clock in and out, hours and shift history
- [ ] 4.2 Forgotten clock-out flag, logged corrections
- [ ] 4.3 Admin Employees list and per-employee pages
- [ ] 4.4 Phase 4 report

---

## Phase 1 report

### What changed

**New roles**
- Two new presets: **Stream partner** and **Employee**. Each holds only its own permission module (`stream_partner`, `employee`: view, create, edit; no delete, no export). They hold none of the older modules (transactions, payments, tasks, finances…), so every older page and query refuses them. A test calls eight of the older queries as each role and checks they are all refused.
- Stream partners must use two-factor (same rule as the old Partner). Employees may, but need not.
- The two presets are fixed. An admin can't edit them, can't give one of these people custom permissions, and can't give any other person these two modules by hand. The Permissions section of a stream partner's edit page says so.
- **The old Partner preset is untouched** (same name, same single "My earnings" module, still view-only, still 2FA). A test compares its rows to the original values.

**Streams and countries**
- On the **Invite a person** form, choosing the role "Stream partner" shows a list of streams and a list of countries. On the edit page ("Manage") a stream partner has a new "Streams and countries" section.
- A stream already owned by another partner is shown greyed out with that partner's name, and the server refuses it too. The database itself also refuses a second owner for a stream (so two admins clicking at the same moment can't both win; a test proves exactly one wins).
- A warning appears under the form when no country is chosen ("won't see any data until you assign at least one country"), and when a country is chosen but no stream.
- Every change is written to the audit log (action "Assigned", before and after, who did it). Saving without changing anything writes nothing. Changing a person's role away from Stream partner frees their streams and countries (also logged).
- Only an admin with two-factor done can do any of this. A partner cannot change their own streams, countries or permissions.

**The shared scoped-query helper (`lib/dal/scope.ts`)**
- The one place that decides which rows a Stream partner or Employee may touch. Rules built in:
  - Money rows (income, expenses, subscriptions): the row's stream **and** country must both be assigned. A row with no stream, or no country, never matches (so company-wide rows stay admin-only).
  - Projects and tasks: the stream must match (country is not compared, as you decided), and the partner must have at least one country, otherwise nothing.
  - A partner with streams but no countries, or countries but no streams, sees nothing.
  - A project the Owner hid from the partner disappears with everything filed under it (income, tasks).
  - Writes check the stream and country against the assignment on the server. A stream that doesn't exist and a stream that belongs to someone else give the identical "That no longer exists." answer, so guessing IDs tells nothing.
- The Actor (the signed-in person object) now carries the partner's streams and countries, loaded fresh on every request, so a change by an admin takes effect on the person's very next click.
- "What would this person see?" works for the new roles (it carries their scope and shows a plain-words note).
- Nothing reads company data for these roles yet (that begins in Phase 2). The only reader so far is the partner's own landing page, which shows just the names of their streams and countries, and goes through the helper. A test checks that file never touches a company table directly.

**Pages**
- `/my-dashboard` ("My dashboard"): shows the partner's streams and countries, or "Nothing to show yet" with the reason. `/work` ("My work"): an empty landing page for employees.
- Signing in or opening `/home` sends each role to its page. Search is not available to them. Every other page sends them to "no access" (tested for staff, old Partner, stream partner and employee).
- The Audit log page shows the new action and the two new record types in plain words.

### Migration summary (`drizzle/0013_stream_partners.sql`, not run anywhere real)
Only adds things; nothing is dropped or rewritten, and no existing row changes.
- 2 new tables: `stream_partner_streams` (primary key on the stream, so one partner per stream) and `stream_partner_countries`.
- New nullable columns: `stream_id` on `expenses`, `subscriptions` and `tasks`; `project_id` on `tasks`; `archived_at` on `expenses` and `tasks`. Every existing row gets NULL, so every existing row stays admin-only.
- 3 indexes for the new columns.
- The permission-module list (a database enum used in three tables) gains `stream_partner` and `employee`. This is the same kind of change as migration `0012` made for `partner`.
- 2 new rows in `role_presets` and 2 in `preset_permissions`.
- The normal deploy runs the existing automatic backup before migrating. I did not run it, and nothing was pushed or deployed.

### How to test it yourself, in plain words (on your local database only)
1. Start the local database and the app the way you normally do (`npm run db:local`, then `npm run dev`) and sign in as the Owner.
2. Go to **Team and permissions** and click **Invite person**. Choose the role **Stream partner**. A list of streams and countries appears. Tick one stream and one country, fill in a name and email, and send.
3. Open that person with **Manage**. Under "Streams and countries" you should see your ticks. Untick the country and save: you should see the message that they won't see any data until you give them a country.
4. Invite a second stream partner and try to tick the same stream: it should be greyed out with the first partner's name.
5. Open the **Audit log**. You should see "Assigned" rows for the streams and the countries, with before and after.
6. Open the first partner's invite link, set a password and two-factor, and sign in as them. You should land on **My dashboard**, which lists their stream and country. There should be no search box and no menu items except "My dashboard". Typing `/transactions` or `/team` in the address bar should show "no access".
7. Invite someone as **Employee**. After they sign in they land on **My work**, which is empty.
8. Sign in as an existing old-style **Partner**: they still land on **My earnings**, unchanged.
9. In **Team and permissions**, look at the Stream partner and Employee rows under "Role presets": they should say "Fixed" and have no Edit button.
10. As the Owner, open "What would this person see?" for a stream partner: you should see a note about stream-and-country matching.

### What I was unsure about
1. **Several rule changes in one commit.** Because the full test suite must pass before every commit and takes about 4 minutes, the Phase 1 code went in as one commit (`1195811`) instead of several tiny ones. Only the small audit-label change and this file are separate.
2. **Employee invites are possible now but pointless.** The Employee preset shows in the invite list today. An invited employee can sign in but is not tied to any partner or project yet (that arrives in Phase 3), so they see only the empty "My work" page. I left the preset in the list; tell me if you'd rather hide it until Phase 3.
3. **Archived rows.** The `archived_at` columns exist, but nothing writes them yet and the older lists and totals don't filter on them yet. That is deliberate and safe for now (no row can be archived), but it **must** be done in Phase 2 together with the first partner "archive" action, with the all-readers test from the plan. It is the first thing on my Phase 2 list.
4. **Stream on the admin forms.** The plan says the admin expense and subscription forms get a Stream field, so an admin can file a cost under a stream. I did not add it in Phase 1 (it changes existing finance screens). Until it exists, no expense or subscription is visible to any partner. I plan to add it at the start of Phase 2, and I would like your OK on touching those admin forms.
5. **The permission grid for custom roles** still lists the two new modules as rows (it lists every module). Ticking one is refused with a plain message ("can only come from those roles"), so it is safe, but a little confusing. I can hide those two rows from the grid in a small follow-up if you want.
6. **Deactivated partners keep their streams.** Deactivating a stream partner does not free their streams; an admin frees them by editing the partner's streams, or by changing their role. I did not change this automatically, because deactivation is meant to be reversible.
7. **Inactive streams** can still be assigned to a partner. I did not restrict this.
8. **Decision 6 from the plan is still unanswered** (can one person be both an old-style Partner and a Stream partner). I kept the working assumption: one role or the other.
9. **Windows line endings:** git prints "LF will be replaced by CRLF" warnings for the touched files. This already happens in this repo and does not change anything.

### Rules checked against this run
- Git identity `corenova-IT` passed with `git -c` on the commit; no push, no deploy, no force push.
- No secrets or database URL were printed (the only place a URL appeared was redacted on screen); only `.env.example` and `.env.local` were checked for names, not values.
- No migration was run against any real database; no data deleted (all new columns are NULL, "archive" only).
- The old Partner preset, other features and other branches were not changed. The website repo was not opened.
- Access rules are enforced on the server through `lib/dal/scope.ts` and `lib/dal/assignments.ts`; hiding buttons is not relied on (the UI hides the fields, and the server refuses the same requests).

## Phase 2 report

### What changed
**Older code**
- Archived expenses and tasks now drop out of every list, lookup, CSV export, total, team-progress figure, calendar entry and reminder (tests/dal/archived.test.ts walks each reader; the rows stay in the database).
- The admin Transactions (expense) and Payments (subscription) forms have a new **Stream** field, "Company-wide (no stream)" by default. Marking a subscription paid files the resulting expense under the same stream. Editing without touching the field leaves the stream alone. Changes show in the audit log.

**Stream partner: "My dashboard"** (`/my-dashboard`)
- Revenue (paid income only) per stream and overall, this month and all time; "still to come" (income not yet paid) shown separately; costs (expenses, which include paid subscriptions); net per stream and overall; subscriptions and renewals due soon (each shows its own currency and its base-currency value); open and overdue tasks and the next deadlines.
- All totals add base-currency values using the exchange rate stored on each row, never raw amounts in different currencies.
- Everything goes through the shared helper: a row counts only if its stream AND country are assigned (tasks: the stream, with at least one country); nothing archived; nothing under a project the Owner hid from them; nothing company-wide; nothing about other partners or the company's share.
- Three new pages for the partner to manage their own things: **Expenses**, **Subscriptions**, **Tasks** (`/my-dashboard/expenses`, `/subscriptions`, `/tasks`): add, edit, archive. The server checks the stream, country and project again, so a tampered form can't reach another stream. They can't enter income, change shares or hiding, or delete. No file attachments.
- "Delete" is an archive: an expense or task gets an archived date; a subscription becomes cancelled. Every add, edit and archive is written to the audit log.

**Admin: "Partners"** (`/partners`, `/partners/[id]`, admins only)
- List: name, streams, countries, revenue and profit for the chosen period (default this month), open tasks, payments due in 30 days, last active. Filters: stream, country, date range.
- Partner page: streams and countries, the same figures a partner sees, deadlines, upcoming subscriptions, task progress, and **Changes made** (what this partner added, edited or archived). Employees show as "later" until Phase 3.
- Uses the same rules as the partner's own view (shared in `lib/dal/scope.ts`), then removes whatever the Owner hid from the admin. "Changes made" only reads the partner's own changes to expenses, subscriptions, tasks and (later) projects; hiding and share records can never appear there. A person who isn't a stream partner gets the same "not found" as someone who doesn't exist.

### Migration summary
**None in Phase 2.** `0013` (from Phase 1) already added every column used. I did not check query plans on a large database, so I did not add the optional `0014` indexes. Nothing was run on any real database.

### How to test it yourself, in plain words (local database only)
1. As the Owner open **Transactions, Expenses, Add**. Choose the new **Stream** (e.g. Upwork) and a **Country** (not "Shared"), save. Do the same on **Payments** for a subscription due in the next few days. A row with no stream, or with "Shared" for country, stays admin-only on purpose.
2. In **Team**, make sure your test Stream partner has that stream and that country.
3. Sign in as the partner: **My dashboard** shows the stream, this month's revenue/costs/net (add an income entry as the Owner for that stream and country with status Paid to see revenue), the upcoming subscription and any open tasks. Use the **Expenses**, **Subscriptions** and **Tasks** buttons to add, edit and archive one of each. An archived item disappears.
4. Try to cheat: in the partner's forms the stream and country lists only contain theirs. (A tampered request is refused by the server; tests cover this.)
5. As the Owner open **Partners** in the admin menu: the partner appears with their figures. Click the name: you should see the same figures, and **Changes made** listing what they just did, with before and after.
6. As the Owner hide a project from that partner (Revenue streams, Projects) and confirm its income disappears from their dashboard but not from yours.
7. Open **Audit log**: partner actions show "Created / Changed / Archived".

### What I was unsure about
1. **Budgets.** The spec lists "budgets" on the dashboard, but the system has no budgets concept at all (no table or screen), so I showed none. I need your decision on what a budget is before I build it.
2. **Partner can't "mark a subscription as paid".** A subscription only becomes a cost when it is marked paid (that creates the expense). Partners can add expenses by hand, but have no "mark paid" button; the spec did not list one. Tell me if they should have it.
3. **Costs = expenses only.** Employee pay joins costs in Phase 3 (counted once, as decided).
4. **A partner's view and the admin's view can differ** in one case: if the Owner hid a project from the partner, the partner doesn't see it but an admin does (unless the Owner also hid it from that admin).
5. **Existing rows need both a stream and a country** before a partner sees them. "Shared" country rows never show to partners.
6. **Partner tasks have no assignee**, so no reminder emails or notifications are sent for them (partners have no notifications module). Admins see partner tasks in the normal Tasks page.
7. **No admin "unarchive"** yet, and archived items can no longer be opened by id even by an admin.
8. **The "Partners" menu item** shows to anyone who can open Team and permissions; a non-admin who clicks it gets "no access".
9. **Not checked in a browser.** Pages and forms are covered by tests and the type checker only; please click through them.
10. One earlier full test run had a one-off unexplained failure (see the run log); the full suite has been green since.

## Phase 3 report

### What changed
**Employees**
- The Employee role is now real. A **stream partner** invites employees from **My dashboard, My team** (always the Employee role, only for themselves, never anything higher). An **admin** can invite one from Team and permissions (the invite form asks "Works for" and lists stream partners), or move an employee to another partner. Each employee works for exactly ONE partner (the database enforces it). Every invite and assignment is logged. Someone who stops being an Employee leaves their partner and every project, and their pay stops.
- The Employee option is back in the Team invite list (it was hidden until now).

**Projects and "Team visible"** (`/my-dashboard/projects`)
- A partner sees, adds, renames and archives projects inside their own streams, and chooses which of their own employees are on each. Hiding, shares, deleting and the Owner's Projects page stay Owner-only; a project the Owner hid from the partner does not exist for them. Changes are logged as `partner_projects` (so admins see them on the partner's page).
- Per project **Team visible** (off by default): when on, people on it see each other's name and online status only.
- An admin can also set who is on a project (data layer only, no screen yet; see "unsure").

**Employee page** (`/work`)
- An employee sees only: their own tasks (and only in their partner's streams; a task in a project only while they are on it), the projects they are on (just the name), the name of their partner, and, on projects with Team visible switched on, the NAME and ONLINE status of the others. They can move their own tasks along (to do, in progress, review, done); every change is logged.
- Never any money, other streams or partners, other projects, other people's tasks, chats or hours (tests check this).
- Partners assign tasks to their own employees (one of theirs; if the task has a project, that employee must be on it).

**Employee pay, counted exactly once**
- Set by the partner OR an admin: a fixed monthly amount, or a fixed amount for one project, with currency and exchange rate stored. It always lands under one of the partner's own streams and countries (project pay uses the project's stream). Every set, change, stop and "mark paid" is logged and shows on the partner's page under "Changes made".
- Monthly pay creates one record per month, automatically and never twice; project pay is a cost only once marked paid, on the day it was paid; marking twice changes nothing.
- Pay lives only in its own tables and is never an expense row, so: the partner's costs and the admin Partners pages add expenses + pay (each once); company profit subtracts pay once on its own line (Home and Finances say "employee pay is on top"; the Finances CSV has an `employee_pay` column); the Finances expense list has none of it. A test builds an expense, a paid subscription, a monthly and a project pay record and checks all four places.
- Employees never see pay. A partner sees only their own employees' pay.
- The partner's team list shows each employee's cost this month; the admin partner page lists employees with their cost and has the same pay editor.

**Chat** (`/messages`, admin `/partners/chats`)
- Direct messages only. Allowed: employee with their own partner or any admin; partner with their own employees or any admin; an admin with any partner or employee. Everything else (partner to partner, employee to employee, employee to another partner) gives the same "That no longer exists." as someone who doesn't exist, and creates nothing.
- Partners and employees are never in #general or any channel, never appear in anyone's people list, and can't be reached through the older Team chat. The older chat code is untouched.
- An admin can start a conversation from a partner's page ("Message") and then use the normal Team chat. Admins can also read any conversation that includes a partner or employee that they are not in (Partner chats in the admin menu); every read is written to the audit log (who and when, never the messages). Conversations between two admins stay private and can't be opened there.
- If an employee moves to another partner, their old conversation with the old partner disappears for both of them (admins can still read it).

### Migration summary (`drizzle/0014_employees.sql`, a file only, never run on a real database)
Only adds things; no existing row changes. (Numbered 0014, not 0015 as the plan said, because Phase 2 needed no migration.)
- New tables: `employee_assignments` (primary key on the employee = one partner each), `project_members`, `employee_pay_plans`, `employee_pay_records` (unique on plan + period, so a month can't be created twice).
- New column: `projects.team_visible`, default off for every existing project.
- Indexes for the above. The normal deploy runs the automatic backup before migrating.

### How to test it yourself, in plain words (local database)
1. Run the local database and app. Apply the new migration the way you normally do on your **local** database (`npm run db:local` applies pending migrations and takes a backup first).
2. As a Stream partner (with a stream and a country): **My team, Invite an employee**. Also from the admin side: **Team, Invite person, Employee, choose "Works for"**.
3. As the partner: **Projects**: add a project, open it, tick the employee, switch **Team visible** on, save.
4. As the partner: **Tasks**: add a task, set **Assigned to** your employee (and the project).
5. Sign in as the employee (invite link): **My work** shows only that task and project; change the task's status. Add a second employee to the same project: with Team visible on, each sees the other's name and online dot; switch it off and they disappear. The employee should see no money anywhere.
6. As the partner: **My team**, open **Pay** on the employee, add monthly pay and a project pay; mark the project pay paid. **My dashboard** costs go up by the pay. As the Owner open **Partners, the partner**: employees and their cost, and **Changes made**. On **Home / Finances** profit goes down by the pay (it says "employee pay is on top"). **Transactions, Expenses** shows no pay rows.
7. **Messages**: the employee messages their partner or an admin; the partner replies. As an admin open **Partner chats**, read it; open the **Audit log**: a "Read" row appears. Try messaging between two employees or two partners: not possible.

### What I was unsure about
1. **Admin project assignment has no screen.** An admin can set who is on a project (and invite/assign employees), but only the partner has the project screen. Tell me if you want an admin screen.
2. **Hours** on the partner's employee list arrive in Phase 4 (with shifts); tasks, progress, online status and cost are there now.
3. **A project name that is "taken"** gives the same message whether a visible or an Owner-hidden project has it, so names of hidden projects can't be probed, but a partner can tell a name is unusable.
4. **Pay edits:** changing an amount applies from the next month that has no record yet (the month already created keeps its amount). Stopping keeps history. There is no "delete pay" (nothing is deleted).
5. **Company pay appears for people who can see ALL finances** (admins). Finance viewers limited to their own entries don't see pay in profit.
6. **Chat limits:** no file attachments, no editing or deleting messages, no live updates for partners and employees (they see new messages when they open or reload the page), no email or in-app notifications for them.
7. **Online status** is kept fresh as a partner or employee moves around the portal (not only on chat).
8. **Employee invites by a partner can't be re-sent** by the partner (an admin can use Resend invite). Partners also can't deactivate an employee (an admin does on the Team page).
9. **Not checked in a browser** (pages and forms are covered by tests and the type checker only).
10. **Budgets** were skipped as you decided; **unarchive** is still scheduled after Phase 4.

## Run log

### Run 1 (2026-11-18)
Read spec, plan and decisions. Created this file. Baseline: 367 tests passing. Built and tested Phase 1 (commit `1195811`: 395 tests passing). Added audit labels for the new action. Wrote the Phase 1 report and stopped at the approval gate.

### Run 2 (2026-11-18)
Recorded your four answers. Hid the Employee role until Phase 3 (picker + server refusal + test). Test status: typecheck clean; full suite **396 passed, 0 failed**. Note: one earlier full run of this same change showed 2 failures in 1 file that I did not capture; the new file passed alone (25/25) and a full re-run was green. I don't know the cause, so treat it as a possible flaky test. Phase 2 not started: still waiting for the line "Phase 1 approved by Umair".

### Run 3 (2026-11-18)
Phase 1 approved in chat by Umair ("approve the test 1 go for the second phase"); approval line recorded below. Did Phase 2 steps 2.0a and 2.0b (above). Then continued: 2.1 to 2.4 built and tested; Phase 2 report written; stopped at the approval gate.

Phase 1 approved by Umair

### Run 4 (2026-11-19)
Recorded your answers to the Phase 2 questions. Built partner "Mark as paid" for subscriptions in their own streams (logged, tests added). Full suite: 447 passed, 0 failed. Phase 3 not started: waiting for the line "Phase 2 approved by Umair".

Phase 2 approved by Umair

### Run 5 (2026-11-19)
Phase 2 approved in chat by Umair; approval line recorded. Phase 3 started. 3.0 migration file drizzle/0014_employees.sql (employee_assignments, project_members, projects.team_visible, employee_pay_plans, employee_pay_records; additive only, not run anywhere real; numbered 0014 because Phase 2 needed no migration). 3.1 employee invites by partner and by admin done (tests/dal/employees.test.ts). Full suite 458 passed.
Built and tested all of Phase 3 (employee invites, projects with Team visible, employee page and tasks, pay counted once, scoped chat) and wrote the Phase 3 report. Full suite 513 passed. Stopped at the approval gate: Phase 4 starts only after "Phase 3 approved by Umair".
