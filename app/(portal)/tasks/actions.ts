"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actorWithPerm, errorMessage } from "@/lib/auth/session";
import * as tk from "@/lib/dal/tasks";
import { TASK_STATUSES, type TaskStatus } from "@/lib/work";

/** Tasks: the board, list, checklist and comments. Permission first, then the form, then the data-access layer. */
export type TaskState = { ok?: string; error?: string };

const uuid = z.string().uuid();
const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};
const done = (ok: string): TaskState => {
  revalidatePath("/tasks");
  revalidatePath("/home");
  revalidatePath("/calendar");
  return { ok };
};
const MISSING = "That task couldn't be found. Refresh and try again.";

export async function saveTask(_prev: TaskState, fd: FormData): Promise<TaskState> {
  const id = str(fd, "id");
  const g = await actorWithPerm("tasks", id ? "edit" : "create");
  if (!g.actor) return { error: g.error };
  if (id && !uuid.safeParse(id).success) return { error: MISSING };
  const input: tk.TaskInput = {
    title: str(fd, "title"),
    description: str(fd, "description"),
    status: (str(fd, "status") || "todo") as TaskStatus,
    priority: (str(fd, "priority") || "medium") as tk.TaskInput["priority"],
    assigneeId: str(fd, "assigneeId") || null,
    dueDate: str(fd, "dueDate") || null,
    labels: str(fd, "labels"),
    checklist: str(fd, "checklist"),
  };
  try {
    if (id) await tk.updateTask(g.actor, id, input);
    else await tk.createTask(g.actor, input);
    return done(id ? "Task saved." : "Task added.");
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

const statusSchema = z.object({ id: uuid, status: z.enum(TASK_STATUSES) });

/** Moving a card on the board, or the status menu. */
export async function setTaskStatus(_prev: TaskState, fd: FormData): Promise<TaskState> {
  const g = await actorWithPerm("tasks", "edit");
  if (!g.actor) return { error: g.error };
  const v = statusSchema.safeParse({ id: fd.get("id"), status: fd.get("status") });
  if (!v.success) return { error: MISSING };
  try {
    await tk.setTaskStatus(g.actor, v.data.id, v.data.status);
    return done("Moved.");
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

const tickSchema = z.object({ id: uuid, itemId: z.string().min(1).max(40), done: z.enum(["true", "false"]) });

export async function toggleChecklist(_prev: TaskState, fd: FormData): Promise<TaskState> {
  const g = await actorWithPerm("tasks", "edit");
  if (!g.actor) return { error: g.error };
  const v = tickSchema.safeParse({ id: fd.get("id"), itemId: fd.get("itemId"), done: fd.get("done") });
  if (!v.success) return { error: MISSING };
  try {
    await tk.toggleChecklistItem(g.actor, v.data.id, v.data.itemId, v.data.done === "true");
    return done("Checklist updated.");
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function addComment(_prev: TaskState, fd: FormData): Promise<TaskState> {
  const g = await actorWithPerm("tasks", "create");
  if (!g.actor) return { error: g.error };
  const id = uuid.safeParse(fd.get("taskId"));
  if (!id.success) return { error: MISSING };
  try {
    await tk.addComment(g.actor, id.data, str(fd, "body"));
    return done("Comment added.");
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function deleteComment(_prev: TaskState, fd: FormData): Promise<TaskState> {
  const g = await actorWithPerm("tasks", "view");
  if (!g.actor) return { error: g.error };
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) return { error: "That comment couldn't be found. Refresh and try again." };
  try {
    await tk.deleteComment(g.actor, id.data);
    return done("Comment deleted.");
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function deleteTask(_prev: TaskState, fd: FormData): Promise<TaskState> {
  const g = await actorWithPerm("tasks", "delete");
  if (!g.actor) return { error: g.error };
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) return { error: MISSING };
  try {
    await tk.deleteTask(g.actor, id.data);
    return done("Task deleted.");
  } catch (e) {
    return { error: errorMessage(e) };
  }
}
