import "server-only";
import { asc, like } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { SEARCH_MAX, SEARCH_MIN, SEARCH_PER_GROUP, likeTerm, type SearchGroup, type SearchHit } from "@/lib/search";
import { auditFilters, listAudit } from "./audit";
import { searchEvents } from "./calendar";
import { searchMessages } from "./chat";
import { listExpenses, listIncome } from "./finance";
import { hasPerm, requirePerm, type Actor } from "./guard";
import { searchActivities } from "./marketing";
import { searchSubscriptions } from "./payments";
import { repSummaries } from "./revenue";
import { listTasks } from "./tasks";
import { listTeam } from "./team";
import type { AppModule } from "@/lib/permissions";

const { streams, countries } = schema;
const N = SEARCH_PER_GROUP;
const enc = encodeURIComponent;
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const snippet = (s: string, q: string) => {
  const i = Math.max(0, s.toLowerCase().indexOf(q.toLowerCase()));
  const start = Math.max(0, i - 40);
  const out = s.slice(start, start + 140).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${out}${start + 140 < s.length ? "…" : ""}`;
};
const group = (id: string, label: string, hits: SearchHit[], moreHref?: string): SearchGroup | null => (hits.length ? { id, label, hits, moreHref } : null);

/**
 * The top-bar search. Each page is searched only when the caller can view it,
 * through that page's own data functions, so results follow the same
 * permissions and scope as the page itself (staff see their own rows; chat
 * only searches conversations they're in).
 */
export async function searchEverything(actor: Actor, raw: string): Promise<{ q: string; groups: SearchGroup[] }> {
  requirePerm(actor, "home", "view");
  const q = raw.trim().slice(0, SEARCH_MAX);
  if (q.length < SEARCH_MIN) return { q, groups: [] };
  const may = (m: AppModule) => hasPerm(actor, m, "view");
  const needle = q.toLowerCase();
  const t = likeTerm(q);
  const jobs: Array<Promise<SearchGroup | null>> = [];

  if (may("transactions")) {
    const income = `/transactions?q=${enc(q)}`;
    const spend = `/transactions?tab=expenses&q=${enc(q)}`;
    jobs.push(
      listIncome(actor, { q }, N).then((r) =>
        group("income", "Income", r.rows.map((x) => ({ key: `i-${x.id}`, title: x.client, detail: `${day(x.entryDate)} · ${x.streamName}${x.invoiceRef ? ` · ${x.invoiceRef}` : ""}`, href: income })), r.total > N ? income : undefined)
      ),
      listExpenses(actor, { q }, N).then((r) => group("expenses", "Expenses", r.rows.map((x) => ({ key: `e-${x.id}`, title: x.vendor, detail: `${day(x.expenseDate)} · ${x.category}`, href: spend })), r.total > N ? spend : undefined))
    );
  }
  if (may("payments"))
    jobs.push(
      searchSubscriptions(actor, q, N).then((r) =>
        group("payments", "Payments", r.map((x) => ({ key: `s-${x.id}`, title: x.vendor, detail: `${x.category} · ${x.status === "active" ? `next due ${day(x.nextDueDate)}` : x.status}`, href: "/payments" })))
      )
    );
  if (may("streams"))
    jobs.push(
      getDb()
        .select({ id: streams.id, name: streams.name })
        .from(streams)
        .where(like(streams.name, t))
        .orderBy(asc(streams.name))
        .limit(N)
        .then((r) => group("streams", "Revenue streams", r.map((x) => ({ key: `st-${x.id}`, title: x.name, detail: "Revenue stream", href: `/streams/${x.id}` }))))
    );
  if (may("countries"))
    jobs.push(
      getDb()
        .select({ code: countries.code, name: countries.name })
        .from(countries)
        .where(like(countries.name, t))
        .orderBy(asc(countries.name))
        .limit(N)
        .then((r) => group("countries", "Countries", r.map((x) => ({ key: `c-${x.code}`, title: x.name, detail: x.code, href: `/streams/countries/${x.code}` }))))
    );
  if (may("representatives"))
    jobs.push(
      repSummaries(actor).then((r) =>
        group(
          "representatives",
          "Representatives",
          r.rows
            .filter((x) => `${x.name} ${x.email ?? ""}`.toLowerCase().includes(needle))
            .slice(0, N)
            .map((x) => ({ key: `r-${x.id}`, title: x.name, detail: x.email ?? "Representative", href: `/streams/representatives/${x.id}` }))
        )
      )
    );
  if (may("marketing"))
    jobs.push(
      searchActivities(actor, q, N).then((r) =>
        group("marketing", "Marketing activity", r.map((x) => ({ key: `m-${x.id}`, title: x.contactName, detail: `${day(x.date)}${x.contactCompany ? ` · ${x.contactCompany}` : ""}`, href: "/marketing" })))
      )
    );
  if (may("calendar"))
    jobs.push(
      searchEvents(actor, q, N).then((r) =>
        group(
          "calendar",
          "Calendar",
          r.map((x) => ({ key: `ev-${x.id}`, title: x.title, detail: `${x.recurrence !== "none" ? "Repeats, from " : ""}${day(x.date)}${x.time ? ` ${x.time}` : ""}${x.location ? ` · ${x.location}` : ""}`, href: `/calendar?view=agenda&date=${x.date}` }))
        )
      )
    );
  if (may("tasks"))
    jobs.push(
      listTasks(actor, { q }).then((r) =>
        group(
          "tasks",
          "Tasks",
          r.tasks.slice(0, N).map((x) => ({ key: `t-${x.id}`, title: x.title, detail: x.status === "done" ? "Done" : x.dueDate ? `Due ${day(x.dueDate)}` : "No due date", href: `/tasks?task=${x.id}` })),
          r.tasks.length > N ? `/tasks?q=${enc(q)}` : undefined
        )
      )
    );
  if (may("chat"))
    jobs.push(searchMessages(actor, q, N).then((r) => group("chat", "Team chat", r.map((x) => ({ key: `ch-${x.id}`, title: `${x.author} in ${x.where}`, detail: snippet(x.body, q), href: `/chat?c=${x.channelId}` })))));
  if (may("team"))
    jobs.push(
      listTeam(actor).then((r) =>
        group(
          "team",
          "People",
          r.members
            .filter((x) => `${x.name} ${x.email} ${x.jobTitle}`.toLowerCase().includes(needle))
            .slice(0, N)
            .map((x) => ({ key: `u-${x.id}`, title: x.name || x.email, detail: [x.jobTitle, x.email, x.status === "active" ? "" : x.status].filter(Boolean).join(" · "), href: "/team" }))
        )
      )
    );
  if (may("audit"))
    jobs.push(
      listAudit(actor, auditFilters.parse({ q }), N).then((r) =>
        group("audit", "Audit log", r.rows.map((x) => ({ key: `a-${x.id}`, title: x.summary || `${x.action} ${x.entity}`, detail: `${x.at.slice(0, 16).replace("T", " ")} · ${x.actor_email ?? "System"}`, href: `/audit?q=${enc(q)}` })), r.total > N ? `/audit?q=${enc(q)}` : undefined)
      )
    );

  return { q, groups: (await Promise.all(jobs)).filter((g): g is SearchGroup => g !== null) };
}
