"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actorWithPerm, errorMessage } from "@/lib/auth/session";
import type { Actor } from "@/lib/dal/guard";
import * as lists from "@/lib/dal/lists";
import { updateCompanyTimezone } from "@/lib/dal/settings";

/**
 * Settings lists: streams, countries, expense categories. Admin only; the
 * data-access layer checks Settings permission, the Admin role and two-factor.
 */
export type ListState = { ok?: string; error?: string };

const kind = z.enum(["stream", "country", "category"]);
const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};
const done = (ok: string): ListState => {
  revalidatePath("/settings");
  revalidatePath("/transactions");
  revalidatePath("/streams", "layout");
  return { ok };
};

async function guard(): Promise<{ actor: Actor; error?: undefined } | { actor?: undefined; error: string }> {
  const g = await actorWithPerm("settings", "edit");
  if (!g.actor) return g;
  if (!g.actor.isAdmin) return { error: "Only admins can change these lists." };
  return g;
}

export async function saveListItem(_prev: ListState, fd: FormData): Promise<ListState> {
  const g = await guard();
  if (!g.actor) return { error: g.error };
  const k = kind.safeParse(fd.get("kind"));
  if (!k.success) return { error: "Something went wrong. Refresh and try again." };
  const id = Number(str(fd, "id")) || null;
  try {
    if (k.data === "stream") await lists.saveStream(g.actor, { id, name: str(fd, "name"), sort: str(fd, "sort") || 100 });
    if (k.data === "category") await lists.saveCategory(g.actor, { id, name: str(fd, "name"), sort: str(fd, "sort") || 100 });
    if (k.data === "country") await lists.saveCountry(g.actor, { code: str(fd, "code"), name: str(fd, "name"), sort: str(fd, "sort") || 100, isNew: fd.get("isNew") === "1" });
    return done(fd.get("isNew") === "1" || !id ? "Added." : "Saved.");
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function setListItemActive(_prev: ListState, fd: FormData): Promise<ListState> {
  const g = await guard();
  if (!g.actor) return { error: g.error };
  const k = z.enum(["stream", "category"]).safeParse(fd.get("kind"));
  const id = Number(str(fd, "id"));
  if (!k.success || !Number.isInteger(id) || id <= 0) return { error: "Something went wrong. Refresh and try again." };
  const active = fd.get("active") === "true";
  try {
    if (k.data === "stream") await lists.setStreamActive(g.actor, id, active);
    else await lists.setCategoryActive(g.actor, id, active);
    return done(active ? "Restored." : "Archived.");
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function deleteListItem(_prev: ListState, fd: FormData): Promise<ListState> {
  const g = await guard();
  if (!g.actor) return { error: g.error };
  const k = kind.safeParse(fd.get("kind"));
  if (!k.success) return { error: "Something went wrong. Refresh and try again." };
  try {
    if (k.data === "country") await lists.deleteCountry(g.actor, str(fd, "code"));
    else {
      const id = Number(str(fd, "id"));
      if (!Number.isInteger(id) || id <= 0) return { error: "Something went wrong. Refresh and try again." };
      if (k.data === "stream") await lists.deleteStream(g.actor, id);
      else await lists.deleteCategory(g.actor, id);
    }
    return done("Deleted.");
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function saveTimezone(_prev: ListState, fd: FormData): Promise<ListState> {
  const g = await actorWithPerm("settings", "edit");
  if (!g.actor) return { error: g.error };
  if (!g.actor.isAdmin) return { error: "Only admins can change company settings." };
  try {
    await updateCompanyTimezone(g.actor, str(fd, "timezone"));
    revalidatePath("/", "layout");
    return { ok: "Time zone saved. Dates, the marketing heatmap and the calendar now use it." };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}
