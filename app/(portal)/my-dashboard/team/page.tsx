import Link from "next/link";
import { InviteEmployeeForm } from "@/components/partner/PartnerForms";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/States";
import { requirePerm } from "@/lib/auth/session";
import { myEmployees } from "@/lib/dal/partner-employees";
import { companyToday } from "@/lib/dal/payments";
import { myAssignments } from "@/lib/dal/stream-partners";
import { fmtDate } from "@/lib/format";
import { inviteEmployee } from "../actions";

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
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
