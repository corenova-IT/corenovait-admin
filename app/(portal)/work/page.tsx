import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/States";
import { requirePerm } from "@/lib/auth/session";

export const metadata = { title: "My work" };

/** An employee's own page. Phase 1 is only a landing page: tasks, hours and chat arrive in later phases. */
export default async function WorkPage() {
  await requirePerm("employee");
  return (
    <>
      <PageHeader title="My work" subtitle="Your tasks, projects and hours" />
      <Card>
        <EmptyState title="Nothing here yet">Your partner or an admin will add you to a project. Your tasks and hours will show here.</EmptyState>
      </Card>
    </>
  );
}
