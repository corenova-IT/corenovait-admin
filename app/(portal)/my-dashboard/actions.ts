"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actorWithPerm, errorMessage } from "@/lib/auth/session";
import * as emp from "@/lib/dal/partner-employees";
import * as pp from "@/lib/dal/partner-projects";
import * as w from "@/lib/dal/partner-writes";
import { inviteEmail, sendMail } from "@/lib/email";

/**
 * A stream partner's own expenses, subscriptions and tasks. Permission first, then the form, then the
 * data-access layer (which checks the stream, country and project against their assignment again).
 */
export type PartnerState = { ok?: string; error?: string };

const uuid = z.string().uuid();
const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};
const done = (ok: string): PartnerState => {
  revalidatePath("/my-dashboard", "layout");
  return { ok };
};

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254),
  fullName: z.string().trim().min(1, "Enter their name.").max(120),
  jobTitle: z.string().trim().max(120),
});

/** Invites an employee for THIS partner: always the Employee role, never anything higher. */
export async function inviteEmployee(_prev: PartnerState, fd: FormData): Promise<PartnerState> {
  const g = await actorWithPerm("stream_partner", "create");
  if (!g.actor) return { error: g.error };
  const parsed = inviteSchema.safeParse({ email: str(fd, "email"), fullName: str(fd, "fullName"), jobTitle: str(fd, "jobTitle") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the details and try again." };
  try {
    const inv = await emp.inviteMyEmployee(g.actor, parsed.data);
    const mail = await sendMail(inviteEmail(inv.email, inv.name, inv.token, g.actor.fullName || g.actor.email));
    revalidatePath("/my-dashboard", "layout");
    return mail.ok ? { ok: `Invite sent to ${inv.email}.` } : { error: `${inv.email} was added, but the email couldn't be sent. Ask an admin to re-send the invite.` };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function saveProject(_prev: PartnerState, fd: FormData): Promise<PartnerState> {
  const g = await actorWithPerm("stream_partner", "create");
  if (!g.actor) return { error: g.error };
  const id = str(fd, "id");
  if (id && !uuid.safeParse(id).success) return { error: "That no longer exists." };
  try {
    if (id) await pp.renameMyProject(g.actor, id, str(fd, "name"));
    else await pp.createMyProject(g.actor, { streamId: Number(str(fd, "streamId")), name: str(fd, "name") });
    return done(id ? "Project saved." : "Project added.");
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

/** Team visible and who is on the project, saved together. */
export async function saveProjectTeam(_prev: PartnerState, fd: FormData): Promise<PartnerState> {
  const g = await actorWithPerm("stream_partner", "edit");
  if (!g.actor) return { error: g.error };
  const id = uuid.safeParse(fd.get("id"));
  const people = z.array(z.string().uuid()).max(500).safeParse(fd.getAll("employeeIds"));
  if (!id.success || !people.success) return { error: "That no longer exists." };
  try {
    await pp.setMyProjectTeamVisible(g.actor, id.data, fd.get("teamVisible") === "on");
    await pp.setMyProjectMembers(g.actor, id.data, people.data);
    return done("Project team saved.");
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function setProjectActive(_prev: PartnerState, fd: FormData): Promise<PartnerState> {
  const g = await actorWithPerm("stream_partner", "edit");
  if (!g.actor) return { error: g.error };
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) return { error: "That no longer exists." };
  try {
    const active = fd.get("active") === "true";
    await pp.setMyProjectActive(g.actor, id.data, active);
    return done(active ? "Project restored." : "Project archived.");
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function saveExpense(_prev: PartnerState, fd: FormData): Promise<PartnerState> {
  const g = await actorWithPerm("stream_partner", "create");
  if (!g.actor) return { error: g.error };
  const id = str(fd, "id");
  if (id && !uuid.safeParse(id).success) return { error: "That no longer exists." };
  const input = {
    expenseDate: str(fd, "expenseDate"),
    category: str(fd, "category"),
    vendor: str(fd, "vendor"),
    description: str(fd, "description"),
    amount: str(fd, "amount"),
    currency: str(fd, "currency"),
    fxRate: str(fd, "fxRate") || "1",
    isRecurring: fd.get("isRecurring") === "on",
    countryCode: str(fd, "countryCode") || null,
    streamId: str(fd, "streamId") || null,
  };
  try {
    if (id) await w.updateMyExpense(g.actor, id, input);
    else await w.createMyExpense(g.actor, input);
    return done(id ? "Expense saved." : "Expense added.");
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function archiveExpense(_prev: PartnerState, fd: FormData): Promise<PartnerState> {
  const g = await actorWithPerm("stream_partner", "edit");
  if (!g.actor) return { error: g.error };
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) return { error: "That no longer exists." };
  try {
    await w.archiveMyExpense(g.actor, id.data);
    return done("Expense archived.");
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function saveSubscription(_prev: PartnerState, fd: FormData): Promise<PartnerState> {
  const g = await actorWithPerm("stream_partner", "create");
  if (!g.actor) return { error: g.error };
  const id = str(fd, "id");
  if (id && !uuid.safeParse(id).success) return { error: "That no longer exists." };
  const input = {
    vendor: str(fd, "vendor"),
    category: str(fd, "category"),
    description: str(fd, "description"),
    amount: str(fd, "amount"),
    currency: str(fd, "currency"),
    fxRate: str(fd, "fxRate") || "1",
    billingCycle: (str(fd, "billingCycle") || "monthly") as "monthly",
    nextDueDate: str(fd, "nextDueDate"),
    reminderDays: str(fd, "reminderDays") || "3",
    paidFrom: str(fd, "paidFrom"),
    countryCode: str(fd, "countryCode") || null,
    streamId: str(fd, "streamId") || null,
  };
  try {
    if (id) await w.updateMySubscription(g.actor, id, input);
    else await w.createMySubscription(g.actor, input);
    return done(id ? "Subscription saved." : "Subscription added.");
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function markSubscriptionPaid(_prev: PartnerState, fd: FormData): Promise<PartnerState> {
  const g = await actorWithPerm("stream_partner", "edit");
  if (!g.actor) return { error: g.error };
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) return { error: "That no longer exists." };
  try {
    const r = await w.markMySubscriptionPaid(g.actor, id.data, { paidDate: str(fd, "paidDate") || undefined });
    return done(r.nextDueDate ? `Marked paid. Next due ${r.nextDueDate}.` : "Marked paid. This one-off subscription is now complete.");
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function archiveSubscription(_prev: PartnerState, fd: FormData): Promise<PartnerState> {
  const g = await actorWithPerm("stream_partner", "edit");
  if (!g.actor) return { error: g.error };
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) return { error: "That no longer exists." };
  try {
    await w.archiveMySubscription(g.actor, id.data);
    return done("Subscription archived.");
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function saveTask(_prev: PartnerState, fd: FormData): Promise<PartnerState> {
  const g = await actorWithPerm("stream_partner", "create");
  if (!g.actor) return { error: g.error };
  const id = str(fd, "id");
  if (id && !uuid.safeParse(id).success) return { error: "That no longer exists." };
  const input = {
    title: str(fd, "title"),
    description: str(fd, "description"),
    status: (str(fd, "status") || "todo") as "todo",
    priority: (str(fd, "priority") || "medium") as "medium",
    dueDate: str(fd, "dueDate") || null,
    streamId: str(fd, "streamId"),
    projectId: str(fd, "projectId") || null,
    assigneeId: str(fd, "assigneeId") || null,
  };
  try {
    if (id) await w.updateMyTask(g.actor, id, input);
    else await w.createMyTask(g.actor, input);
    return done(id ? "Task saved." : "Task added.");
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function archiveTask(_prev: PartnerState, fd: FormData): Promise<PartnerState> {
  const g = await actorWithPerm("stream_partner", "edit");
  if (!g.actor) return { error: g.error };
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) return { error: "That no longer exists." };
  try {
    await w.archiveMyTask(g.actor, id.data);
    return done("Task archived.");
  } catch (e) {
    return { error: errorMessage(e) };
  }
}
