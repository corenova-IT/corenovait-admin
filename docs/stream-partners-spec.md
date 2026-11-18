# Stream partners, employees and admin overview

EXISTING (confirm in code)
- Owner (flag on one admin): only the Owner sees and changes projects, hidden-from lists, partner shares, the Owner overview and "What would this person see?". Admins never see what the Owner hides from them. Nobody can demote, deactivate or reset the Owner.
- Admin: full module access except Owner-hidden items.
- Roles are presets with a module x action matrix and scope (own, assigned, all).
- Existing Partner preset (only "My earnings", 2FA, no Home/search): keep exactly as is.
- Income entries are entered by finance users (date, stream, country, client, amount, currency, FX, optional project and invoice) and converted to base currency. Partner shares and commission are earned when an entry is paid.
- Streams, countries, projects (under a stream). Expenses and subscriptions are not tied to streams or projects. Tables for chat, user_presence, tasks, audit_log, notifications exist.

NEW ROLES
- "Stream partner" (new preset), e.g. Hamza (Upwork, Fiverr, others) and Andrew (AUS market).
- "Employee" (new preset): hired person who logs in.

STREAM PARTNER RULES
- Admin assigns each partner streams AND countries (invite form and user edit page; changeable later; every change logged in audit_log).
- A partner sees data only if it matches an assigned stream AND an assigned country. No countries assigned = no data. Warn the admin in the form.
- One stream belongs to at most one partner. Block assigning a stream that already has a partner.
- A partner never sees other partners, other streams, company totals, or Owner-hidden items. No global search outside their scope.
- A partner can add and edit tasks, subscriptions, expenses and projects in their own streams, and invite and manage their own employees. A partner cannot enter income entries, change partner shares, or change their own streams, countries or permissions.
- Every add, edit and archive by a partner is written to audit_log and shown to the admin on that partner's page ("Changes made"). Deletes are archives.
- Partners need 2FA.
- Projects are currently Owner-only. Change carefully so a partner can see and manage projects inside their own streams only, never partner shares or Owner-hidden items. State exactly what changes.
- Partner dashboard ("My dashboard"): revenue per stream and overview across all streams, costs (subscriptions, expenses, employee pay), net per stream and overall, upcoming subscriptions and renewals, open and overdue tasks, deadlines, budgets, and their employees (tasks, progress, online status, hours, cost). Show currency and base-currency value; never add currencies without the stored FX rate. Never show the company's share or anything about other partners.

EMPLOYEE RULES
- One employee works for ONE partner and is assigned to specific projects in that partner's streams.
- Employee sees only: own tasks and deadlines, assigned projects, own clock-in/out and hours, chat with their partner and the admin.
- Employee never sees any cost, income, subscriptions, other partners, other streams, or projects they are not on.
- Per-project option set by the partner: "Team visible" (off by default). When on, employees on that project see each other's name and online status only (never tasks, chats, hours or costs).
- A partner can invite employees only as the Employee preset, only into their own streams and projects, never with more permission than Employee. The admin can also invite employees and assign them to any partner. All invites are logged.
- Pay: fixed monthly amount or fixed amount per project (currency stored). Counts as a cost under that partner's stream. Monthly pay is a cost each month; project pay is a cost when marked paid. Cost visible only to the admin and that employee's partner.
- Shifts: clock in and clock out; hours worked, history, online status from user_presence. Flag forgotten clock-outs after a configurable time; partner or admin can correct; every correction is logged.
- Chat: employee <-> their partner and the admin. The admin can see all chats. Partners can read only chats with their own employees, never other partners' chats.

ADMIN PAGES (admin and Owner; respect Owner-hidden items)
- "Partners": list of names; click a name for that partner's page with streams and countries, revenue per stream and overall, costs, profit, deadlines, upcoming subscriptions, task progress, employees and their cost, and the "Changes made" log. List columns: name, streams, countries, revenue this month, profit this month, open tasks, upcoming subscriptions, last active.
- "Employees": list of names; click a name for partner, projects, tasks and progress, deadlines, shifts and hours, online status, and cost.
- Filters on both lists: stream, country, partner, date range.

PHASES
1. Streams and countries assignment, new roles, the shared scoped-query helper used by every page, migration, access tests.
2. Partner dashboard and the admin Partners pages.
3. Employee invites, projects, tasks, pay records, Team visible option, chat.
4. Clock in/out, hours, and the admin Employees pages.

ACCESS RULES (every phase)
- Enforce on the SERVER for every read and write via one shared scoped-query helper. Never rely on hiding buttons.
- Guessing another stream's or user's ID returns 404/403. A user with no assignments sees nothing.
- Tests: partner A cannot read or change partner B's data; stream AND country matching (no countries = nothing); one stream one partner; employees see only their projects; Team visible on/off; cost hidden from employees; partners cannot invite above Employee; the old Partner preset is unchanged; the admin sees everything except Owner-hidden items.

GENERAL RULES
- Git branch, corenova-IT identity, small commits, never force push.
- Never print secrets or the database URL. Use .env only.
- No migrations on the live database and no deploy until I review. Test on a local or empty database.
- No data deletion; archive. Existing rows stay admin-only until assigned.
- Keep the panel's design and wording. Mobile friendly.
- After each phase: what changed, migration summary, step-by-step test instructions in plain words, and what you were unsure about.
