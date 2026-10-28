"use client";

import { useRouter } from "next/navigation";
import { useActionState, useCallback, useEffect, useState, useTransition } from "react";
import { Msg } from "@/components/transactions/LedgerForms";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Drawer, Modal } from "@/components/ui/Dialog";
import { Field, Select, Textarea } from "@/components/ui/Field";
import { cx } from "@/components/ui/cx";
import { useKeepValues } from "@/components/ui/useKeepValues";
import { fmtDate } from "@/lib/format";
import { PRIORITY_LABEL, PRIORITY_TONE, TASK_STATUSES, TASK_STATUS_LABEL, type TaskStatus } from "@/lib/work";
import { TaskForm, type TaskAction, type TaskLookups, type TaskView } from "./TaskForms";

export type TaskDetail = TaskView & {
  commentList: Array<{ id: string; body: string; createdAt: string; authorName: string | null; authorAvatar: string | null; mine: boolean }>;
  canComment: boolean;
  canModerate: boolean;
};

type Actions = { save: TaskAction; status: TaskAction; tick: TaskAction; comment: TaskAction; uncomment: TaskAction; remove: TaskAction };

/** Fire a server action from a button (status, ticks, comment delete) and show any error. */
function useQuick(action: TaskAction) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fields: Record<string, string>) =>
    start(async () => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields)) fd.set(k, v);
      const r = await action({}, fd);
      setError(r.error ?? null);
    });
  return { pending, error, run };
}

/**
 * One task, opened from the board or list (?task=…): details, status,
 * checklist, comments, edit and delete. Closing it returns to the page.
 */
export function TaskPanel({ task, lookups, actions, closeHref }: { task: TaskDetail; lookups: TaskLookups; actions: Actions; closeHref: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const close = useCallback(() => router.replace(closeHref, { scroll: false }), [router, closeHref]);
  const status = useQuick(actions.status);
  const tick = useQuick(actions.tick);
  const uncomment = useQuick(actions.uncomment);
  const [commentState, commentAction, commenting] = useActionState(actions.comment, {});
  const submitComment = useKeepValues(commentAction);
  const [commentKey, setCommentKey] = useState(0);
  const [delState, delAction, deleting] = useActionState(actions.remove, {});
  useEffect(() => {
    if (commentState.ok) setCommentKey((k) => k + 1);
  }, [commentState]);
  useEffect(() => {
    if (delState.ok) close();
  }, [delState, close]);
  const onSaved = useCallback(() => setEditing(false), []);
  const error = status.error ?? tick.error ?? uncomment.error;

  return (
    <Drawer open onClose={close} wide title={task.title} description={task.assigneeName ? `Assigned to ${task.assigneeName}` : "Not assigned yet"}>
      {editing ? (
        <div className="flex flex-col gap-4">
          <TaskForm task={task} lookups={lookups} action={actions.save} onSaved={onSaved} />
          <Button variant="ghost" className="self-start" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {error && <Msg state={{ error }} />}
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Status" htmlFor="task-status" className="min-w-[11rem]">
              <Select
                id="task-status"
                value={task.status}
                disabled={!task.canEdit || status.pending}
                onChange={(e) => status.run({ id: task.id, status: e.target.value as TaskStatus })}
              >
                {TASK_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {TASK_STATUS_LABEL[s]}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex flex-wrap items-center gap-2 pb-2.5">
              <Badge tone={PRIORITY_TONE[task.priority]}>{PRIORITY_LABEL[task.priority]} priority</Badge>
              {task.dueDate && <Badge tone={task.overdue ? "red" : "neutral"}>{task.overdue ? `Overdue since ${fmtDate(task.dueDate)}` : `Due ${fmtDate(task.dueDate)}`}</Badge>}
              {task.labels.map((l) => (
                <span key={l} className="rounded-md border border-line px-1.5 py-0.5 font-mono text-[11px] text-ink-2">
                  {l}
                </span>
              ))}
            </div>
          </div>

          {task.description && <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink-2">{task.description}</p>}

          {task.checklist.length > 0 && (
            <section aria-labelledby="checklist-h">
              <h3 id="checklist-h" className="label-mono mb-2">
                Checklist · {task.checklistDone}/{task.checklist.length}
              </h3>
              <ul className="flex flex-col gap-1">
                {task.checklist.map((c) => (
                  <li key={c.id}>
                    <label className={cx("flex items-start gap-3 rounded-xl px-2 py-2 hover:bg-surface-2", task.canEdit && "cursor-pointer")}>
                      <input
                        type="checkbox"
                        className="mt-1 size-4 accent-[var(--accent)]"
                        checked={c.done}
                        disabled={!task.canEdit || tick.pending}
                        onChange={(e) => tick.run({ id: task.id, itemId: c.id, done: String(e.target.checked) })}
                      />
                      <span className={cx("text-[15px]", c.done ? "text-muted line-through" : "text-ink")}>{c.text}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="comments-h" className="flex flex-col gap-3">
            <h3 id="comments-h" className="label-mono">
              Comments · {task.commentList.length}
            </h3>
            {task.commentList.length === 0 && <p className="text-sm text-muted">No comments yet.</p>}
            <ul className="flex flex-col gap-3">
              {task.commentList.map((c) => (
                <li key={c.id} className="flex gap-3">
                  <Avatar name={c.authorName ?? "?"} src={c.authorAvatar} size={30} />
                  <div className="min-w-0 flex-1 rounded-[14px] border border-line bg-surface-2 px-3.5 py-2.5">
                    <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-muted">
                      <span className="font-semibold text-ink">{c.authorName ?? "Former member"}</span>
                      <span className="font-mono">{new Date(c.createdAt).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}</span>
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-[15px] leading-relaxed text-ink [overflow-wrap:anywhere]">{c.body}</p>
                    {(c.mine || task.canModerate) && (
                      <button type="button" className="mt-1 text-xs text-muted hover:text-accent-text" disabled={uncomment.pending} onClick={() => uncomment.run({ id: c.id })}>
                        Delete comment
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {task.canComment && (
              <form key={commentKey} action={commentAction} onSubmit={submitComment} className="flex flex-col gap-2">
                <Msg state={commentState.error ? commentState : {}} />
                <input type="hidden" name="taskId" value={task.id} />
                <label htmlFor="comment-body" className="sr-only">
                  Add a comment
                </label>
                <Textarea id="comment-body" name="body" rows={2} maxLength={5000} required placeholder="Add a comment" />
                <Button type="submit" size="sm" variant="secondary" disabled={commenting} className="self-start">
                  {commenting ? "Posting…" : "Post comment"}
                </Button>
              </form>
            )}
          </section>

          {(task.canEdit || task.canDelete) && (
            <div className="flex flex-wrap gap-2 border-t border-line pt-5">
              {task.canEdit && (
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  Edit task
                </Button>
              )}
              {task.canDelete && (
                <Button variant="ghost" className="text-accent-text" onClick={() => setConfirm(true)}>
                  Delete
                </Button>
              )}
            </div>
          )}
        </div>
      )}
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Delete this task?" description="Its checklist and comments go with it. The audit log keeps a copy. This can't be undone.">
        <form action={delAction} className="flex flex-col gap-4">
          <Msg state={delState} />
          <input type="hidden" name="id" value={task.id} />
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Keep it
            </Button>
            <Button type="submit" variant="danger" disabled={deleting}>
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </form>
      </Modal>
    </Drawer>
  );
}
