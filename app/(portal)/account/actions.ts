"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actorForAction, clearSessionCookie, errorMessage } from "@/lib/auth/session";
import { endAllMySessions } from "@/lib/dal/auth";
import * as profile from "@/lib/dal/profile";
import { limiters, slowDown } from "@/lib/rate-limit";

/**
 * Your own profile. Every action acts on the signed-in person only: the data
 * layer takes no user ID, so a form can't point at someone else.
 */
export type ProfileState = { ok?: string; error?: string };
export type CodesState = { codes?: string[]; error?: string };

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};
const done = (ok: string): ProfileState => {
  // the name and picture show in the sidebar and top bar on every page
  revalidatePath("/", "layout");
  return { ok };
};

export async function saveProfile(_prev: ProfileState, fd: FormData): Promise<ProfileState> {
  const a = await actorForAction();
  if (!a.actor) return { error: a.error };
  try {
    await profile.updateMyProfile(a.actor, { fullName: str(fd, "fullName"), jobTitle: str(fd, "jobTitle"), phone: str(fd, "phone") });
    return done("Profile saved.");
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function uploadAvatar(_prev: ProfileState, fd: FormData): Promise<ProfileState> {
  const a = await actorForAction();
  if (!a.actor) return { error: a.error };
  const file = fd.get("picture");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a picture to upload." };
  // checked before reading the whole file into memory
  if (file.size > 2 * 1024 * 1024) return { error: "That picture is over 2 MB. Choose a smaller one." };
  const rl = limiters.uploadPerUser.hit(a.actor.userId);
  if (!rl.ok) return { error: slowDown("uploads", rl.retryAfterSec) };
  try {
    await profile.setMyAvatar(a.actor, Buffer.from(await file.arrayBuffer()));
    return done("Picture updated.");
  } catch (e) {
    return { error: errorMessage(e, "That picture couldn't be saved. Try again.") };
  }
}

export async function removeAvatar(_prev: ProfileState, _fd: FormData): Promise<ProfileState> {
  const a = await actorForAction();
  if (!a.actor) return { error: a.error };
  try {
    await profile.removeMyAvatar(a.actor);
    return done("Picture removed.");
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function changePassword(_prev: ProfileState, fd: FormData): Promise<ProfileState> {
  const a = await actorForAction();
  if (!a.actor) return { error: a.error };
  const next = str(fd, "password");
  if (next !== str(fd, "confirm")) return { error: "The two new passwords don't match." };
  const rl = limiters.passwordPerUser.hit(a.actor.userId);
  if (!rl.ok) return { error: slowDown("attempts", rl.retryAfterSec) };
  try {
    await profile.changeMyPassword(a.actor, str(fd, "current"), next);
    limiters.passwordPerUser.reset(a.actor.userId);
    return { ok: "Password changed. Every other device has been signed out." };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function regenerateCodes(_prev: CodesState, fd: FormData): Promise<CodesState> {
  const a = await actorForAction();
  if (!a.actor) return { error: a.error };
  const rl = limiters.passwordPerUser.hit(a.actor.userId);
  if (!rl.ok) return { error: slowDown("attempts", rl.retryAfterSec) };
  try {
    const codes = await profile.regenerateMyRecoveryCodes(a.actor, str(fd, "password"), str(fd, "code"));
    limiters.passwordPerUser.reset(a.actor.userId);
    revalidatePath("/account");
    return { codes };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function signOutEverywhere() {
  const a = await actorForAction();
  if (a.actor) await endAllMySessions(a.actor);
  await clearSessionCookie();
  redirect("/login?reason=signed_out");
}
