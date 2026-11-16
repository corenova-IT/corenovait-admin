import { redirect } from "next/navigation";
import { AddProjectButton, ProjectsManager } from "@/components/revenue/ProjectsManager";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/States";
import { requireUser } from "@/lib/auth/session";
import { baseCurrency } from "@/lib/dal/finance";
import { ownerProjects } from "@/lib/dal/projects";
import { deleteProject, saveHiddenFrom, savePartners, saveProject, setProjectActive } from "./actions";

export const metadata = { title: "Projects" };

/** Owner only: projects under each stream, and who can't see each one's money. */
export default async function ProjectsPage() {
  const actor = await requireUser();
  if (!actor.isOwner) redirect("/no-access?module=streams");
  const [data, base] = await Promise.all([ownerProjects(actor), baseCurrency()]);
  const actions = { save: saveProject, setActive: setProjectActive, remove: deleteProject, saveHidden: saveHiddenFrom, savePartners };
  return (
    <>
      <PageHeader
        title="Projects"
        subtitle="Under each revenue stream · decide who can see each project's money"
        actions={<AddProjectButton streams={data.streams} action={saveProject} />}
      />
      {data.projects.length === 0 ? (
        <EmptyState title="No projects yet">Add a project under a revenue stream, file income under it, then choose who can&apos;t see it. Only you see this page.</EmptyState>
      ) : (
        <ProjectsManager projects={data.projects} people={data.people} choices={data.partnerChoices} streams={data.streams} base={base} actions={actions} />
      )}
      <p className="mt-4 text-sm text-muted">
        Hiding a project removes its income from that person&apos;s totals, charts, lists, exports, search, invoice downloads and the audit log. The change applies on their next page load, and every change is recorded in the audit log, where only you can see it.
      </p>
    </>
  );
}
