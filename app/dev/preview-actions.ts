"use server";

/** Stand-in actions for the dev-only design preview. They never touch data. */
type S = { ok?: string; error?: string; fieldErrors?: Record<string, string> };
const msg: S = { error: "Design preview only. Nothing is saved here." };

export async function previewAction(_prev: S, _fd: FormData): Promise<S> {
  return msg;
}
