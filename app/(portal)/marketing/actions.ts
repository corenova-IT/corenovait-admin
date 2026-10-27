"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actorWithPerm, errorMessage } from "@/lib/auth/session";
import * as mkt from "@/lib/dal/marketing";

/** Marketing: the activity log and campaigns. Permission first, then the form, then the data-access layer. */
export type MktState = { ok?: string; error?: string; savedAt?: number };

const uuid = z.string().uuid();
const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};
const done = (ok: string): MktState => {
  revalidatePath("/marketing");
  revalidatePath("/home");
  return { ok, savedAt: Date.now() };
};
const MISSING = "That couldn't be found. Refresh and try again.";

export async function saveActivity(_prev: MktState, fd: FormData): Promise<MktState> {
  const id = str(fd, "id");
  const g = await actorWithPerm("marketing", id ? "edit" : "create");
  if (!g.actor) return { error: g.error };
  if (id && !uuid.safeParse(id).success) return { error: MISSING };
  const input: mkt.ActivityInput = {
    occurredAt: str(fd, "occurredAt"),
    channel: str(fd, "channel") as mkt.ActivityInput["channel"],
    campaignId: str(fd, "campaignId") || null,
    contactName: str(fd, "contactName"),
    contactCompany: str(fd, "contactCompany"),
    outcome: str(fd, "outcome") as mkt.ActivityInput["outcome"],
    dealValue: str(fd, "dealValue"),
    dealCurrency: str(fd, "dealCurrency"),
    dealFxRate: str(fd, "dealFxRate"),
    ownerId: str(fd, "ownerId") || null,
    notes: str(fd, "notes"),
  };
  try {
    if (id) await mkt.updateActivity(g.actor, id, input);
    else await mkt.createActivity(g.actor, input);
    return done(id ? "Activity saved." : "Logged. Add the next one, or close this panel.");
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function deleteActivity(_prev: MktState, fd: FormData): Promise<MktState> {
  const g = await actorWithPerm("marketing", "delete");
  if (!g.actor) return { error: g.error };
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) return { error: MISSING };
  try {
    await mkt.deleteActivity(g.actor, id.data);
    return done("Activity deleted.");
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function saveCampaign(_prev: MktState, fd: FormData): Promise<MktState> {
  const id = str(fd, "id");
  const g = await actorWithPerm("marketing", id ? "edit" : "create");
  if (!g.actor) return { error: g.error };
  if (id && !uuid.safeParse(id).success) return { error: MISSING };
  try {
    await mkt.saveCampaign(g.actor, id || null, {
      name: str(fd, "name"),
      channel: (str(fd, "channel") || null) as mkt.CampaignInput["channel"],
      status: (str(fd, "status") || "active") as mkt.CampaignInput["status"],
      startDate: str(fd, "startDate") || null,
      endDate: str(fd, "endDate") || null,
      description: str(fd, "description"),
    });
    return done(id ? "Campaign saved." : "Campaign added.");
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function deleteCampaign(_prev: MktState, fd: FormData): Promise<MktState> {
  const g = await actorWithPerm("marketing", "delete");
  if (!g.actor) return { error: g.error };
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) return { error: MISSING };
  try {
    await mkt.deleteCampaign(g.actor, id.data);
    return done("Campaign deleted.");
  } catch (e) {
    return { error: errorMessage(e) };
  }
}
