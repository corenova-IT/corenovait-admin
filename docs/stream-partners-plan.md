# Stream partners, employees and admin overview: plan

Status: PLAN ONLY, with the owner's answers to section 8 recorded below. No feature code, no migrations run, nothing deployed or pushed.

## Decisions (answers received)

1. Projects and tasks match on **stream only** (a partner with no countries still sees nothing).
2. Narrower admin chat oversight **accepted**: an admin may read only chats that include a stream partner or employee; every read is logged; admin-to-admin DMs stay private.
3. **Both** the partner and the admin can set employee pay. Every change is logged and visible to the admin.
4. Employee pay stays **out of the Finances expenses list**, but is **counted exactly once** in each partner's costs and in company profit. A test proves it (see C10 and section 5).
5. Partner writes for expenses, subscriptions and tasks in **Phase 2**; projects and employees in **Phase 3**.
6. **Not answered** (the reply still contained the template text). Working assumption until you say otherwise: **no, one role or the other for now**. This is the safe default and is easy to loosen later.
7. Revenue = **paid income only**; pending income is shown separately.
8. **No file attachments** for stream partners and employees for now.
Branch: `feature/stream-partners` (from `feature/owner-overview` at `d451248`, which equals `main`).
Spec: [stream-partners-spec.md](stream-partners-spec.md) (saved exactly as given).
Baseline: 367 tests pass on the three finished revenue-privacy phases.

---------------------------------------------------------------------------

## 0. What I confirmed in the code (the spec's "EXISTING" list)

| Spec says | Code says | Verdict |
|---|---|---|
| Owner is a flag on one admin | `users.is_owner`, effective only with the admin preset (`lib/dal/auth.ts`); `requireOwner` in `guard.ts` | Confirmed |
| Only the Owner sees/changes projects, hidden-from, partner shares, overview, preview | Every function in `lib/dal/projects.ts`, `overview.ts`, `preview.ts` starts with `requireOwner` | Confirmed |
| Admins never see what the Owner hides from them | `incomeVisible` and `auditVisible` (`lib/dal/visibility.ts`) remove hidden projects' income rows and their audit rows for everyone but the Owner | Confirmed, but **income and its audit rows only**. Expenses, subscriptions and tasks have no hiding today (see conflict C7) |
| Nobody can demote, deactivate or reset the Owner | `guardOwner` in `team.ts`: other admins are refused; the Owner can't demote or deactivate themselves; the Owner can't reset their own 2FA in the portal (an operator script does it) | Confirmed |
| Roles are presets, module x action matrix, scope own/assigned/all | `role_presets`, `preset_permissions`, `user_permissions` (a per-user copy of the preset), `scopeWhere` in `guard.ts` | Confirmed |
| Existing Partner preset: only "My earnings", 2FA, no Home/search | Migration `0012`: preset `partner`, single module `partner`, view only, scope own; 2FA forced because `partner` is in `PRIVILEGED_MODULES`; `/home` redirects it to `/partner`; `/search` redirects to no-access | Confirmed. **Name clash** with the new preset (conflict C1) |
| Income entered by finance users, converted to base currency, shares/commission earned when paid | `createIncome` needs `transactions:create`; `amount_base_minor` is a stored generated column; `income_shares` + commission count only `status='paid'` | Confirmed |
| Expenses and subscriptions are not tied to streams or projects | Confirmed: `expenses` and `subscriptions` have only an optional `country_code`, no stream, no project | Confirmed |
| Tables for chat, user_presence, tasks, audit_log, notifications exist | Confirmed (`chat_channels`, `chat_members`, `chat_messages`, `user_presence`, `tasks`, `task_comments`, `audit_log`, `notifications`) | Confirmed |

---------------------------------------------------------------------------

## 1. Where the spec conflicts with how the panel works today

Each item: what happens today, then my proposed fix. The ones marked **ASK** need your decision before I build.

**C1. The word "partner" is already taken.** Today "Partner" is a preset, a permission module (`partner`), a page (`/partner`, "My earnings"), a table (`project_partners`) and a kind of representative. The spec adds a second, different "partner".
Fix: keep everything existing as is. New names: preset ids `stream_partner` and `employee`, permission modules `stream_partner` and `employee`, pages `/my-dashboard` (stream partner) and `/work` (employee), admin pages `/partners` and `/employees`. In the UI the new role reads "Stream partner" and the old one stays "Partner". A test proves the old preset's rows are byte-for-byte unchanged.

**C2. The permission matrix can't say "stream AND country".** Scope today is only own / assigned / all, tied to who created a row or who it's assigned to.
Fix: the matrix still decides *which actions* (view/create/edit) on the *new modules*, and a new assignment layer decides *which rows*: tables `stream_partner_streams` and `stream_partner_countries`. A new file `lib/dal/scope.ts` (the shared scoped-query helper, section 3) is the only way the new roles read or write anything.

**C3. Danger: reusing existing modules would leak.** If a stream partner were given `payments`, `tasks` or `transactions` view, every existing function (written for company-wide data with scope own/assigned/all) would return rows outside their streams.
Fix: stream partners and employees get **none of the existing modules**. Every existing `requirePerm(actor, "payments"|"transactions"|"tasks"…)` then refuses them by default. They get only the new modules, and those are read only by new scoped functions. Added defence: custom permissions can't be edited for these two roles (like `LOCKED_PRESETS` today), so an admin can't hand a partner `transactions` by accident.

**C4. Rows have no stream, so "matches a stream AND a country" has nothing to match.**
- `expenses`, `subscriptions`: no stream (country optional).
- `tasks`: no stream, no project, no country.
- `projects`: a stream, no country.
Fix:
- Add nullable `stream_id` to `expenses` and `subscriptions`; add `stream_id` and `project_id` to `tasks`.
- **Money rows (income, expenses, subscriptions): a partner sees a row only if stream AND country both match.** A row with no country (today's "shared cost") never matches, so it stays admin-only.
- **Non-money rows (projects, tasks): the stream must match**, and the partner must have at least one country assigned (otherwise nothing at all, per the spec). Projects and tasks have no country to compare, so I do not invent one.
- All existing rows keep `stream_id = NULL`, so they stay admin-only until an admin assigns them (the admin expense and subscription forms get a Stream field).
**Decided (1):** projects and tasks need the stream only (plus the "at least one country" gate).

**C5. Chat: "the admin can see all chats" contradicts a rule built on purpose.** Today nobody, admins included, can read a conversation they aren't in (`SECURITY.md`: "Admins can't read DMs they aren't in"; the code says "no admin override"). Also `#general` automatically adds every active user, and `chatPeople` lists everyone with chat access, so an employee or partner would see every other partner's name.
Fix:
- Scoped roles are never auto-joined to `#general` and never appear in other people's pickers. A DM involving a scoped role is allowed only between employee and own partner, employee and any admin, partner and own employee, partner and any admin.
- Admin oversight is narrow: an admin may read only conversations that include at least one stream partner or employee. Admin-to-admin DMs stay private. Every such read writes an `audit_log` row and the conversation header says "Admins can read this conversation".
**Decided (2):** accepted. Admin-to-admin DMs stay private, every oversight read is logged.

**C6. "Deletes are archives" but today tasks, subscriptions and income are hard-deleted.** There is no `archived_at` on tasks or expenses.
Fix: add `archived_at` (nullable) to `tasks` and `expenses`. Partners can only archive, never delete (their roles don't get the `delete` action at all). Subscriptions already have a `cancelled` status, which I reuse as "archived". **Risk:** every existing read of tasks and expenses must then exclude archived rows, including company totals. Only four files read `expenses` (`finance.ts`, `analytics.ts`, `payments.ts`, `lists.ts`) and two read `tasks` (`tasks.ts`, `notifications.ts`), so this is small, and a test will walk every read path (see section 5).

**C7. Hiding (the Owner's "hidden from" list) only hides income today, and the spec wants "never Owner-hidden items" for partners.**
Fix: for a stream partner, a project hidden from them disappears entirely: its income, the project itself, and tasks filed under it, in lists and in every total. This is the same "remove only, never add" rule as today. No change to how admins see hiding.

**C8. Projects are Owner-only today; a partner must manage projects in their own streams.** Every function in `projects.ts` calls `requireOwner`.
Exactly what changes (Phase 3):
- **Stays Owner-only, unchanged:** hide-from lists, partner shares (`project_partners`), "apply shares to existing entries", delete, and the Owner's projects page.
- **New, for stream partners, own streams only:** see projects, create, rename, archive (switch off), invite employees onto a project, and set "Team visible". They can never see or change shares or hidden-from lists, and never see a project hidden from them.
- **Also new:** the admin's "Partners" page can show a partner's projects.
- Archive reuses `projects.active`. Partner project changes are written to the audit log under the entity name `partner_projects` rather than `projects`, because `auditVisible` deliberately hides every `projects` row from non-Owner admins. That keeps the Owner-only rows hidden and lets admins see the partner's changes with no change to the hiding code.

**C9. "Changes made" log versus the audit log's own visibility rules.** Admins who aren't the Owner can't see audit rows about hiding or shares, and must not start to. The "Changes made" log reads audit rows by `actor_id = this partner` limited to an allow-list of entities (`expenses`, `subscriptions`, `tasks`, `partner_projects`, `users` for invites), filtered through the existing `auditVisible`. Nothing about hiding or shares can appear in it.

**C10. Employee pay "counts as a cost under that partner's stream", but an employee can work in several streams, and pay has no country.**
Fix: every pay record carries one `stream_id` (chosen when set; project pay uses the project's stream) and a `country_code`, so it can follow the same stream AND country rule as other costs. Currency and the FX rate to base are stored on each record (same `money` columns as expenses). Monthly pay creates one record per month (idempotent), shown as a cost for that month; project pay becomes a cost when marked paid.
**Decided (3):** both the partner and the admin can set pay; the employee sees nothing about it. Every create, change and stop writes `audit_log` (before/after) and shows on the admin's Partner and Employee pages.
**Decided (4):** employee pay lives in its own tables and is **not** a row in the Finances expenses list. To keep it counted exactly once:
- One single source: `employee_pay_records`. A pay amount is never also written as an `expenses` row, so it cannot be counted twice.
- One shared function (in `lib/dal/scope.ts`'s costs helper) returns a partner's total costs as `expenses + subscriptions paid + employee pay`, and every screen that shows a partner's costs, net or profit calls it (partner dashboard, admin Partners list and detail, admin Employees).
- **Company profit** (the Finances page and Owner overview) must still subtract pay once. Today those pages only know `expenses`, so they get one extra, separate "Employee pay" line fed by the same pay records. The expenses *list* stays pay-free; the profit figure shows the extra line so it still reconciles. This touches `analytics.ts` and `overview.ts`, which I list as a risk below.
- Test: create an expense, a subscription payment, a monthly pay record and a project pay record; assert that each partner's costs, the company profit, and the company-wide total each equal the sum with every item counted once, and that the Finances expenses list contains none of the pay.

**C11. Hours need history; `user_presence` only keeps one "last seen" time per person.** It is fine for the online dot, not for hours worked.
Fix (Phase 4): a new `shifts` table (clock in, clock out, who corrected it). Online status keeps using `user_presence`.

**C12. Files and receipts.** `files.module` is an enum tied to the existing modules, and downloads check those. A partner has none of those modules, so receipts/invoices on partner-entered expenses would be unreadable or, worse, need a hole.
Fix: no file attachments for stream partners or employees in these four phases. Admins keep theirs. Listed as an open limitation.

**C13. The existing search, calendar and notifications assume company-wide modules.** Search and Calendar require `home` / `calendar` modules the new roles don't have, so they get neither (matches "no global search outside their scope"). Task and payment deadlines appear on the new dashboards instead. The notification scheduler targets the assignee or responsible person, so it doesn't leak; a test checks it.

**C14. Spec leaves two build-order gaps.** The four phases don't say when partners can add expenses, subscriptions and tasks.
Proposal: Phase 2 includes partner create/edit/archive of **expenses and subscriptions** (they feed the dashboard costs) and **tasks** in own streams. Phase 3 adds **projects** and employees. **Decided (5):** partner writes for expenses, subscriptions and tasks in Phase 2; projects and employees in Phase 3.

**C15. A person can be both a stream partner and an old-style revenue partner.** Hamza could have a share on a project (`project_partners`) *and* run the Upwork stream. These are separate things: the stream dashboard shows the stream's revenue, costs and net (spec); the existing "My earnings" shows a share. A login has one preset, so one person gets one or the other. **Open (6):** no answer yet. Working assumption: one or the other for now. If you later want both, I'd add a "My earnings" link on their dashboard rather than merge them.

---------------------------------------------------------------------------

## 2. Tables to add or change (all additive; nothing is dropped or rewritten)

Migrations are numbered after `0012`. None runs on the live database until you review.

### Phase 1: `0013_stream_partners.sql`
- Extend the `module` enum in `files`, `preset_permissions`, `user_permissions` with `stream_partner` and `employee` (same pattern as `0012`).
- `role_presets`: `stream_partner` ("Stream partner", sort 37) and `employee` ("Employee", sort 38), with `preset_permissions`:
  - `stream_partner` module: view, create, edit (no delete, no export); 2FA forced (module added to `PRIVILEGED_MODULES`).
  - `employee` module: view, create, edit; 2FA optional.
  - Nothing else on either preset.
- `stream_partner_streams (stream_id PK -> streams, user_id -> users, assigned_by, created_at)`. The primary key on `stream_id` is what makes "one stream, at most one partner" true even under two simultaneous admin clicks.
- `stream_partner_countries (user_id, country_code, PK both)`.
- `expenses.stream_id`, `subscriptions.stream_id`: nullable FK to `streams`, plus index on `(stream_id, country_code)`.
- `tasks.stream_id`, `tasks.project_id`: nullable FKs, index on `stream_id`.
- `tasks.archived_at`, `expenses.archived_at`: nullable datetimes.

### Phase 2: `0014_partner_dashboard.sql` (small)
- Index additions only if the dashboard queries need them (decided against real query plans). No new tables expected.

### Phase 3: `0015_employees.sql`
- `employee_assignments (employee_user_id PK -> users, partner_user_id -> users, created_by, created_at)`: the PK enforces one partner per employee.
- `project_members (project_id, user_id, PK both)`: which employee is on which project.
- `projects.team_visible boolean not null default false`.
- `employee_pay_plans (id, employee_user_id, kind 'monthly'|'project', stream_id, country_code, project_id nullable, amount_minor, currency, fx_rate_to_base, active, created_by, ...)`.
- `employee_pay_records (id, plan_id, period 'YYYY-MM' or project_id, stream_id, country_code, amount_minor, currency, fx_rate_to_base, amount_base_minor generated, status 'due'|'paid', paid_date, ...)`, unique on `(plan_id, period)` so monthly generation can't double up.
- Chat: no new table; behaviour changes only (section 4).

### Phase 4: `0016_shifts.sql`
- `shifts (id, user_id, clock_in_at, clock_out_at null, corrected_by null, corrected_at null, flagged_at null, note, ...)`, one open shift per person (enforced in the same transaction).
- `settings.shift_flag_hours smallint not null default 12` (the "configurable time").

---------------------------------------------------------------------------

## 3. The shared scoped-query helper: `lib/dal/scope.ts`

One file, imported by every new DAL function (and a test makes sure of it).

- `Actor` gains `scoped: null | { kind: "stream_partner"; streamIds: number[]; countryCodes: string[] } | { kind: "employee"; partnerUserId: string; projectIds: string[] }`, loaded in `resolveSession` and `previewActorFor` (so "What would this person see?" works for the new roles). `issueActor` stays the only constructor and still lives only in `auth.ts`.
- Helpers (names provisional):
  - `partnerScope(actor)`: throws unless the caller is a stream partner; returns streams and countries; **if either list is empty it returns "nothing"** (the "no countries = no data" rule lives here, once).
  - `moneyRowsWhere(cols)`: SQL `stream_id IN (…) AND country_code IN (…)`.
  - `streamRowsWhere(cols)`: SQL `stream_id IN (…)` plus the "has at least one country" gate.
  - `notHiddenFrom(actor, projectCol)`: reuses `incomeVisible`'s hidden-project subquery so Owner-hidden items are removed (C7).
  - `assertStreamAllowed(actor, streamId)` / `assertCountryAllowed(...)`: for writes.
  - `employeeProjectsWhere(...)`: the employee's own project ids only.
  - `NotFound`: a new error that pages turn into `notFound()` (404) and actions turn into a plain "That no longer exists." Missing and not-yours look identical, so guessing IDs tells an attacker nothing.
- Writes never trust form fields: stream and country are checked against the caller's assignment on the server, and `created_by`/owner are set from the session.
- A boundary test (like `boundaries.test.ts`) fails if a new scoped DAL file queries `income_entries`, `expenses`, `subscriptions`, `tasks` or `projects` without going through `scope.ts`.

---------------------------------------------------------------------------

## 4. Pages and permission rules, by phase

Design and wording: reuse the existing components (`PageHeader`, `Card`, `StatCard`, `Pill`, tables, `RevenueTabs`-style tabs). Mobile friendly, as the rest of the panel.

### Phase 1: assignment, roles, helper, migration, access tests
- Team invite form and the user edit page: for a Stream partner, a multi-select of **streams** (streams already owned by another partner are shown disabled with that partner's name and are rejected on the server) and **countries**; a warning under the form when no country is chosen ("This partner won't see any data until you assign a country").
- Server rules: only an admin with 2FA done can assign; each change writes `audit_log` (`stream_partner_streams`, `stream_partner_countries`) with before/after; the Owner's hiding rules are untouched.
- `/home` for both new roles redirects to their landing page (`/my-dashboard` placeholder in Phase 1, `/work` placeholder); search hidden, as for the old Partner.
- `setPermissions` refuses stream partners and employees (C3).
- No partner-facing data yet, so Phase 1 ships only the empty landing pages. That is deliberate: it proves nothing leaks before there is anything to leak.

### Phase 2: partner dashboard and admin "Partners"
- `/my-dashboard` ("My dashboard"): revenue per stream and overall; costs (subscriptions, expenses, employee pay once Phase 3 lands); net per stream and overall; upcoming subscriptions and renewals; open and overdue tasks and deadlines; budgets; employees panel (Phase 3/4 fills it). Each amount shows its currency and base value; totals only ever add base-currency values using the stored FX rate; never the company share, never other partners.
- Partner can create/edit/archive **expenses, subscriptions and tasks** in their own streams (and countries for money rows). All audited.
- Admin `/partners` list (name, streams, countries, revenue this month, profit this month, open tasks, upcoming subscriptions, last active) with filters stream, country, date range; click a name for the partner page: streams/countries, revenue per stream and overall, costs, profit, deadlines, upcoming subscriptions, task progress, employees and their cost, and "Changes made". All of it honours the Owner's hidden items.
- Admin-only: `requireAdmin` plus hidden-item filtering; partners get 404/403 on those URLs.

### Phase 3: employees, projects, tasks, pay, Team visible, chat
- Partner: `/my-dashboard/team` to invite employees (preset fixed to Employee, streams and projects only inside their own, can never be higher than Employee; admin can also invite and assign to any partner; every invite logged), `/my-dashboard/projects` for projects in own streams (create, rename, archive, "Team visible" switch, assign employees).
- Employee: `/work`: own tasks and deadlines, assigned projects, chat. Never any cost, income, subscription, other partner, other stream or project they aren't on. If "Team visible" is on for a project, employees on it see each other's **name and online dot only**.
- Pay: partner/admin set monthly or per-project pay; costs flow into the partner's net; employee never sees it.
- Chat: rules from C5.

### Phase 4: shifts and admin "Employees"
- Employee clock in/out button, own hours and history; partner and admin see their employees' shifts and hours, can correct a shift (every correction logged with who and why); a forgotten clock-out is flagged after `shift_flag_hours`.
- Admin `/employees` list and detail (partner, projects, tasks and progress, deadlines, shifts and hours, online status, cost), filters stream, country, partner, date range.

---------------------------------------------------------------------------

## 5. Tests (written with each phase, against a real MySQL like the existing suite)

Every item from the spec's access rules, plus the leaks I'd worry about:
- Partner A cannot read or change partner B's data (income, expenses, subscriptions, tasks, projects, employees, shifts, chat), including by guessing IDs: expect 404/403 and an identical answer for "doesn't exist" and "isn't yours".
- Stream AND country matching on money rows; no countries assigned = nothing; stream-only matching on projects and tasks with the country gate.
- One stream, one partner, including two simultaneous assignments (database enforces it).
- Employee sees only their projects; Team visible on/off (names and online only, never tasks, chats, hours or costs); cost hidden from employees; partners can't invite above Employee or outside their streams.
- The old Partner preset's rows and behaviour are unchanged (snapshot test of `role_presets` / `preset_permissions` for `partner`).
- Admin sees everything except Owner-hidden items; non-Owner admins never see hiding or share audit rows in "Changes made".
- Owner-hidden project: gone from the partner's lists, totals, tasks and dashboard.
- Archived expenses and tasks are excluded from every read path (a walk over each reader, like `revenue-privacy.test.ts`).
- Every new server action does its permission check **before** reading the form (the existing `routes.test.ts` convention), and every new page redirects a staff user to no-access.
- A boundary test that scoped DAL code only reads company tables through `scope.ts`.
- Chat: scoped roles never in `#general`, can't open a DM outside the allowed pairs, admin oversight read is logged.
- Presets can't be hand-edited for these two roles.
- **Employee pay counted exactly once** (decision 4): with one expense, one paid subscription, one monthly pay record and one project pay record, each partner's costs, the company profit and the company-wide cost total equal the sum with each item once; the Finances expenses list contains no pay; marking a pay record paid twice, or generating a month twice, changes nothing.
- Revenue is paid income only: a pending entry shows only in the "pending" figure (decision 7).
- Pay changes by either the partner or the admin write an audit row visible on the admin's pages (decision 3).
- 2FA required for stream partners.

---------------------------------------------------------------------------

## 6. Risks

1. **Leak through existing code (highest).** Mitigated by C3: the new roles hold no existing module, so old code refuses them, plus the boundary and route tests.
2. **Archived rows leaking into company totals** (C6). Mitigated by the all-readers test; small blast radius (4 files).
3. **Chat privacy change** (C5): the one place the spec weakens an existing deliberate rule. Needs your decision (ASK 2).
4. **Money across currencies.** The dashboard must never add raw amounts of different currencies. All sums use `amount_base_minor` (stored FX rate); anything lacking a stored rate is not summed (it can't be: the column is required and positive).
5. **Hours and time zones.** Shifts are stored in UTC and shown in the company time zone; "this month" uses the company time zone like the rest of the panel.
6. **Performance of the admin list pages.** Per-partner revenue/profit/open-task counts are aggregated queries; I'll check the plans and add indexes in `0014` if needed.
7. **Hostinger's 120-process limit.** The new migrations are quick additive ones, but each push triggers one build; I will not push without your say-so, and I'll batch phases sensibly.
8. **Company profit changes** (decision 4): `analytics.ts` and `overview.ts` get an extra "Employee pay" line so profit subtracts pay once while the expenses list stays pay-free. Mitigated by the counted-once test above and by leaving every existing figure unchanged when there are no pay records.
9. **Staying on the shared design.** No new design system; new screens reuse existing components.

---------------------------------------------------------------------------

## 7. Migration summary

| Phase | File | Adds | Touches existing rows? |
|---|---|---|---|
| 1 | `0013_stream_partners.sql` | 2 enum values, 2 presets, 2 assignment tables, `stream_id` on expenses/subscriptions/tasks, `project_id` on tasks, `archived_at` on tasks/expenses | No. New columns are NULL for every existing row (so they stay admin-only). Enum change follows the `0012` pattern. |
| 2 | `0014_partner_dashboard.sql` | Indexes only, if needed | No |
| 3 | `0015_employees.sql` | `employee_assignments`, `project_members`, `projects.team_visible`, `employee_pay_plans`, `employee_pay_records` | No (`team_visible` defaults off) |
| 4 | `0016_shifts.sql` | `shifts`, `settings.shift_flag_hours` | No |

All migrations are tested on a fresh, throwaway MySQL (the existing test setup) and on the local sample database. The deploy runs the existing automatic pre-migration backup (`scripts/migrate.mjs`), which already refuses to migrate without a backup. Nothing is run against the live database by me.

---------------------------------------------------------------------------

## 8. Decisions and what is still open

See "Decisions (answers received)" at the top. Effects on the build:
- **Revenue (7):** every dashboard and admin list shows revenue = paid income only, with a separate "pending" figure beside it. "Profit this month" = paid revenue minus costs for the month.
- **Attachments (8):** no upload fields for stream partners and employees (C12).
- **Chat (2):** C5 applies as written.
- **Open (6):** one person gets one role, not both, until you say otherwise.

Next: Phase 1 in a new session, stopping for your review at the end of each phase.
