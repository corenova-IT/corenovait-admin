import { IconBell, IconCalendar, IconCard, IconChat, IconTasks } from "@/components/icons";
import { EmailToggle, MarkAllRead } from "@/components/notifications/NotificationForms";
import { Card, CardHeader } from "@/components/ui/Card";
import { cx } from "@/components/ui/cx";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/States";
import { requireUser } from "@/lib/auth/session";
import { getEmailPreference, listNotifications } from "@/lib/dal/notifications";
import { mailConfig } from "@/lib/env";
import { markAllRead, setEmailNotifications } from "./actions";

export const metadata = { title: "Notifications" };

const ICON = { task_assigned: IconTasks, task_due: IconTasks, meeting_reminder: IconCalendar, payment_due: IconCard, chat_mention: IconChat } as const;
const KIND = { task_assigned: "Task assigned", task_due: "Due soon", meeting_reminder: "Meeting", payment_due: "Payment", chat_mention: "Mention" } as const;
const ago = (d: Date) => {
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
};

/** Everyone's own notifications (nobody sees anyone else's), and the email setting. */
export default async function NotificationsPage() {
  const actor = await requireUser();
  const [list, emailOn] = await Promise.all([listNotifications(actor, 100), getEmailPreference(actor)]);
  const unread = list.filter((n) => !n.read).length;
  const mailReady = !!mailConfig() || process.env.NODE_ENV !== "production";

  return (
    <>
      <PageHeader title="Notifications" subtitle={unread ? `${unread} unread · only you see these` : "All caught up · only you see these"} />
      <div className="grid grid-cols-1 gap-cards @min-[64rem]:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Recent" subtitle="The last 100" aside={<MarkAllRead action={markAllRead} disabled={unread === 0} />} />
          {list.length === 0 ? (
            <EmptyState icon={<IconBell size={22} />} title="Nothing yet">
              Task assignments, due-soon reminders, meetings, payments and @mentions will appear here.
            </EmptyState>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {list.map((n) => {
                const Icon = ICON[n.type];
                return (
                  <li key={n.id}>
                    <a href={`/api/notifications/${n.id}/open`} className={cx("flex min-h-14 items-start gap-3 rounded-xl px-2 py-3 hover:bg-surface-2", n.read && "opacity-70")}>
                      <span className={cx("mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl border", n.read ? "border-line text-muted" : "border-accent-line text-accent-text")}>
                        <Icon size={17} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cx("block leading-snug [overflow-wrap:anywhere]", n.read ? "text-ink-2" : "font-semibold text-ink")}>{n.title}</span>
                        {n.body && <span className="clamp-2 mt-0.5 text-sm text-muted">{n.body}</span>}
                        <span className="mt-1 block font-mono text-xs text-muted">
                          {KIND[n.type]} · {ago(n.createdAt)}
                          {!n.read && <span className="ml-2 text-accent-text">unread</span>}
                        </span>
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card className="self-start">
          <CardHeader title="Email" subtitle="Your setting; nobody else can change it" />
          <EmailToggle on={emailOn} action={setEmailNotifications} mailReady={mailReady} />
        </Card>
      </div>
    </>
  );
}
