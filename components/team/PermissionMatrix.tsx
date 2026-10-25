"use client";

import { ACTIONS, MODULE_LABELS, MODULES, PRIVILEGED_MODULES, SCOPE_LABELS, SCOPES, type AppAction, type AppModule, type DataScope, type PermMap } from "@/lib/permissions";
import { cx } from "@/components/ui/cx";

const ACTION_LABELS: Record<AppAction, string> = { view: "View", create: "Create", edit: "Edit", delete: "Delete", export: "Export" };

/**
 * Modules (rows) × actions (columns) with a data scope per module. Turning on
 * any action also turns on View; turning off View clears the row.
 */
export function PermissionMatrix({
  value,
  onChange,
  readOnly = false,
  idPrefix,
}: {
  value: PermMap;
  onChange?: (next: PermMap) => void;
  readOnly?: boolean;
  idPrefix: string;
}) {
  function toggle(module: AppModule, action: AppAction, on: boolean) {
    const row = { ...value[module], [action]: on };
    if (action !== "view" && on) row.view = true;
    if (action === "view" && !on) for (const a of ACTIONS) row[a] = false;
    onChange?.({ ...value, [module]: row });
  }
  function setScope(module: AppModule, scope: DataScope) {
    onChange?.({ ...value, [module]: { ...value[module], scope } });
  }

  return (
    <div className="-mx-2 overflow-x-auto px-2">
      <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left">
        <caption className="sr-only">Permissions by module and action</caption>
        <thead>
          <tr>
            <th scope="col" className="label-mono border-b border-line pb-3 pr-4 font-normal">Module</th>
            {ACTIONS.map((a) => (
              <th key={a} scope="col" className="label-mono border-b border-line px-2 pb-3 text-center font-normal">
                {ACTION_LABELS[a]}
              </th>
            ))}
            <th scope="col" className="label-mono border-b border-line pb-3 pl-2 font-normal">Scope</th>
          </tr>
        </thead>
        <tbody>
          {MODULES.map((m) => {
            const row = value[m];
            const any = row.view;
            return (
              <tr key={m}>
                <th scope="row" className="border-b border-line/60 py-2.5 pr-4 text-left text-sm font-medium text-ink">
                  {MODULE_LABELS[m]}
                  {PRIVILEGED_MODULES.includes(m) && <span className="ml-2 font-mono text-[11px] text-warning">2FA</span>}
                </th>
                {ACTIONS.map((a) => {
                  const id = `${idPrefix}-${m}-${a}`;
                  return (
                    <td key={a} className="border-b border-line/60 px-2 py-2.5 text-center">
                      <label htmlFor={id} className="sr-only">
                        {ACTION_LABELS[a]} {MODULE_LABELS[m]}
                      </label>
                      <input
                        id={id}
                        type="checkbox"
                        checked={row[a]}
                        disabled={readOnly}
                        onChange={(e) => toggle(m, a, e.target.checked)}
                        className="size-[18px] cursor-pointer accent-[var(--accent)] disabled:cursor-default"
                      />
                    </td>
                  );
                })}
                <td className="border-b border-line/60 py-2 pl-2">
                  <label htmlFor={`${idPrefix}-${m}-scope`} className="sr-only">
                    Data scope for {MODULE_LABELS[m]}
                  </label>
                  <select
                    id={`${idPrefix}-${m}-scope`}
                    value={row.scope}
                    disabled={readOnly || !any}
                    onChange={(e) => setScope(m, e.target.value as DataScope)}
                    className={cx(
                      "h-9 rounded-xl border border-line bg-input px-2.5 font-mono text-xs text-ink",
                      !any && "opacity-40"
                    )}
                  >
                    {SCOPES.map((s) => (
                      <option key={s} value={s}>
                        {SCOPE_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-3 text-xs leading-relaxed text-muted">
        Scope: <strong className="text-ink-2">Own</strong> = records they created ·{" "}
        <strong className="text-ink-2">Assigned</strong> = assigned or invited to them, plus their own ·{" "}
        <strong className="text-ink-2">All</strong> = every record. Modules marked <span className="text-warning">2FA</span> make two-factor
        mandatory for this person.
      </p>
    </div>
  );
}
