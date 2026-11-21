import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema, type Tx } from "@/lib/db";
import { actorRef, writeAudit } from "./audit";
import { mysqlCode } from "./assignments";
import { RuleError, requireAdmin, requirePerm, type Actor } from "./guard";
import { checkNichePair, findOrAddSubNiche, nicheNames } from "./niches";
import { ownEmployee } from "./partner-employees";
import { NotFound, assertStreamAllowed, notHiddenFrom, partnerScope, streamRowsWhere } from "./scope";

/**
 * Projects for a Partner, inside their own streams only.
 *
 * What a partner CAN do: see, create, rename and archive projects in their streams, switch "Team visible"
 * on or off, and put their own employees on a project. What stays Owner-only, untouched: who a project's
 * money is hidden from, partner shares, "apply shares", deleting, and the Owner's Projects page. A project
 * the Owner hid from the partner doesn't exist for them.
 *
 * Every change is logged under the entity name "partner_projects" (not "projects", which the audit log
 * hides from admins who aren't the Owner), so admins see a partner's project changes on their page.
 */
const { projects, projectMembers, users, streams, employeeAssignments, streamPartnerStreams } = schema;

const TAKEN = "That name can't be used in this stream. Try another.";

export type MyProject = {
  id: string;
  name: string;
  stream: string;
  streamId: number;
  active: boolean;
  teamVisible: boolean;
  nicheId: number | null;
  subNicheId: number | null;
  niche: string | null;
  subNiche: string | null;
  /** who leads the project: the partner or one of their employees */
  leadId: string | null;
  leadName: string | null;
  members: Array<{ id: string; name: string }>;
};

function ensure(actor: Actor, action: "view" | "create" | "edit") {
  requirePerm(actor, "stream_partner", action);
  partnerScope(actor);
}

const own = (db: ReturnType<typeof getDb> | Tx, actor: Actor) => and(streamRowsWhere(actor, { streamId: projects.streamId }), notHiddenFrom(db, actor, projects.id));

export async function myProjects(actor: Actor): Promise<MyProject[]> {
  ensure(actor, "view");
  const db = getDb();
  const rows = await db
    .select({ id: projects.id, name: projects.name, streamId: projects.streamId, stream: streams.name, active: projects.active, teamVisible: projects.teamVisible, nicheId: projects.nicheId, subNicheId: projects.subNicheId, leadId: projects.leadUserId })
    .from(projects)
    .innerJoin(streams, eq(streams.id, projects.streamId))
    .where(own(db, actor))
    .orderBy(asc(streams.name), asc(projects.name));
  if (!rows.length) return [];
  const members = await db
    .select({ projectId: projectMembers.projectId, id: users.id, name: users.fullName, email: users.email })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(inArray(projectMembers.projectId, rows.map((r) => r.id)))
    .orderBy(asc(users.fullName));
  const names = await nicheNames(db, [...new Set(rows.map((r) => r.nicheId).filter((x): x is number => x !== null))], [...new Set(rows.map((r) => r.subNicheId).filter((x): x is number => x !== null))]);
  const leadIds = [...new Set(rows.map((r) => r.leadId).filter((x): x is string => !!x))];
  const leads = leadIds.length ? await db.select({ id: users.id, name: users.fullName, email: users.email }).from(users).where(inArray(users.id, leadIds)) : [];
  return rows.map((r) => ({
    ...r,
    niche: r.nicheId ? names.niche.get(r.nicheId) ?? null : null,
    subNiche: r.subNicheId ? names.sub.get(r.subNicheId) ?? null : null,
    leadName: r.leadId ? (leads.find((l) => l.id === r.leadId)?.name || leads.find((l) => l.id === r.leadId)?.email) ?? null : null,
    members: members.filter((m) => m.projectId === r.id).map((m) => ({ id: m.id, name: m.name || m.email })),
  }));
}

async function loadMine(tx: Tx, actor: Actor, id: string) {
  const [p] = await tx.select().from(projects).where(and(eq(projects.id, id), own(tx, actor))).for("update");
  if (!p) throw new NotFound();
  return p;
}

const cleanName = (raw: string) => {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) throw new RuleError("Give the project a name.");
  if (name.length > 120) throw new RuleError("Use 120 characters or fewer.");
  return name;
};

async function guardedName<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (mysqlCode(e) === "ER_DUP_ENTRY") throw new RuleError(TAKEN);
    throw e;
  }
}

export type ProjectDetailsInput = {
  nicheId?: number | string | null;
  subNicheId?: number | string | null;
  /** a sub-category typed in by the partner ("add your own"); it is created (or reused) under the chosen niche */
  newSubNiche?: string | null;
  /** the lead: the partner themselves (default) or one of their employees */
  leadUserId?: string | null;
};

const asId = (v: number | string | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v) || null);

/** Works out the niche, sub-category and lead from a form, checking each one against what this partner may use. */
async function resolveDetails(tx: Tx, actor: Actor, input: ProjectDetailsInput) {
  const nicheId = asId(input.nicheId);
  let subNicheId = asId(input.subNicheId);
  const typed = (input.newSubNiche ?? "").trim();
  if (typed) {
    if (!nicheId) throw new RuleError("Choose a niche before adding your own sub-category.");
    subNicheId = await findOrAddSubNiche(tx, actor, nicheId, typed);
  }
  await checkNichePair(tx, nicheId, subNicheId);
  const lead = input.leadUserId || actor.userId;
  if (lead !== actor.userId) await ownEmployee(tx, actor, lead); // someone else's employee = not found
  return { nicheId, subNicheId: nicheId ? subNicheId : null, leadUserId: lead };
}

/** An employee who leads a project is also on it (so they can see it). The partner as lead needs no membership. */
async function leadIsMember(tx: Tx, actor: Actor, projectId: string, leadUserId: string) {
  if (leadUserId === actor.userId) return;
  await tx.insert(projectMembers).values({ projectId, userId: leadUserId, addedBy: actor.userId }).onDuplicateKeyUpdate({ set: { projectId: sql`${projectMembers.projectId}` } });
}

export async function createMyProject(actor: Actor, input: { streamId: number; name: string } & ProjectDetailsInput): Promise<string> {
  ensure(actor, "create");
  const name = cleanName(input.name);
  const streamId = Number(input.streamId);
  assertStreamAllowed(actor, streamId);
  const id = crypto.randomUUID();
  await guardedName(() =>
    getDb().transaction(async (tx) => {
      const d = await resolveDetails(tx, actor, input);
      await tx.insert(projects).values({ id, streamId, name, createdBy: actor.userId, ...d });
      await leadIsMember(tx, actor, id, d.leadUserId);
      await writeAudit(tx, actorRef(actor), { action: "create", entity: "partner_projects", entityId: id, summary: `Added project: ${name}`, after: { name, streamId, active: true, teamVisible: false, ...d } });
    })
  );
  return id;
}

/** Changes a project's niche, sub-category and lead. Logged with before and after. */
export async function setMyProjectDetails(actor: Actor, id: string, input: ProjectDetailsInput) {
  ensure(actor, "edit");
  await getDb().transaction(async (tx) => {
    const p = await loadMine(tx, actor, id);
    const d = await resolveDetails(tx, actor, input);
    await leadIsMember(tx, actor, id, d.leadUserId);
    if (p.nicheId === d.nicheId && p.subNicheId === d.subNicheId && p.leadUserId === d.leadUserId) return;
    await tx.update(projects).set(d).where(eq(projects.id, id));
    await writeAudit(tx, actorRef(actor), {
      action: "update",
      entity: "partner_projects",
      entityId: id,
      summary: `Edited project: kind of work or lead changed for ${p.name}`,
      before: { nicheId: p.nicheId, subNicheId: p.subNicheId, leadUserId: p.leadUserId },
      after: d,
    });
  });
}

export async function renameMyProject(actor: Actor, id: string, rawName: string) {
  ensure(actor, "edit");
  const name = cleanName(rawName);
  await guardedName(() =>
    getDb().transaction(async (tx) => {
      const p = await loadMine(tx, actor, id);
      if (p.name === name) return;
      await tx.update(projects).set({ name }).where(eq(projects.id, id));
      await writeAudit(tx, actorRef(actor), { action: "update", entity: "partner_projects", entityId: id, summary: `Edited project: renamed ${p.name} to ${name}`, before: { name: p.name }, after: { name } });
    })
  );
}

/** Archive (switch off) or bring back a project. Nothing is deleted. */
export async function setMyProjectActive(actor: Actor, id: string, active: boolean) {
  ensure(actor, "edit");
  await getDb().transaction(async (tx) => {
    const p = await loadMine(tx, actor, id);
    if (p.active === active) return;
    await tx.update(projects).set({ active }).where(eq(projects.id, id));
    await writeAudit(tx, actorRef(actor), { action: active ? "update" : "archive", entity: "partner_projects", entityId: id, summary: `${active ? "Restored" : "Archived"} project: ${p.name}`, before: { active: p.active }, after: { active } });
  });
}

/** "Team visible": when on, employees on this project see each other's name and online status, nothing else. */
export async function setMyProjectTeamVisible(actor: Actor, id: string, visible: boolean) {
  ensure(actor, "edit");
  await getDb().transaction(async (tx) => {
    const p = await loadMine(tx, actor, id);
    if (p.teamVisible === visible) return;
    await tx.update(projects).set({ teamVisible: visible }).where(eq(projects.id, id));
    await writeAudit(tx, actorRef(actor), { action: "update", entity: "partner_projects", entityId: id, summary: `Edited project: team visible ${visible ? "on" : "off"} for ${p.name}`, before: { teamVisible: p.teamVisible }, after: { teamVisible: visible } });
  });
}

/** Sets exactly who is on the project. Every person must be an employee of the partner the project belongs to. */
async function applyMembers(tx: Tx, actor: Actor, project: { id: string; name: string }, partnerUserId: string, employeeIds: string[]) {
  const wanted = [...new Set(employeeIds)].sort();
  if (wanted.length) {
    const valid = await tx
      .select({ id: employeeAssignments.employeeUserId })
      .from(employeeAssignments)
      .innerJoin(users, eq(users.id, employeeAssignments.employeeUserId))
      .where(and(eq(employeeAssignments.partnerUserId, partnerUserId), inArray(employeeAssignments.employeeUserId, wanted), eq(users.presetId, "employee")));
    if (valid.length !== wanted.length) throw new NotFound(); // someone else's employee looks the same as no one
  }
  const current = (await tx.select({ id: projectMembers.userId }).from(projectMembers).where(eq(projectMembers.projectId, project.id)).for("update")).map((r) => r.id).sort();
  const add = wanted.filter((x) => !current.includes(x));
  const remove = current.filter((x) => !wanted.includes(x));
  if (!add.length && !remove.length) return;
  if (remove.length) await tx.delete(projectMembers).where(and(eq(projectMembers.projectId, project.id), inArray(projectMembers.userId, remove)));
  if (add.length) await tx.insert(projectMembers).values(add.map((userId) => ({ projectId: project.id, userId, addedBy: actor.userId })));
  await writeAudit(tx, actorRef(actor), {
    action: "assign",
    entity: "partner_projects",
    entityId: project.id,
    summary: `Edited project: people on ${project.name} changed`,
    before: { memberIds: current },
    after: { memberIds: wanted },
  });
}

/** A partner puts their own employees on one of their projects. */
export async function setMyProjectMembers(actor: Actor, id: string, employeeIds: string[]) {
  ensure(actor, "edit");
  await getDb().transaction(async (tx) => {
    const p = await loadMine(tx, actor, id);
    if (!p.active) throw new RuleError("Restore the project before changing who is on it.");
    for (const e of employeeIds) await ownEmployee(tx, actor, e); // not theirs = NotFound, same as missing
    await applyMembers(tx, actor, p, actor.userId, employeeIds);
  });
}

/** An admin does the same for any project that belongs to a partner's stream. */
export async function setProjectMembersAsAdmin(actor: Actor, projectId: string, employeeIds: string[]) {
  requireAdmin(actor);
  await getDb().transaction(async (tx) => {
    const [p] = await tx.select().from(projects).where(eq(projects.id, projectId)).for("update");
    if (!p) throw new RuleError("That project no longer exists.");
    const [holder] = await tx.select({ userId: streamPartnerStreams.userId }).from(streamPartnerStreams).where(eq(streamPartnerStreams.streamId, p.streamId));
    if (!holder) throw new RuleError("That project's stream has no partner, so it has no employees to add.");
    await applyMembers(tx, actor, p, holder.userId, employeeIds);
  });
}
