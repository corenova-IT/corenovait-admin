import Link from "next/link";
import { PayPanel } from "@/components/partner/PayPanel";
import { InviteEmployeeForm } from "@/components/partner/PartnerForms";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/States";
import { requirePerm } from "@/lib/auth/session";
import { payFormChoices, payPlansFor } from "@/lib/dal/employee-pay";
import { myEmployees } from "@/lib/dal/partner-employees";
import { myFormChoices } from "@/lib/dal/partner-writes";
import { payRows } from "@/lib/pay-form";
import { companyToday } from "@/lib/dal/payments";
import { myAssignments } from "@/lib/dal/stream-partners";
import { fmtDate } from "@/lib/format";
import { addEmployeePay, inviteEmployee, markEmployeePayPaid, stopEmployeePay } from "../actions";

export const metadata = { title: "My team" };

/** A stream partner's own employees: invite them, and see their projects, tasks and whether they are online. */
export default async function MyTeamPage() {
  const actor = await requirePerm("stream_partner");
  const mine = await myAssignments(actor);
  if (!mine.hasData) {
    return (
      <>
        <PageHeader title="My team" subtitle="Your employees" />
        <Card>
          <EmptyState title="Nothing to show yet">You need at least one stream and one country before you can invite employees. Ask an admin.</EmptyState>
        </Card>
      </>
    );
  }
  const people = await myEmployees(actor, await companyToday());
  const base = (await myFormChoices(actor)).baseCurrency;
  const payData = await Promise.all(people.map(async (p) => ({ id: p.id, plans: await payPlansFor(actor, p.id), choices: await payFormChoices(actor, p.id) })));
  return (
    <>
      <PageHeader title="My team" subtitle="Your employees, their projects and tasks" actions={<Link href="/my-dashboard" className="text-sm text-accent-text hover:underline">Back to my dashboard</Link>} />
      <div className="flex flex-col gap-[var(--space-gap)]">
        <Card>
          <CardHeader title="Invite an employee" />
          <div className="p-5 pt-0">
            <InviteEmployeeForm action={inviteEmployee} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Your employees" subtitle={`${people.length} ${people.length === 1 ? "person" : "people"}`} />
          {people.length === 0 ? (
            <EmptyState title="No employees yet">Invite your first one above.</EmptyState>
          ) : (
            <ul className="flex flex-col">
              {people.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 border-b border-line/70 px-5 py-4 last:border-b-0">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink">{p.name}</p>
                    <p className="text-sm text-muted">{p.email}{p.jobTitle ? ` · ${p.jobTitle}` : ""}</p>
                    <p className="mt-1 text-sm text-ink-2">{p.projects.length ? p.projects.map((x) => x.name).join(", ") : "Not on a project yet"}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {p.status === "invited" && <Badge tone="amber">Invite sent</Badge>}
                    {p.status === "deactivated" && <Badge tone="red">Deactivated</Badge>}
                    {p.status === "active" && (p.online ? <Badge tone="green">Online</Badge> : <Badge>{p.lastSeen ? `Seen ${fmtDate(p.lastSeen.slice(0, 10))}` : "Never signed in"}</Badge>)}
                    <Badge>{p.openTasks} open</Badge>
                    {p.overdueTasks > 0 && <Badge tone="red">{p.overdueTasks} overdue</Badge>}
                  </div>
                  <details className="basis-full">
                    <summary className="cursor-pointer text-sm text-accent-text">Pay</summary>
                    <div className="mt-3">
                      {(() => {
                        const d = payData.find((x) => x.id === p.id)!;
                        return <PayPanel employeeId={p.id} plans={payRows(d.plans, d.choices.streams, base)} choices={{ ...d.choices, baseCurrency: base }} actions={{ add: addEmployeePay, stop: stopEmployeePay, markPaid: markEmployeePayPaid }} />;
                      })()}
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
