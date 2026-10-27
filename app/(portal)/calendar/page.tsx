import { CalendarView } from "@/components/calendar/CalendarView";
import { AddEvent, type EventLookups } from "@/components/calendar/EventForms";
import { IconChevronLeft, IconChevronRight, IconDownload } from "@/components/icons";
import { ButtonLink, buttonClass } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cx } from "@/components/ui/cx";
import { PageHeader } from "@/components/ui/PageHeader";
import { PillSwitch } from "@/components/ui/Pill";
import { requirePerm } from "@/lib/auth/session";
import { calendarItems, invitees } from "@/lib/dal/calendar";
import { hasSampleData } from "@/lib/dal/finance";
import { hasPerm } from "@/lib/dal/guard";
import { addDays, addMonths } from "@/lib/dates";
import { hrefWith } from "@/lib/format";
import { KIND_LABEL, KIND_SWATCH, type CalendarKind } from "@/lib/work";
import { deleteEvent, moveEvent, saveEvent } from "./actions";
import { getCompanySettings } from "@/lib/dal/settings";
import { localParts } from "@/lib/zoned";

export const metadata = { title: "Calendar" };

const PATH = "/calendar";
type View = "month" | "week" | "agenda";
const weekday = (d: string) => (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
const fmt = (d: string, opts: Intl.DateTimeFormatOptions) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-AU", { ...opts, timeZone: "UTC" });

/** The days on screen for a view around an anchor date. */
function daysFor(view: View, anchor: string) {
  if (view === "week") {
    const start = addDays(anchor, -weekday(anchor));
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }
  if (view === "agenda") return Array.from({ length: 30 }, (_, i) => addDays(anchor, i));
  const first = `${anchor.slice(0, 7)}-01`;
  const last = addDays(addMonths(first, 1), -1);
  const start = addDays(first, -weekday(first));
  const end = addDays(last, 6 - weekday(last));
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePerm("calendar");
  const sp = await searchParams;
  const view: View = sp.view === "week" || sp.view === "agenda" ? sp.view : "month";
  const company = await getCompanySettings(actor);
  const today = localParts(new Date(), company.timezone).date;
  const anchor = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;
  const days = daysFor(view, anchor);
  const [data, people, sample] = await Promise.all([calendarItems(actor, days[0], days[days.length - 1]), invitees(actor), hasSampleData(actor)]);
  const can = { create: hasPerm(actor, "calendar", "create"), delete: hasPerm(actor, "calendar", "delete"), export: hasPerm(actor, "calendar", "export") };
  const scope = actor.perms.calendar.scope;

  const step = (dir: 1 | -1) => (view === "month" ? addMonths(`${anchor.slice(0, 7)}-01`, dir) : addDays(anchor, dir * (view === "week" ? 7 : 30)));
  const keep = { view: view === "month" ? undefined : view, date: sp.date };
  const title =
    view === "month"
      ? fmt(`${anchor.slice(0, 7)}-01`, { month: "long", year: "numeric" })
      : view === "week"
        ? `Week of ${fmt(days[0], { day: "numeric", month: "long", year: "numeric" })}`
        : `30 days from ${fmt(days[0], { day: "numeric", month: "long" })}`;
  const lookups: EventLookups = {
    invitees: people,
    selfId: actor.userId,
    timezone: data.timezone,
    defaultStart: `${today}T09:00`,
    defaultEnd: `${today}T10:00`,
  };
  const kinds: CalendarKind[] = ["meeting", "deadline", ...(hasPerm(actor, "tasks", "view") ? (["task"] as const) : []), ...(hasPerm(actor, "payments", "view") ? (["payment"] as const) : []), "other"];
  const scopeNote = scope === "all" ? "All events" : scope === "assigned" ? "Events you're invited to or created" : "Events you created";

  return (
    <>
      <PageHeader
        title="Calendar"
        subtitle={`${scopeNote} · times in ${data.timezone}`}
        sample={sample}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            {can.export && (
              <a href="/api/calendar/ics" className={buttonClass("secondary")}>
                <IconDownload /> Export .ics
              </a>
            )}
            {can.create && <AddEvent lookups={lookups} action={saveEvent} initialOpen={sp.new === "1"} />}
          </div>
        }
      />

      <Card className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <ButtonLink href={hrefWith(PATH, keep, { date: step(-1) })} variant="secondary" size="sm" aria-label="Previous">
              <IconChevronLeft size={16} />
            </ButtonLink>
            <ButtonLink href={hrefWith(PATH, keep, { date: undefined })} variant="secondary" size="sm">
              Today
            </ButtonLink>
            <ButtonLink href={hrefWith(PATH, keep, { date: step(1) })} variant="secondary" size="sm" aria-label="Next">
              <IconChevronRight size={16} />
            </ButtonLink>
            <h2 className="title-card ml-2 font-bold text-ink">{title}</h2>
          </div>
          <PillSwitch
            label="Calendar view"
            value={view}
            options={[
              { value: "month", label: "Month", href: hrefWith(PATH, { date: sp.date }, {}) },
              { value: "week", label: "Week", href: hrefWith(PATH, { date: sp.date }, { view: "week" }) },
              { value: "agenda", label: "Agenda", href: hrefWith(PATH, { date: sp.date }, { view: "agenda" }) },
            ]}
          />
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-2" aria-label="Colour key">
          {kinds.map((k) => (
            <li key={k} className="flex items-center gap-2 text-xs text-ink-2">
              <span className={cx("inline-block size-3 rounded-[3px]", KIND_SWATCH[k])} aria-hidden="true" />
              {KIND_LABEL[k]}
            </li>
          ))}
          {can.create && <li className="text-xs text-muted">Drag your own events to another day to move them.</li>}
        </ul>
        <CalendarView
          view={view}
          days={days}
          month={anchor.slice(0, 7)}
          today={data.today}
          items={data.items}
          lookups={lookups}
          canDelete={can.delete}
          actions={{ save: saveEvent, move: moveEvent, remove: deleteEvent }}
        />
      </Card>
    </>
  );
}
