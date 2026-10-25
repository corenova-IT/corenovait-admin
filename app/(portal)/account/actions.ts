"use server";

import { redirect } from "next/navigation";
import { actorForAction, clearSessionCookie, errorMessage } from "@/lib/auth/session";
import { endAllMySessions, regenerateRecoveryCodes } from "@/lib/dal/auth";

export type CodesState = { codes?: string[]; error?: string };

export async function regenerateCodes(_prev: CodesState, _fd: FormData): Promise<CodesState> {
  const a = await actorForAction();
  if (!a.actor) return { error: a.error };
  try {
    return { codes: await regenerateRecoveryCodes(a.actor) };
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
