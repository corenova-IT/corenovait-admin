"use client";

import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { FormMessage } from "@/components/ui/Field";
import { cx } from "@/components/ui/cx";
import { fmtShortDate } from "@/lib/format";
import { PRIORITY_LABEL, PRIORITY_TONE, TASK_STATUSES, TASK_STATUS_LABEL, taskHref, type TaskStatus } from "@/lib/work";
import type { TaskAction, TaskView } from "./TaskForms";
import { ScrollX } from "@/components/ui/ScrollX";

export function TaskMeta({ task }: { task: TaskView }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {task.priority !== "medium" && <Badge tone={PRIORITY_TONE[task.priority]}>{PRIORITY_LABEL[task.priority]}</Badge>}
      {task.dueDate && (
        <Badge tone={task.overdue ? "red" : "neutral"}>
          {task.overdue ? "Overdue · " : "Due "}
          {fmtShortDate(task.dueDate)}
        </Badge>
      )}
      {task.checklist.length > 0 && (
        <span className="font-mono text-xs text-muted" title={`${task.checklistDone} of ${task.checklist.length} checklist items done`}>
          {task.checklistDone}/{task.checklist.length} done
        </span>
      )}
      {task.comments > 0 && (
        <span className="font-mono text-xs text-muted" title={`${task.comments} comments`}>
          {task.comments} {task.comments === 1 ? "comment" : "comments"}
        </span>
      )}
    </div>
  );
}

function Card({ task, query, dragging, onDragStart, onDragEnd }: { task: TaskView; query: string; dragging: boolean; onDragStart: () => void; onDragEnd: () => void }) {
  return (
    <li
      draggable={task.canEdit}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/task-id", task.id);
        e.dataTransfer.effectAllowed = "move";
        // Chrome cancels a drag if the dragged element changes during dragstart, so restyle a frame later
        requestAnimationFrame(onDragStart);
      }}
      onDragEnd={onDragEnd}
      className={cx(
        "rounded-[14px] border bg-surface-2 transition-shadow",
        task.overdue ? "border-accent-line" : "border-line",
        task.canEdit && "cursor-grab active:cursor-grabbing",
        dragging && "opacity-50"
      )}
    >
      <Link href={taskHref(query, task.id)} scroll={false} draggable={false} className="flex flex-col gap-2 rounded-[14px] p-3.5 hover:bg-surface/40">
        <span className={cx("clamp-2 text-[15px] font-medium leading-snug text-ink", task.status === "done" && "text-ink-2 line-through decoration-muted")}>{task.title}</span>
        <TaskMeta task={task} />
        <span className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 flex-wrap gap-1">
            {task.labels.slice(0, 3).map((l) => (
              <span key={l} className="rounded-md border border-line px-1.5 py-0.5 font-mono text-[11px] text-ink-2">
                {l}
              </span>
            ))}
          </span>
          {task.assigneeName ? (
            <span className="flex shrink-0 items-center" title={`Assigned to ${task.assigneeName}`}>
              <Avatar name={task.assigneeName} src={task.assigneeAvatar} size={26} />
              <span className="sr-only">Assigned to {task.assigneeName}</span>
            </span>
          ) : (
            <span className="shrink-0 text-xs text-muted">Unassigned</span>
          )}
        </span>
      </Link>
    </li>
  );
}

/**
 * To do / In progress / Review / Done. Drag a card to another column to move
 * it (the task panel's status menu does the same from the keyboard).
 */
export function Board({ tasks, query, move }: { tasks: TaskView[]; query: string; move: TaskAction }) {
  const [optimistic, setOptimistic] = useOptimistic(tasks, (list, change: { id: string; status: TaskStatus }) => list.map((t) => (t.id === change.id ? { ...t, status: change.status } : t)));
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<TaskStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const drop = (status: TaskStatus, id: string) => {
    const task = optimistic.find((t) => t.id === id);
    if (!task || task.status === status || !task.canEdit) return;
    setError(null);
    startTransition(async () => {
      setOptimistic({ id, status });
      const fd = new FormData();
      fd.set("id", id);
      fd.set("status", status);
      const r = await move({}, fd);
      if (r.error) setError(r.error);
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {error && <FormMessage tone="error">{error}</FormMessage>}
      <ScrollX label="Task board" className="-mx-1 px-1 pb-1">
        <div className="grid min-w-[52rem] grid-cols-4 gap-3">
          {TASK_STATUSES.map((status) => {
            const col = optimistic.filter((t) => t.status === status);
            return (
              <section
                key={status}
                aria-label={`${TASK_STATUS_LABEL[status]}, ${col.length} tasks`}
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes("text/task-id")) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setOver(status);
                }}
                onDragLeave={() => setOver((o) => (o === status ? null : o))}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver(null);
                  drop(status, e.dataTransfer.getData("text/task-id"));
                }}
                className={cx("flex min-w-0 flex-col gap-3 rounded-[18px] border bg-surface/60 p-3", over === status ? "border-accent-line" : "border-line")}
              >
                <h3 className="flex items-center justify-between px-1 pt-1">
                  <span className="label-mono">{TASK_STATUS_LABEL[status]}</span>
                  <span className="font-mono text-xs text-muted">{col.length}</span>
                </h3>
                {col.length === 0 ? (
                  <p className="rounded-[14px] border border-dashed border-line px-3 py-6 text-center text-sm text-muted">{dragging ? "Drop here" : "Nothing here"}</p>
                ) : (
                  <ul className="flex flex-col gap-2.5">
                    {col.map((t) => (
                      <Card key={t.id} task={t} query={query} dragging={dragging === t.id} onDragStart={() => setDragging(t.id)} onDragEnd={() => setDragging(null)} />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      </ScrollX>
    </div>
  );
}
