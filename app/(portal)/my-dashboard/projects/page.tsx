import Link from "next/link";
import { ProjectActiveButton, ProjectForm, ProjectKindForm, ProjectTeamForm } from "@/components/partner/PartnerForms";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/States";
import { requirePerm } from "@/lib/auth/session";
import { myEmployees } from "@/lib/dal/partner-employees";
import { myProjects } from "@/lib/dal/partner-projects";
import { myFormChoices } from "@/lib/dal/partner-writes";
import { companyToday } from "@/lib/dal/payments";
import { listNiches } from "@/lib/dal/niches";
import { saveProject, saveProjectKind, saveProjectTeam, setProjectActive } from "../actions";

export const metadata = { title: "My projects" };

/** A partner's projects in their own streams: add, rename, archive, set Team visible, and put employees on them. */
export default async function MyProjectsPage() {
  const actor = await requirePerm("stream_partner");
  const c = await myFormChoices(actor);
  if (!c.hasData) {
    return (
      <>
        <PageHeader title="My projects" subtitle="Projects in your streams" />
        <Card>
          <EmptyState title="Nothing to show yet">You need at least one stream and one country before you can add projects. Ask an admin.</EmptyState>
        </Card>
      </>
    );
  }
  const [rows, people, niches] = await Promise.all([myProjects(actor), myEmployees(actor, await companyToday()), listNiches(actor)]);
  const staff = people.filter((p) => p.status !== "deactivated").map((p) => ({ id: p.id, name: p.name }));
  const leads = staff;
  return (
    <>
      <PageHeader title="My projects" subtitle="Projects in your streams, and who works on them" actions={<Link href="/my-dashboard" className="text-sm text-accent-text hover:underline">Back to my dashboard</Link>} />
      <div className="flex flex-col gap-[var(--space-gap)]">
        <Card>
          <CardHeader title="Add a project" />
          <div className="p-5 pt-0">
            <ProjectForm c={c} action={saveProject} idPrefix="new-project" niches={niches} leads={leads} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Your projects" subtitle={`${rows.length} in your streams`} />
          {rows.length === 0 ? (
            <EmptyState title="No projects yet">Add your first one above.</EmptyState>
          ) : (
            <ul className="flex flex-col">
              {rows.map((p) => (
                <li key={p.id} className="border-b border-line/70 px-5 py-4 last:border-b-0">
                  <details>
                    <summary className="flex cursor-pointer flex-wrap items-center gap-3">
                      <span className="min-w-0 flex-1">
                        <span className="font-semibold text-ink">{p.name}</span>
                        <span className="ml-2 text-sm text-muted">{[p.stream, p.niche && (p.subNiche ? `${p.niche} / ${p.subNiche}` : p.niche), p.leadName && `led by ${p.leadName}`].filter(Boolean).join(" · ")}</span>
                      </span>
                      {!p.active && <Badge tone="amber">Archived</Badge>}
                      {p.teamVisible && <Badge tone="green">Team visible</Badge>}
                      <Badge>{p.members.length} {p.members.length === 1 ? "person" : "people"}</Badge>
                    </summary>
                    <div className="mt-4 flex flex-col gap-5">
                      <ProjectForm c={c} action={saveProject} idPrefix={`proj-${p.id}`} row={{ id: p.id, name: p.name }} />
                      <ProjectKindForm project={{ id: p.id, nicheId: p.nicheId, subNicheId: p.subNicheId, leadId: p.leadId }} niches={niches} leads={leads} action={saveProjectKind} />
                      {p.active && <ProjectTeamForm project={{ id: p.id, teamVisible: p.teamVisible, members: p.members.map((m) => m.id) }} employees={staff} action={saveProjectTeam} />}
                      <ProjectActiveButton id={p.id} active={p.active} action={setProjectActive} />
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
