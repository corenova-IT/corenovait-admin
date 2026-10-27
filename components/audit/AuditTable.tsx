import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";
import { IconShield } from "@/components/icons";

export type AuditRow = {
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

export const ACTION_LABELS: Record<string, { label: string; tone: BadgeTone }> = {
  create: { label: "Created", tone: "green" },
  update: { label: "Changed", tone: "amber" },
  delete: { label: "Deleted", tone: "red" },
  export: { label: "Exported", tone: "neutral" },
  sign_in: { label: "Signed in", tone: "neutral" },
  sign_out: { label: "Signed out", tone: "neutral" },
  lockout: { label: "Locked out", tone: "red" },
  invite: { label: "Invited", tone: "green" },
  invite_accepted: { label: "Invite accepted", tone: "green" },
  password_reset: { label: "Password reset", tone: "amber" },
  permissions: { label: "Permissions", tone: "red" },
  preset: { label: "Preset edited", tone: "red" },
  sessions_reset: { label: "Sessions reset", tone: "amber" },
  activate: { label: "Reactivated", tone: "green" },
  deactivate: { label: "Deactivated", tone: "red" },
  mfa_enabled: { label: "Two-factor on", tone: "green" },
  mfa_reset: { label: "Two-factor reset", tone: "red" },
  recovery_code_used: { label: "Recovery code used", tone: "amber" },
  recovery_codes_regenerated: { label: "New recovery codes", tone: "neutral" },
};

export const ENTITY_LABELS: Record<string, string> = {
  income_entries: "Income entry",
  expenses: "Expense",
  representatives: "Representative",
  rep_payouts: "Commission payout",
  subscriptions: "Payment / subscription",
  expense_categories: "Expense category",
  finances: "Finances",
  streams: "Revenue stream",
  countries: "Country",
  settings: "Settings",
  users: "Team member",
  files: "File",
  role_presets: "Role preset",
  auth: "Sign-in",
  transactions: "Transactions",
  marketing_activities: "Marketing activity",
  campaigns: "Campaign",
  marketing: "Marketing",
  events: "Calendar event",
  calendar: "Calendar",
  tasks: "Task",
  task_comments: "Task comment",
  chat_channels: "Chat channel",
  chat_messages: "Chat message",
};

const HIDDEN_FIELDS = new Set(["updated_at", "created_at", "updatedAt", "createdAt"]);

function fmtValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Field-by-field before/after for one audit row. */
function Changes({ row }: { row: AuditRow }) {
  if (Array.isArray(row.before) || Array.isArray(row.after)) {
    return (
      <div className="grid gap-3 md:grid-cols-2">
        {(["before", "after"] as const).map((k) => (
          <div key={k}>
            <p className="label-mono mb-2">{k}</p>
            <pre className="max-h-64 overflow-auto rounded-xl border border-line bg-input p-3 font-mono text-xs text-ink-2">
              {JSON.stringify(row[k], null, 2)}
            </pre>
          </div>
        ))}
      </div>
    );
  }
  const before = (row.before ?? {}) as Record<string, unknown>;
  const after = (row.after ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (k) => !HIDDEN_FIELDS.has(k) && (row.action !== "update" || JSON.stringify(before[k]) !== JSON.stringify(after[k]))
  );
  if (keys.length === 0) return <p className="text-sm text-muted">No field values were recorded for this event.</p>;
  return (
    // fixed layout + wrap anywhere: long values (JSON, ids) wrap inside the card instead of widening it
    <table className="w-full table-fixed text-left text-sm">
      <caption className="sr-only">Field changes</caption>
      <thead>
        <tr>
          <th scope="col" className="label-mono w-[28%] pb-2 pr-4 font-normal">Field</th>
          {row.action !== "create" && <th scope="col" className="label-mono pb-2 pr-4 font-normal">Before</th>}
          {row.action !== "delete" && <th scope="col" className="label-mono pb-2 font-normal">After</th>}
        </tr>
      </thead>
      <tbody>
        {keys.map((k) => (
          <tr key={k} className="border-t border-line/60">
            <th scope="row" className="py-2 pr-4 text-left align-top font-mono text-xs font-normal text-muted [overflow-wrap:anywhere]">{k}</th>
            {row.action !== "create" && <td className="py-2 pr-4 align-top font-mono text-xs text-ink-2 line-through decoration-accent-text/60 [overflow-wrap:anywhere]">{fmtValue(before[k])}</td>}
            {row.action !== "delete" && <td className="py-2 align-top font-mono text-xs text-ink [overflow-wrap:anywhere]">{fmtValue(after[k])}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function AuditTable({ rows, timeZone }: { rows: AuditRow[]; timeZone: string }) {
  if (rows.length === 0) {
    return (
      <EmptyState icon={<IconShield size={22} />} title="No matching events">
        Try a wider date range or clear the filters.
      </EmptyState>
    );
  }
  const fmt = new Intl.DateTimeFormat("en-AU", { timeZone, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  return (
    <ul className="flex flex-col" aria-label="Audit events">
      {rows.map((r) => {
        const a = ACTION_LABELS[r.action] ?? { label: r.action, tone: "neutral" as BadgeTone };
        const hasDetail = r.before !== null || r.after !== null;
        const line = (
          <div className="grid grid-cols-1 items-center gap-x-4 gap-y-1.5 py-4 sm:grid-cols-[150px_120px_minmax(0,1fr)] lg:grid-cols-[170px_130px_minmax(0,1fr)_minmax(0,260px)]">
            <time dateTime={r.at} className="font-mono text-xs text-muted">{fmt.format(new Date(r.at))}</time>
            <span><Badge tone={a.tone}>{a.label}</Badge></span>
            <span className="min-w-0 text-[15px] text-ink [overflow-wrap:anywhere]">
              {ENTITY_LABELS[r.entity] ?? r.entity}
              {r.summary && <span className="text-ink-2"> · {r.summary}</span>}
              {r.entity_id && <span className="ml-2 font-mono text-xs text-muted">{r.entity_id.slice(0, 8)}</span>}
            </span>
            <span className="min-w-0 font-mono text-xs text-ink-2 [overflow-wrap:anywhere] lg:text-right">{r.actor_email ?? "system"}</span>
          </div>
        );
        return (
          <li key={r.id} className="border-b border-line/70 last:border-b-0">
            {hasDetail ? (
              <details className="group">
                <summary className="cursor-pointer list-none rounded-xl marker:hidden hover:bg-surface-2/60 [&::-webkit-details-marker]:hidden">
                  {line}
                  <span className="sr-only">Show changes</span>
                </summary>
                <div className="mb-4 rounded-[16px] border border-line bg-surface-2/60 p-4">
                  <Changes row={r} />
                </div>
              </details>
            ) : (
              line
            )}
          </li>
        );
      })}
    </ul>
  );
}
