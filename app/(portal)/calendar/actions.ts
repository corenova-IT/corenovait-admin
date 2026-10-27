"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actorWithPerm, errorMessage } from "@/lib/auth/session";
import * as cal from "@/lib/dal/calendar";
import type { EventType } from "@/lib/work";

/** Calendar events. Permission first, then the form, then the data-access layer. */
export type CalState = { ok?: string; error?: string };

const uuid = z.string().uuid();
const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};
const done = (ok: string): CalState => {
  revalidatePath("/calendar");
  revalidatePath("/home");
  return { ok };
};
const MISSING = "That event couldn't be found. Refresh and try again.";

export async function saveEvent(_prev: CalState, fd: FormData): Promise<CalState> {
  const id = str(fd, "id");
  const g = await actorWithPerm("calendar", id ? "edit" : "create");
  if (!g.actor) return { error: g.error };
  if (id && !uuid.safeParse(id).success) return { error: MISSING };
  const allDay = str(fd, "allDay") === "on" || str(fd, "allDay") === "true";
  const reminder = str(fd, "reminderMinutes");
  const input: cal.EventInput = {
    title: str(fd, "title"),
    type: (str(fd, "type") || "meeting") as EventType,
    allDay,
    start: str(fd, allDay ? "startDate" : "start"),
    end: str(fd, allDay ? "endDate" : "end"),
    location: str(fd, "location"),
    videoUrl: str(fd, "videoUrl"),
    description: str(fd, "description"),
    reminderMinutes: reminder === "" ? null : Number(reminder),
    attendeeIds: fd.getAll("attendeeIds").filter((v): v is string => typeof v === "string" && uuid.safeParse(v).success),
  };
  try {
    if (id) await cal.updateEvent(g.actor, id, input);
    else await cal.createEvent(g.actor, input);
    return done(id ? "Event saved." : "Event added.");
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

const moveSchema = z.object({ id: uuid, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

/** Drag to reschedule. */
export async function moveEvent(_prev: CalState, fd: FormData): Promise<CalState> {
  const g = await actorWithPerm("calendar", "edit");
  if (!g.actor) return { error: g.error };
  const v = moveSchema.safeParse({ id: fd.get("id"), date: fd.get("date") });
  if (!v.success) return { error: MISSING };
  try {
    await cal.moveEvent(g.actor, v.data.id, v.data.date);
    return done("Moved.");
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function deleteEvent(_prev: CalState, fd: FormData): Promise<CalState> {
  const g = await actorWithPerm("calendar", "delete");
  if (!g.actor) return { error: g.error };
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) return { error: MISSING };
  try {
    await cal.deleteEvent(g.actor, id.data);
    return done("Event deleted.");
  } catch (e) {
    return { error: errorMessage(e) };
  }
}
