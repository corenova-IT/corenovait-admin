import { Avatar } from "@/components/ui/Avatar";
import { Card, CardHeader } from "@/components/ui/Card";
import { formatMoney } from "@/lib/money";

export function TopClients({ clients, currency, subtitle }: { clients: Array<{ client: string; totalBaseMinor: number; deals: number }>; currency: string; subtitle?: string }) {
  return (
    <Card>
      <CardHeader title="Top clients" subtitle={subtitle} />
      {clients.length === 0 ? (
        <p className="text-sm text-muted">No clients recorded for this period.</p>
      ) : (
        <ol className="flex flex-col divide-y divide-line">
          {clients.map((c) => (
            <li key={c.client} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
              <span className="flex min-w-0 items-center gap-3">
                <Avatar name={c.client} />
                <span className="min-w-0">
                  <span className="clamp-2 leading-snug font-medium text-ink">{c.client}</span>
                  <span className="font-mono text-xs text-muted">
                    {c.deals} {c.deals === 1 ? "deal" : "deals"}
                  </span>
                </span>
              </span>
              <span className="num shrink-0 font-mono font-semibold text-ink">{formatMoney(c.totalBaseMinor, currency, { cents: false })}</span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
