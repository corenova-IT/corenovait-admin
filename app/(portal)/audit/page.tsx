import { z } from "zod";
import { ACTION_LABELS, AuditTable, ENTITY_LABELS, type AuditRow } from "@/components/audit/AuditTable";
import { ButtonLink, buttonClass } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Pagination } from "@/components/ui/DataTable";
import { Field, Input, Select } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { ErrorState } from "@/components/ui/States";
import { requirePerm } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Audit log" };

const PAGE_SIZE = 50;

const filtersSchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  action: z.enum(Object.keys(ACTION_LABELS) as [string, ...string[]]).optional().catch(undefined),
  entity: z.enum(Object.keys(ENTITY_LABELS) as [string, ...string[]]).optional().catch(undefined),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).optional().catch(1),
});

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePerm("audit");
  const f = filtersSchema.parse(await searchParams);
  const page = f.page ?? 1;
  const supabase = await createClient();

  let query = supabase
    .from("audit_log")
    .select("id, at, actor_email, action, entity, entity_id, summary, before, after", { count: "exact" })
    .order("at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (f.action) query = query.eq("action", f.action);
  if (f.entity) query = query.eq("entity", f.entity);
  if (f.from) query = query.gte("at", `${f.from}T00:00:00Z`);
  if (f.to) query = query.lt("at", new Date(Date.parse(`${f.to}T00:00:00Z`) + 86_400_000).toISOString());
  if (f.q) {
    // strip characters that have meaning in PostgREST filter syntax
    const term = f.q.replace(/[,()*%\\:."']/g, " ").trim();
    if (term) query = query.or(`actor_email.ilike.*${term}*,summary.ilike.*${term}*,entity_id.ilike.*${term}*`);
  }

  const [{ data, count, error }, settings] = await Promise.all([query, supabase.from("settings").select("timezone").maybeSingle()]);
  const timeZone = settings.data?.timezone ?? "Australia/Sydney";

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v && k !== "page") params.set(k, String(v));
  const hrefFor = (p: number) => `/audit?${new URLSearchParams({ ...Object.fromEntries(params), page: String(p) })}`;
  const filtered = params.size > 0;

  return (
    <>
      <PageHeader title="Audit log" subtitle={`Read-only · every create, change, delete and export · times in ${timeZone}`} />
      <Card className="mb-6">
        <form method="get" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))_auto] lg:items-end">
          <Field label="Search" htmlFor="q">
            <Input id="q" name="q" defaultValue={f.q} placeholder="Person, summary or record ID" />
          </Field>
          <Field label="Action" htmlFor="action">
            <Select id="action" name="action" defaultValue={f.action ?? ""}>
              <option value="">All actions</option>
              {Object.entries(ACTION_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Record type" htmlFor="entity">
            <Select id="entity" name="entity" defaultValue={f.entity ?? ""}>
              <option value="">All records</option>
              {Object.entries(ENTITY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          </Field>
          <Field label="From" htmlFor="from">
            <Input id="from" name="from" type="date" defaultValue={f.from} />
          </Field>
          <Field label="To" htmlFor="to">
            <Input id="to" name="to" type="date" defaultValue={f.to} />
          </Field>
          <div className="flex gap-2">
            <button type="submit" className={buttonClass("primary")}>Filter</button>
            {filtered && <ButtonLink href="/audit" variant="ghost">Clear</ButtonLink>}
          </div>
        </form>
      </Card>
      <Card>
        {error ? (
          <ErrorState title="The audit log couldn't be loaded" />
        ) : (
          <>
            <AuditTable rows={(data ?? []) as AuditRow[]} timeZone={timeZone} />
            <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} hrefFor={hrefFor} />
          </>
        )}
      </Card>
    </>
  );
}
