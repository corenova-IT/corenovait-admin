import { ShiftPanel } from "@/components/partner/ShiftPanel";
import { ClockButtons } from "@/components/partner/ShiftPanel";
import { TaskStatusSelect } from "@/components/partner/WorkForms";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/States";
import { StatCard } from "@/components/ui/StatCard";
import { requirePerm } from "@/lib/auth/session";
import { myWork } from "@/lib/dal/employee-work";
import { companyToday } from "@/lib/dal/payments";
import { myShifts } from "@/lib/dal/shifts";
import { fmtMinutes } from "@/lib/hours";
import { shiftRows } from "@/lib/shift-view";
import { fmtDate } from "@/lib/format";
import { clockIn, clockOut, setTaskStatus } from "./actions";

export const metadata = { title: "My work" };

/** An employee's own page: their tasks, their projects, and (where the partner allows it) who else is on them. Never any money. */
export default async function WorkPage() {
  const actor = await requirePerm("employee");
  const w = await myWork(actor, await companyToday());
  const hours = w.partnerName === null ? null : await myShifts(actor);
  return (
    <>
      <PageHeader title="My work" subtitle={w.partnerName ? `Working for ${w.partnerName}` : "Your tasks, projects and hours"} />
      {w.partnerName === null ? (
        <Card>
          <EmptyState title="Nothing here yet">Your account isn&apos;t linked to a partner yet. Ask an admin.</EmptyState>
        </Card>
      ) : (
        <div className="flex flex-col gap-[var(--space-gap)]">
          <div className="grid grid-cols-1 gap-cards @min-[34rem]:grid-cols-2">
            <StatCard label="Open tasks" value={String(w.openTasks)} detail="Assigned to you" />
            <StatCard label="Overdue" value={String(w.overdueTasks)} noteTone={w.overdueTasks ? "red" : "green"} note={w.overdueTasks ? "Needs attention" : "None overdue"} />
          </div>
          {hours && (
            <Card>
              <CardHeader title="My hours" subtitle={hours.open ? `Clocked in since ${new Intl.DateTimeFormat("en-AU", { timeZone: hours.timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(hours.open.since))}` : "You are clocked out"} />
              <div className="flex flex-col gap-4 p-5 pt-0">
                <ClockButtons open={!!hours.open} flagged={!!hours.open?.flagged} clockIn={clockIn} clockOut={clockOut} />
                <dl className="grid grid-cols-3 gap-3 text-sm">
                  <div><dt className="label-mono">Today</dt><dd className="mt-1 text-ink">{fmtMinutes(hours.todayMinutes)}</dd></div>
                  <div><dt className="label-mono">This week</dt><dd className="mt-1 text-ink">{fmtMinutes(hours.weekMinutes)}</dd></div>
                  <div><dt className="label-mono">This month</dt><dd className="mt-1 text-ink">{fmtMinutes(hours.monthMinutes)}</dd></div>
                </dl>
                <div>
                  <h3 className="label-mono mb-2">Recent shifts</h3>
                  <ShiftPanel shifts={shiftRows(hours.recent, hours.timeZone)} timeZone={hours.timeZone} />
                </div>
              </div>
            </Card>
          )}
          <Card>
            <CardHeader title="My tasks" subtitle="Soonest deadline first" />
            {w.tasks.length === 0 ? (
              <EmptyState title="No tasks yet">Tasks your partner gives you will appear here.</EmptyState>
            ) : (
              <ul className="flex flex-col">
                {w.tasks.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-3 border-b border-line/70 px-5 py-4 last:border-b-0">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-ink">{t.title}</p>
                      <p className="text-sm text-muted">
                        {t.project ? `${t.project} · ` : ""}
                        {t.dueDate ? `Due ${fmtDate(t.dueDate)}` : "No deadline"}
                      </p>
                      {t.description && <p className="clamp-2 mt-1 text-sm text-ink-2">{t.description}</p>}
                    </div>
                    {t.overdue && <Badge tone="red">Overdue</Badge>}
                    <TaskStatusSelect id={t.id} status={t.status} action={setTaskStatus} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="My projects" />
            {w.projects.length === 0 ? (
              <EmptyState title="Not on a project yet">Your partner will add you to a project.</EmptyState>
            ) : (
              <ul className="flex flex-col">
                {w.projects.map((p) => (
                  <li key={p.id} className="border-b border-line/70 px-5 py-4 last:border-b-0">
                    <p className="font-semibold text-ink">{p.name}</p>
                    {p.teamVisible && (
                      <p className="mt-1 text-sm text-muted">
                        {p.team.length === 0 ? (
                          "You are the only one on this project."
                        ) : (
                          <span className="flex flex-wrap items-center gap-2">
                            {p.team.map((m) => (
                              <Badge key={m.name} tone={m.online ? "green" : "neutral"}>
                                {m.name}
                                {m.online ? " · online" : ""}
                              </Badge>
                            ))}
                          </span>
                        )}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
