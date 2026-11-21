import { ProjectMoneyView } from "@/components/partner/ProjectMoneyView";
import { PageHeader } from "@/components/ui/PageHeader";
import { requirePerm } from "@/lib/auth/session";
import { adminProjectMoney } from "@/lib/dal/project-money";
import { saveAdminDeductions } from "./actions";

export const metadata = { title: "Project revenue" };

/** Admins: the revenue overview for everything, narrowed by stream, country, partner and dates. */
export default async function ProjectMoneyPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePerm("transactions");
  const sp = await searchParams;
  const data = await adminProjectMoney(actor, { stream: sp.stream, country: sp.country, partner: sp.partner, from: sp.from, to: sp.to });
  const sel = "rounded-[10px] border border-line bg-surface px-2 py-1 text-ink";
  return (
    <>
      <PageHeader title="Project revenue" subtitle="Total amount, taxes and fees, what was left, and what each project cost" />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1 text-muted">Stream<select name="stream" defaultValue={sp.stream ?? ""} className={sel}><option value="">All</option>{data.options.streams.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label className="flex flex-col gap-1 text-muted">Country<select name="country" defaultValue={sp.country ?? ""} className={sel}><option value="">All</option>{data.options.countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></label>
        <label className="flex flex-col gap-1 text-muted">Partner<select name="partner" defaultValue={sp.partner ?? ""} className={sel}><option value="">All</option>{data.options.partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="flex flex-col gap-1 text-muted">From<input type="date" name="from" defaultValue={sp.from ?? data.from} className={sel} /></label>
        <label className="flex flex-col gap-1 text-muted">To<input type="date" name="to" defaultValue={sp.to ?? data.to} className={sel} /></label>
        <button type="submit" className="rounded-[10px] border border-line px-3 py-1.5 text-ink hover:bg-sunken">Show</button>
      </form>
      <ProjectMoneyView data={data} entries={data.entries} saveDeductions={saveAdminDeductions} />
    </>
  );
}
