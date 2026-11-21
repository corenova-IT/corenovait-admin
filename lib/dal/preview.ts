import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { visibleNav } from "@/lib/nav";
import { previewActorFor } from "./auth";
import { baseCurrency, listIncome } from "./finance";
import { hasPerm, RuleError, requireOwner, type Actor } from "./guard";
import { partnerEarnings } from "./partners";
import { streamSummaries } from "./revenue";

/**
 * "What would this person see?" (Owner only).
 *
 * Runs the same data functions the person's own pages use, with THEIR permissions,
 * scope and hidden projects, and puts the result next to what the Owner sees. Only
 * summaries come back (counts, totals, project names), never the rows themselves.
 * Nothing is changed, and nothing is signed in as them.
 */
const { incomeEntries, projects, projectHiddenFrom, streams, users, rolePresets } = schema;

const n = (v: unknown) => Number(v ?? 0);

export type AccessPreview = {
  baseCurrency: string;
  person: { id: string; name: string; email: string; role: string; status: "invited" | "active" | "deactivated"; isOwner: boolean };
  /** the pages in their sidebar */
  pages: string[];
  /** the total the Owner sees, for comparison (all time) */
  everything: { entries: number; paidBaseMinor: number; outstandingBaseMinor: number };
  /** null when they can't open the Transactions page */
  ledger: null | { entries: number; paidBaseMinor: number; outstandingBaseMinor: number; scope: "own" | "assigned" | "all" };
  /** null when they can't open Revenue streams */
  streams: null | { paidBaseMinor: number };
  /** null when they don't have "My earnings" */
  partner: null | { linked: boolean; earnedBaseMinor: number; expectedBaseMinor: number; owedBaseMinor: number; projects: string[] };
  projects: {
    visible: Array<{ id: string; name: string; stream: string }>;
    hidden: Array<{ id: string; name: string; stream: string; paidBaseMinor: number }>;
  };
  /** paid income in projects hidden from them */
  hiddenPaidBaseMinor: number;
  notes: string[];
};

export async function previewAccess(owner: Actor, userId: string): Promise<AccessPreview> {
  requireOwner(owner);
  const db = getDb();
  const target = await previewActorFor(owner, userId);
  if (!target) throw new RuleError("That person no longer exists. Refresh the page.");
  const [row] = await db
    .select({ name: users.fullName, email: users.email, status: users.status, role: rolePresets.name })
    .from(users)
    .innerJoin(rolePresets, eq(rolePresets.id, users.presetId))
    .where(eq(users.id, userId));

  const [base, [all], projectRows, paidByProject, hiddenRows] = await Promise.all([
    baseCurrency(db),
    db
      .select({
        entries: sql<string>`count(*)`,
        paid: sql<string>`coalesce(sum(case when ${incomeEntries.status} = 'paid' then ${incomeEntries.amountBaseMinor} else 0 end), 0)`,
        outstanding: sql<string>`coalesce(sum(case when ${incomeEntries.status} = 'paid' then 0 else ${incomeEntries.amountBaseMinor} end), 0)`,
      })
      .from(incomeEntries),
    db
      .select({ id: projects.id, name: projects.name, stream: streams.name })
      .from(projects)
      .innerJoin(streams, eq(streams.id, projects.streamId))
      .orderBy(asc(streams.name), asc(projects.name)),
    db
      .select({
        projectId: incomeEntries.projectId,
        paid: sql<string>`coalesce(sum(case when ${incomeEntries.status} = 'paid' then ${incomeEntries.amountBaseMinor} else 0 end), 0)`,
      })
      .from(incomeEntries)
      .groupBy(incomeEntries.projectId),
    db.select({ projectId: projectHiddenFrom.projectId }).from(projectHiddenFrom).where(eq(projectHiddenFrom.userId, userId)),
  ]);

  // the Owner is never hidden from anything, whatever the table says
  const hiddenIds = new Set(target.isOwner ? [] : hiddenRows.map((h) => h.projectId));
  const hidden = projectRows
    .filter((p) => hiddenIds.has(p.id))
    .map((p) => ({ ...p, paidBaseMinor: n(paidByProject.find((x) => x.projectId === p.id)?.paid) }));
  const visible = projectRows.filter((p) => !hiddenIds.has(p.id));

  const ledger = hasPerm(target, "transactions", "view")
    ? await listIncome(target, {}, 1).then((l) => ({
        entries: l.total,
        paidBaseMinor: l.paidBaseMinor,
        outstandingBaseMinor: l.outstandingBaseMinor,
        scope: target.perms.transactions.scope,
      }))
    : null;
  const streamTotals = hasPerm(target, "streams", "view") ? await streamSummaries(target, "all").then((s) => ({ paidBaseMinor: s.totalBaseMinor })) : null;
  const partner = hasPerm(target, "partner", "view")
    ? await partnerEarnings(target).then((p) => ({
        linked: p.linked,
        earnedBaseMinor: p.earnedBaseMinor,
        expectedBaseMinor: p.expectedBaseMinor,
        owedBaseMinor: p.owedBaseMinor,
        projects: p.byProject.map((x) => x.project),
      }))
    : null;

  const pages = visibleNav(target.perms).map((p) => p.label);
  const notes: string[] = [];
  if (target.isOwner) notes.push("This is the owner: they see everything, including projects hidden from other people.");
  if (row.status !== "active") notes.push(row.status === "invited" ? "They haven't accepted their invite yet. This is what they'll see once they have." : "This account is deactivated and can't sign in. This is what they would see if it were reactivated.");
  if (ledger?.scope === "own") notes.push("Their Transactions show only entries they created themselves.");
  if (ledger?.scope === "assigned") notes.push("Their Transactions show entries they created and deals credited to their own representative record.");
  if (partner) notes.push("A partner only ever sees their own share on My earnings: never the gross amount, the client, other partners or the company's share.");
  if (target.presetId === "stream_partner") notes.push("A partner sees only data that matches BOTH an assigned stream and an assigned country, and nothing at all until a country is assigned. They never see other partners, other streams, company totals or anything hidden from them.");
  if (target.presetId === "employee") notes.push("An employee sees only their own work. They never see any money, other partners, other streams or projects they are not on.");
  if (!ledger && !streamTotals && !partner) notes.push("They can't open any page that shows revenue.");
  if (hidden.length) notes.push(`${hidden.length} ${hidden.length === 1 ? "project is" : "projects are"} hidden from them, so that money is missing from every total, list, export, search and the audit log they can open.`);

  return {
    baseCurrency: base,
    person: { id: userId, name: row.name, email: row.email, role: row.role, status: row.status, isOwner: target.isOwner },
    pages,
    everything: { entries: n(all?.entries), paidBaseMinor: n(all?.paid), outstandingBaseMinor: n(all?.outstanding) },
    ledger,
    streams: streamTotals,
    partner,
    projects: { visible, hidden },
    hiddenPaidBaseMinor: hidden.reduce((a, h) => a + h.paidBaseMinor, 0),
    notes,
  };
}
