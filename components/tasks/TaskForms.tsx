"use client";

import { useActionState, useCallback, useEffect, useId, useState } from "react";
import { IconPlus } from "@/components/icons";
import { Msg } from "@/components/transactions/LedgerForms";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { useKeepValues } from "@/components/ui/useKeepValues";
import { PRIORITY_LABEL, TASK_PRIORITIES, TASK_STATUSES, TASK_STATUS_LABEL, type TaskPriority, type TaskStatus } from "@/lib/work";

export type TaskState = { ok?: string; error?: string };
export type TaskAction = (prev: TaskState, fd: FormData) => Promise<TaskState>;

export type TaskView = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string | null;
  assigneeName: string | null;
  assigneeAvatar: string | null;
  dueDate: string | null;
  labels: string[];
  checklist: Array<{ id: string; text: string; done: boolean }>;
  checklistDone: number;
  comments: number;
  overdue: boolean;
  canEdit: boolean;
  canDelete: boolean;
};

export type TaskLookups = {
  assignees: Array<{ id: string; name: string }>;
  /** false below the "all" scope: tasks can only be assigned to yourself */
  canChooseAssignee: boolean;
  selfId: string;
  today: string;
};

export function TaskForm({ task, lookups, action, onSaved, defaultStatus }: { task?: TaskView; lookups: TaskLookups; action: TaskAction; onSaved?: () => void; defaultStatus?: TaskStatus }) {
  const [state, formAction, pending] = useActionState(action, {});
  const submit = useKeepValues(formAction);
  const p = useId();
  useEffect(() => {
    if (state.ok && onSaved) onSaved();
  }, [state, onSaved]);
  const assignees = task?.assigneeId && !lookups.assignees.some((a) => a.id === task.assigneeId) ? [...lookups.assignees, { id: task.assigneeId, name: task.assigneeName ?? "Current assignee" }] : lookups.assignees;

  return (
    <form action={formAction} onSubmit={submit} className="flex flex-col gap-5">
      <Msg state={state} />
      {task && <input type="hidden" name="id" value={task.id} />}
      <Field label="Title" htmlFor={`${p}-title`}>
        <Input id={`${p}-title`} name="title" required maxLength={200} defaultValue={task?.title} placeholder="What needs doing" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Status" htmlFor={`${p}-status`}>
          <Select id={`${p}-status`} name="status" defaultValue={task?.status ?? defaultStatus ?? "todo"}>
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {TASK_STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Priority" htmlFor={`${p}-prio`}>
          <Select id={`${p}-prio`} name="priority" defaultValue={task?.priority ?? "medium"}>
            {TASK_PRIORITIES.map((s) => (
              <option key={s} value={s}>
                {PRIORITY_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Due" htmlFor={`${p}-due`} hint="Optional">
          <Input id={`${p}-due`} name="dueDate" type="date" defaultValue={task?.dueDate ?? ""} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Assigned to" htmlFor={`${p}-who`} hint={lookups.canChooseAssignee ? undefined : "You can assign tasks to yourself"}>
          <Select id={`${p}-who`} name="assigneeId" defaultValue={task ? (task.assigneeId ?? "") : lookups.selfId}>
            <option value="">Nobody yet</option>
            {assignees.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.id === lookups.selfId ? " (you)" : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Labels" htmlFor={`${p}-labels`} hint="Comma-separated, e.g. website, client">
          <Input id={`${p}-labels`} name="labels" maxLength={240} defaultValue={task?.labels.join(", ")} autoComplete="off" />
        </Field>
      </div>
      <Field label="Details" htmlFor={`${p}-desc`}>
        <Textarea id={`${p}-desc`} name="description" rows={4} maxLength={10_000} defaultValue={task?.description ?? ""} />
      </Field>
      <Field label="Checklist" htmlFor={`${p}-check`} hint="One item per line. Ticks are kept for lines you don't change.">
        <Textarea id={`${p}-check`} name="checklist" rows={4} maxLength={10_000} defaultValue={task?.checklist.map((c) => c.text).join("\n")} className="font-mono text-sm" />
      </Field>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : task ? "Save changes" : "Add task"}
      </Button>
    </form>
  );
}

export function AddTask({ lookups, action, initialOpen = false, label = "New task" }: { lookups: TaskLookups; action: TaskAction; initialOpen?: boolean; label?: string }) {
  const [open, setOpen] = useState(initialOpen);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <IconPlus /> {label}
      </Button>
      <Drawer open={open} onClose={close} wide title="New task" description="Give it a title; everything else is optional.">
        <TaskForm lookups={lookups} action={action} onSaved={close} />
      </Drawer>
    </>
  );
}
