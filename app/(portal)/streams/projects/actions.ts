"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actorForAction, errorMessage } from "@/lib/auth/session";
import * as projects from "@/lib/dal/projects";

/** Owner-only. The data-access layer checks "owner + two-factor done" again on every call. */
export type ProjectState = { ok?: string; error?: string };

const uuid = z.string().uuid();
const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};
const done = (ok: string): ProjectState => {
  revalidatePath("/streams", "layout");
  revalidatePath("/transactions");
  return { ok };
};
const bad = (what: string): ProjectState => ({ error: `${what} couldn't be found. Refresh and try again.` });

/** Checked before the form is even read, so a refused request learns nothing about what the form should hold. */
async function ownerOnly() {
  const g = await actorForAction();
  if (!g.actor) return g;
  if (!g.actor.isOwner) return { error: "Only the owner can do that." };
  return g;
}

export async function saveProject(_prev: ProjectState, fd: FormData): Promise<ProjectState> {
  const g = await ownerOnly();
  if (!g.actor) return { error: g.error };
  const id = str(fd, "id");
  try {
    if (id) {
      if (!uuid.safeParse(id).success) return bad("That project");
      await projects.renameProject(g.actor, id, str(fd, "name"));
      return done("Project renamed.");
    }
    await projects.createProject(g.actor, { streamId: Number(str(fd, "streamId")), name: str(fd, "name") });
    return done("Project added.");
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function setProjectActive(_prev: ProjectState, fd: FormData): Promise<ProjectState> {
  const g = await ownerOnly();
  if (!g.actor) return { error: g.error };
  const id = uuid.safeParse(str(fd, "id"));
  if (!id.success) return bad("That project");
  try {
    const active = str(fd, "active") === "1";
    await projects.setProjectActive(g.actor, id.data, active);
    return done(active ? "Project switched on." : "Project switched off.");
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function deleteProject(_prev: ProjectState, fd: FormData): Promise<ProjectState> {
  const g = await ownerOnly();
  if (!g.actor) return { error: g.error };
  const id = uuid.safeParse(str(fd, "id"));
  if (!id.success) return bad("That project");
  try {
    await projects.deleteProject(g.actor, id.data);
    return done("Project deleted.");
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

/** The checked people are the ones who can NOT see the project's money. */
export async function saveHiddenFrom(_prev: ProjectState, fd: FormData): Promise<ProjectState> {
  const g = await ownerOnly();
  if (!g.actor) return { error: g.error };
  const id = uuid.safeParse(str(fd, "id"));
  if (!id.success) return bad("That project");
  const ids = fd.getAll("userId").filter((v): v is string => typeof v === "string");
  if (!ids.every((v) => uuid.safeParse(v).success)) return bad("One of those people");
  try {
    await projects.setProjectHiddenFrom(g.actor, id.data, ids);
    return done(ids.length ? `Hidden from ${ids.length} ${ids.length === 1 ? "person" : "people"}.` : "Visible to everyone with access.");
  } catch (e) {
    return { error: errorMessage(e) };
  }
}
