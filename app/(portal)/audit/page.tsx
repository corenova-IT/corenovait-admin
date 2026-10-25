import { ACTION_LABELS, AuditTable, ENTITY_LABELS } from "@/components/audit/AuditTable";
import { ButtonLink, buttonClass } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Pagination } from "@/components/ui/DataTable";
import { Field, Input, Select } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { requirePerm } from "@/lib/auth/session";
import { auditFilters, listAudit } from "@/lib/dal/audit";
import { getCompanySettings } from "@/lib/dal/settings";

export const metadata = { title: "Audit log" };

const PAGE_SIZE = 50;

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePerm("audit");
  const f = auditFilters.parse(await searchParams);
  const page = f.page ?? 1;
  const [{ rows, total }, { timezone: timeZone }] = await Promise.all([listAudit(actor, f, PAGE_SIZE), getCompanySettings(actor)]);

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
        <AuditTable rows={rows} timeZone={timeZone} />
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} hrefFor={hrefFor} />
      </Card>
    </>
  );
}
