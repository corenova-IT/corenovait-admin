import Link from "next/link";
import { Board, TaskMeta } from "@/components/tasks/Board";
import { AddTask, type TaskLookups, type TaskView } from "@/components/tasks/TaskForms";
import { TaskPanel, type TaskDetail } from "@/components/tasks/TaskPanel";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Pagination } from "@/components/ui/DataTable";
import { Field, FormMessage, Input, Select } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { PillSwitch } from "@/components/ui/Pill";
import { EmptyState } from "@/components/ui/States";
import { requirePerm } from "@/lib/auth/session";
import { hasSampleData } from "@/lib/dal/finance";
import { hasPerm } from "@/lib/dal/guard";
import { BOARD_DONE_LIMIT, assignees, getTask, listTasks, taskFilters, taskLabels, teamProgress } from "@/lib/dal/tasks";
import { toTaskView } from "@/lib/task-view";
import { fmtShortDate, hrefWith } from "@/lib/format";
import { PRIORITY_LABEL, TASK_PRIORITIES, TASK_STATUS_LABEL, taskHref } from "@/lib/work";
import { addComment, deleteComment, deleteTask, saveTask, setTaskStatus, toggleChecklist } from "./actions";

export const metadata = { title: "Tasks" };

const PATH = "/tasks";
const PAGE_SIZE = 100;

const view = toTaskView;

function TaskRows({ tasks, query }: { tasks: TaskView[]; query: string }) {
  return (
    <ul className="flex flex-col divide-y divide-line">
      {tasks.map((t) => (
        <li key={t.id}>
          <Link href={taskHref(query, t.id)} scroll={false} className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl px-2 py-2.5 hover:bg-surface-2">
            <span className="min-w-0 flex-[1_1_16rem]">
              <span className={t.status === "done" ? "clamp-2 font-medium text-ink-2 line-through decoration-muted" : "clamp-2 font-medium text-ink"}>{t.title}</span>
            </span>
            <span className="flex flex-wrap items-center gap-2">
              <TaskMeta task={t} />
              <Badge tone={t.status === "done" ? "green" : t.status === "review" ? "amber" : "neutral"}>{TASK_STATUS_LABEL[t.status]}</Badge>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePerm("tasks");
  const sp = await searchParams;
  const f = taskFilters.parse(sp);
  const mode = sp.view === "list" ? "list" : "board";
  const pageNo = Math.min(10_000, Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1));
  const scope = actor.perms.tasks.scope;
  const [data, people, labels, progress, sample, selected] = await Promise.all([
    listTasks(actor, f, mode === "list" ? { page: pageNo, pageSize: PAGE_SIZE } : {}),
    assignees(actor),
    taskLabels(actor),
    scope === "all" ? teamProgress(actor) : Promise.resolve(null),
    hasSampleData(actor),
    sp.task && /^[0-9a-f-]{36}$/i.test(sp.task) ? getTask(actor, sp.task) : Promise.resolve(null),
  ]);
  const can = { create: hasPerm(actor, "tasks", "create"), edit: hasPerm(actor, "tasks", "edit"), delete: hasPerm(actor, "tasks", "delete") };
  const lookups: TaskLookups = { assignees: people, canChooseAssignee: scope === "all", selfId: actor.userId, today: data.today };
  const keep = { view: mode === "list" ? "list" : undefined, assignee: f.assignee, status: f.status, priority: f.priority, label: f.label, due: f.due, q: f.q };
  const query = new URLSearchParams(Object.entries(keep).filter(([, v]) => v) as Array<[string, string]>).toString();
  const filtered = [f.assignee, f.status, f.priority, f.label, f.due, f.q].some(Boolean);
  const tasks = data.tasks.map(view);
  const openCount = tasks.filter((t) => t.status !== "done").length;
  const overdueCount = tasks.filter((t) => t.overdue).length;
  const scopeNote = scope === "all" ? "Everyone's tasks" : scope === "assigned" ? "Tasks you created or that are assigned to you" : "Tasks you created";
  const actions = { save: saveTask, status: setTaskStatus, tick: toggleChecklist, comment: addComment, uncomment: deleteComment, remove: deleteTask };
  const detail: TaskDetail | null = selected
    ? {
        ...view(selected),
        commentList: selected.commentList.map((c) => ({ id: c.id, body: c.body, createdAt: c.createdAt.toISOString(), authorName: c.authorName, mine: c.mine })),
        canComment: true, // anyone who can see the task
        canModerate: can.delete && scope === "all",
      }
    : null;

  // per-person to-do lists in the list view (for people who see everyone's tasks)
  const groups =
    mode === "list" && scope === "all" && !f.assignee
      ? [
          ...people.map((p) => ({ key: p.id, name: p.name, tasks: tasks.filter((t) => t.assigneeId === p.id) })),
          { key: "none", name: "Not assigned yet", tasks: tasks.filter((t) => !t.assigneeId) },
        ].filter((g) => g.tasks.length > 0)
      : null;

  return (
    <>
      <PageHeader
        title="Tasks"
        subtitle={`${scopeNote} · ${openCount} open${overdueCount ? ` · ${overdueCount} overdue` : ""}`}
        sample={sample}
        actions={can.create ? <AddTask lookups={lookups} action={saveTask} initialOpen={sp.new === "1"} /> : undefined}
      />

      <Card className="mb-[var(--space-gap)] flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PillSwitch
            label="View"
            value={mode}
            options={[
              { value: "board", label: "Board", href: hrefWith(PATH, keep, { view: undefined }) },
              { value: "list", label: "List", href: hrefWith(PATH, keep, { view: "list" }) },
            ]}
          />
          <PillSwitch
            label="Whose tasks"
            value={f.assignee === "me" ? "me" : "all"}
            options={[
              { value: "all", label: scope === "all" ? "Everyone" : "All mine", href: hrefWith(PATH, keep, { assignee: undefined }) },
              { value: "me", label: "My tasks", href: hrefWith(PATH, keep, { assignee: "me" }) },
            ]}
          />
        </div>
        <form method="get" action={PATH} className="grid gap-4 @min-[34rem]:grid-cols-2 @min-[60rem]:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))_auto] @min-[60rem]:items-end">
          {mode === "list" && <input type="hidden" name="view" value="list" />}
          <Field label="Search" htmlFor="t-q">
            <Input id="t-q" name="q" defaultValue={f.q} placeholder="Title or details" />
          </Field>
          {lookups.canChooseAssignee ? (
            <Field label="Person" htmlFor="t-who">
              <Select id="t-who" name="assignee" defaultValue={f.assignee ?? ""}>
                <option value="">Everyone</option>
                <option value="me">Me</option>
                <option value="none">Not assigned</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field label="Whose" htmlFor="t-who">
              <Select id="t-who" name="assignee" defaultValue={f.assignee ?? ""}>
                <option value="">All mine</option>
                <option value="me">Assigned to me</option>
              </Select>
            </Field>
          )}
          <Field label="Priority" htmlFor="t-prio">
            <Select id="t-prio" name="priority" defaultValue={f.priority ?? ""}>
              <option value="">Any</option>
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Label" htmlFor="t-label">
            <Select id="t-label" name="label" defaultValue={f.label ?? ""}>
              <option value="">Any</option>
              {labels.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Due" htmlFor="t-due">
            <Select id="t-due" name="due" defaultValue={f.due ?? ""}>
              <option value="">Any time</option>
              <option value="overdue">Overdue</option>
              <option value="week">This week</option>
            </Select>
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit">Apply</Button>
            {filtered && (
              <ButtonLink href={hrefWith(PATH, { view: keep.view }, {})} variant="ghost">
                Clear
              </ButtonLink>
            )}
          </div>
        </form>
      </Card>

      {progress && progress.people.length > 0 && (
        <Card className="mb-[var(--space-gap)]">
          <CardHeader title="Progress this week" subtitle={`Tasks due ${fmtShortDate(progress.weekStart)} – ${fmtShortDate(progress.weekEnd)} that are done, per person`} />
          <ul className="grid-auto [--min:15rem]">
            {progress.people.map((p) => {
              const pct = p.weekTotal ? Math.round((p.weekDone / p.weekTotal) * 100) : null;
              return (
                <li key={p.userId}>
                  <Link href={hrefWith(PATH, keep, { assignee: p.userId })} className="flex h-full flex-col gap-2.5 rounded-[14px] border border-line bg-surface-2 p-3.5 hover:border-accent-line">
                    <span className="flex items-center gap-2.5">
                      <Avatar name={p.name} size={30} />
                      <span className="clamp-2 min-w-0 flex-1 font-medium leading-snug text-ink">{p.name}</span>
                      {p.overdue > 0 && <Badge tone="red">{p.overdue} overdue</Badge>}
                    </span>
                    <span className="h-2 rounded-full bg-surface" aria-hidden="true">
                      <span className="block h-2 rounded-full bg-accent" style={{ width: `${pct ?? 0}%` }} />
                    </span>
                    <span className="font-mono text-xs text-ink-2">
                      {pct === null ? "Nothing due this week" : `${p.weekDone} of ${p.weekTotal} due this week done (${pct}%)`} · {p.open} open
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {sp.task && !detail && (
        <div className="mb-[var(--space-gap)]">
          <FormMessage tone="info">That task doesn&apos;t exist any more, or you can&apos;t see it.</FormMessage>
        </div>
      )}

      {tasks.length === 0 ? (
        <Card>
          <EmptyState title={filtered ? "No tasks match" : "No tasks yet"}>{filtered ? "Try clearing the filters." : can.create ? "Use New task to add the first one." : "Tasks assigned to you will appear here."}</EmptyState>
        </Card>
      ) : mode === "board" ? (
        <Card>
          <CardHeader title="Board" subtitle={can.edit ? "Drag a card to another column to move it, or open it to change its status." : "Open a card to see the details."} />
          <Board tasks={tasks} query={query} move={setTaskStatus} />
          {data.doneCapped && (
            <p className="mt-4 text-sm text-muted">
              Done shows the last {BOARD_DONE_LIMIT} finished. <Link href={hrefWith(PATH, { ...keep, view: "list", status: "done" }, {})} className="font-semibold text-accent-text hover:underline">See them all</Link>
            </p>
          )}
        </Card>
      ) : groups ? (
        <div className="grid-fill [--min:22rem]">
          {groups.map((g) => (
            <Card key={g.key}>
              <CardHeader title={g.name} subtitle={`${g.tasks.filter((t) => t.status !== "done").length} open · ${g.tasks.filter((t) => t.overdue).length} overdue`} />
              <TaskRows tasks={g.tasks} query={query} />
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardHeader title={f.assignee === "me" ? "My tasks" : "List"} subtitle={`${data.total} ${data.total === 1 ? "task" : "tasks"} · soonest due first`} />
          <TaskRows tasks={tasks} query={query} />
        </Card>
      )}
      {mode === "list" && <Pagination page={data.page} pageSize={PAGE_SIZE} total={data.total} hrefFor={(p) => hrefWith(PATH, keep, { page: String(p) })} />}

      {detail && <TaskPanel task={detail} lookups={lookups} actions={actions} closeHref={hrefWith(PATH, keep, {})} />}
    </>
  );
}
