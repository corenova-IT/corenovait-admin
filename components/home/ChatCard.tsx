import Link from "next/link";
import { IconChat } from "@/components/icons";
import { Card } from "@/components/ui/Card";

type Summary = { total: number; conversations: number; items: Array<{ id: string; kind: "channel" | "dm"; label: string; unread: number; author: string; preview: string; at: Date | null }> };

/** Unread chat for Home and My Day: which conversations have new messages, with a preview. */
export function ChatCard({ summary, className }: { summary: Summary | null; className?: string }) {
  return (
    <Card className={`flex flex-col ${className ?? ""}`}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-ink-2">
          <IconChat />
        </span>
        <h2 className="title-card mr-auto font-bold tracking-[-0.02em] text-ink">Unread chat</h2>
        {summary && (
          <Link href="/chat" className="text-sm text-accent-text hover:underline">
            Open
          </Link>
        )}
      </div>
      {!summary ? (
        <p className="text-sm text-muted">You don&apos;t have access to team chat.</p>
      ) : summary.total === 0 ? (
        <p className="text-sm text-muted">You&apos;re all caught up.</p>
      ) : (
        <>
          <p className="mb-2 text-sm text-ink-2">
            <span className="font-semibold text-ink">{summary.total}</span> unread in {summary.conversations} {summary.conversations === 1 ? "conversation" : "conversations"}
          </p>
          <ul className="flex flex-col divide-y divide-line">
            {summary.items.map((c) => (
              <li key={c.id}>
                <Link href={`/chat?c=${c.id}`} className="flex min-h-14 items-start gap-3 py-2.5 hover:opacity-90">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium leading-snug text-ink [overflow-wrap:anywhere]">{c.label}</span>
                    {c.preview && (
                      <span className="clamp-2 text-sm text-muted">
                        {c.kind === "channel" && c.author ? `${c.author}: ` : ""}
                        {c.preview}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 grid min-w-6 shrink-0 place-items-center rounded-full bg-accent px-1.5 font-mono text-[11px] leading-5 text-on-accent">
                    {c.unread}
                    <span className="sr-only"> unread</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
