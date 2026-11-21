import Link from "next/link";
import { ProjectMoneyView } from "@/components/partner/ProjectMoneyView";
import { PageHeader } from "@/components/ui/PageHeader";
import { requirePerm } from "@/lib/auth/session";
import { myProjectMoney } from "@/lib/dal/project-money";
import { saveDeductions } from "../actions";

export const metadata = { title: "Revenue overview" };

/** A partner's revenue overview: only their own streams and countries. */
export default async function MyMoneyPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePerm("stream_partner");
  const sp = await searchParams;
  const data = await myProjectMoney(actor, { from: sp.from, to: sp.to });
  return (
    <>
      <PageHeader title="Revenue overview" subtitle="What each project earned, what taxes and fees took, and what it cost" actions={<Link href="/my-dashboard" className="text-sm text-accent-text hover:underline">Back to my dashboard</Link>} />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1 text-muted">From<input type="date" name="from" defaultValue={sp.from ?? data.from} className="rounded-[10px] border border-line bg-surface px-2 py-1 text-ink" /></label>
        <label className="flex flex-col gap-1 text-muted">To<input type="date" name="to" defaultValue={sp.to ?? data.to} className="rounded-[10px] border border-line bg-surface px-2 py-1 text-ink" /></label>
        <button type="submit" className="rounded-[10px] border border-line px-3 py-1.5 text-ink hover:bg-sunken">Show</button>
      </form>
      <ProjectMoneyView data={data} entries={data.entries} saveDeductions={saveDeductions} />
    </>
  );
}
