import Link from "next/link";
import { ArchiveButton, TaskForm } from "@/components/partner/PartnerForms";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/States";
import { requirePerm } from "@/lib/auth/session";
import { myFormChoices, myTasks } from "@/lib/dal/partner-writes";
import { fmtDate } from "@/lib/format";
import { archiveTask, saveTask } from "../actions";

export const metadata = { title: "My tasks" };

/** A stream partner's tasks in their own streams. Archiving hides one; nothing is deleted. */
export default async function MyTasksPage() {
  const actor = await requirePerm("stream_partner");
  const [rows, c] = await Promise.all([myTasks(actor), myFormChoices(actor)]);
  return (
    <>
      <PageHeader title="My tasks" subtitle="Tasks and deadlines in your streams" actions={<Link href="/my-dashboard" className="text-sm text-accent-text hover:underline">Back to my dashboard</Link>} />
      {!c.hasData ? (
        <Card>
          <EmptyState title="Nothing to show yet">You need at least one stream and one country before you can add tasks. Ask an admin.</EmptyState>
        </Card>
      ) : (
        <div className="flex flex-col gap-[var(--space-gap)]">
          <Card>
            <CardHeader title="Add a task" />
            <div className="p-5 pt-0">
              <TaskForm c={c} action={saveTask} idPrefix="new-task" />
            </div>
          </Card>
          <Card>
            <CardHeader title="Your tasks" subtitle="Soonest deadline first" />
            {rows.length === 0 ? (
              <EmptyState title="No tasks yet">Add your first one above.</EmptyState>
            ) : (
              <ul className="flex flex-col">
                {rows.map((r) => (
                  <li key={r.id} className="border-b border-line/70 px-5 py-4 last:border-b-0">
                    <details>
                      <summary className="flex cursor-pointer flex-wrap items-center gap-3">
                        <span className="min-w-0 flex-1 font-semibold text-ink">{r.title}</span>
                        <span className="text-sm text-muted">{r.dueDate ? fmtDate(r.dueDate) : "No deadline"}</span>
                        <Badge>{r.status.replace("_", " ")}</Badge>
                      </summary>
                      <div className="mt-4 flex flex-col gap-4">
                        <TaskForm
                          c={c}
                          action={saveTask}
                          idPrefix={`task-${r.id}`}
                          row={{ id: r.id, title: r.title, description: r.description ?? "", status: r.status, priority: r.priority, dueDate: r.dueDate, streamId: r.streamId, projectId: r.projectId, assigneeId: r.assigneeId }}
                        />
                        <ArchiveButton id={r.id} action={archiveTask} label="Archive this task" />
                      </div>
                    </details>
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
