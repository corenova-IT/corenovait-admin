import { emptyPermMap, type PermMap } from "@/lib/permissions";
import type { Member, Preset } from "@/components/team/types";
import type { AuditRow } from "@/components/audit/AuditTable";
import { NAV } from "@/lib/nav";

/** Obviously fake people and events for the dev-only design preview. */
function perms(spec: Record<string, Partial<PermMap[keyof PermMap]>>): PermMap {
  const m = emptyPermMap();
  for (const [k, v] of Object.entries(spec)) Object.assign(m[k as keyof PermMap], v);
  return m;
}
const full = { view: true, create: true, edit: true, delete: true, export: true, scope: "all" as const };
const adminPerms = perms(Object.fromEntries(Object.keys(emptyPermMap()).map((k) => [k, full])));
const staffPerms = perms({
  home: { view: true, scope: "own" },
  tasks: { view: true, create: true, edit: true, scope: "assigned" },
  calendar: { view: true, create: true, edit: true, scope: "assigned" },
  chat: { view: true, create: true, edit: true, scope: "assigned" },
});
const managerPerms = perms(
  Object.fromEntries(
    ["home", "finances", "transactions", "payments", "streams", "countries", "representatives", "marketing", "calendar", "tasks", "chat"].map((k) => [
      k,
      { view: true, create: true, edit: true, delete: ["calendar", "tasks", "chat", "marketing"].includes(k), export: k !== "chat", scope: "all" as const },
    ])
  )
);

export const previewMembers: Member[] = [
  { id: "00000000-0000-4000-8000-000000000001", email: "admin.one@example.test", name: "Alex Example", jobTitle: "Co-founder", presetId: "admin", status: "active", mfaRequired: true, mfaEnabled: true, lockedUntil: null, lastSignIn: "2026-10-25T08:00:00Z", perms: adminPerms },
  { id: "00000000-0000-4000-8000-000000000002", email: "admin.two@example.test", name: "Blair Sample", jobTitle: "Co-founder", presetId: "admin", status: "active", mfaRequired: true, mfaEnabled: false, lockedUntil: null, lastSignIn: "2026-10-24T08:00:00Z", perms: adminPerms },
  { id: "00000000-0000-4000-8000-000000000003", email: "web.dev@example.test", name: "Casey Demo", jobTitle: "Web developer", presetId: "staff", status: "active", mfaRequired: false, mfaEnabled: false, lockedUntil: null, lastSignIn: "2026-10-25T07:00:00Z", perms: staffPerms },
  { id: "00000000-0000-4000-8000-000000000004", email: "design@example.test", name: "Devon Placeholder", jobTitle: "Designer", presetId: "manager", status: "active", mfaRequired: false, mfaEnabled: true, lockedUntil: null, lastSignIn: "2026-10-22T07:00:00Z", perms: managerPerms },
  { id: "00000000-0000-4000-8000-000000000005", email: "marketing@example.test", name: "Emery Test", jobTitle: "Marketing", presetId: "staff", status: "invited", mfaRequired: false, mfaEnabled: false, lockedUntil: null, lastSignIn: null, perms: staffPerms },
  { id: "00000000-0000-4000-8000-000000000006", email: "former@example.test", name: "Frankie Fixture", jobTitle: "Contractor", presetId: "custom", status: "deactivated", mfaRequired: false, mfaEnabled: false, lockedUntil: null, lastSignIn: "2026-09-01T07:00:00Z", perms: staffPerms },
];

export const previewPresets: Preset[] = [
  { id: "admin", name: "Admin", description: "Full control, including team, settings and the audit log. Two-factor required.", perms: adminPerms, editable: false, memberCount: 2 },
  { id: "manager", name: "Manager", description: "Runs finances, marketing and the team's work. No team, settings or audit access.", perms: managerPerms, editable: true, memberCount: 1 },
  { id: "staff", name: "Staff", description: "Least privilege: home, their own tasks, the calendar and chat. No finance access.", perms: staffPerms, editable: true, memberCount: 2 },
  { id: "custom", name: "Custom", description: "Hand-edited permissions for one person.", perms: emptyPermMap(), editable: false, memberCount: 1 },
];

export const previewAudit: AuditRow[] = [
  { id: 6, at: "2026-10-25T09:12:00Z", actor_email: "admin.one@example.test", action: "update", entity: "income_entries", entity_id: "8f1c2a90-0000-4000-8000-00000000aa01", summary: null, before: { amount_minor: 1234500, status: "pending", client: "Example Client Pty" }, after: { amount_minor: 1290000, status: "paid", client: "Example Client Pty" } },
  { id: 5, at: "2026-10-25T08:41:00Z", actor_email: "admin.one@example.test", action: "permissions", entity: "users", entity_id: "00000000-0000-4000-8000-000000000006", summary: "Custom permissions set", before: [{ module: "home", view: true }], after: [{ module: "home", view: true }, { module: "tasks", view: true, create: true }] },
  { id: 4, at: "2026-10-25T08:30:00Z", actor_email: "admin.one@example.test", action: "invite", entity: "users", entity_id: "00000000-0000-4000-8000-000000000005", summary: "Invited marketing@example.test", before: null, after: null },
  { id: 3, at: "2026-10-24T16:05:00Z", actor_email: "admin.two@example.test", action: "export", entity: "transactions", entity_id: null, summary: "income-oct-2026.csv", before: null, after: null },
  { id: 2, at: "2026-10-24T11:00:00Z", actor_email: "admin.two@example.test", action: "deactivate", entity: "users", entity_id: "00000000-0000-4000-8000-000000000006", summary: null, before: null, after: null },
  { id: 1, at: "2026-10-24T08:00:00Z", actor_email: "web.dev@example.test", action: "sign_in", entity: "auth", entity_id: null, summary: "Signed in", before: null, after: null },
];

export const previewNav = NAV;
