import { ratePct } from "@/lib/marketing";
import { WEEKDAYS, WEEKDAYS_SHORT, hourRange } from "@/lib/zoned";

/** Cells with fewer contacts than this aren't coloured: one reply out of one call isn't a 100% hour. */
export const HEAT_MIN = 3;

/**
 * Response rate by weekday and hour of the day (company time). A real table:
 * every cell carries its numbers as text (shown when the card is wide enough,
 * and always to screen readers and on hover), so colour is never the only
 * signal.
 */
export function Heatmap({ heat, timezone }: { heat: Array<Array<{ contacts: number; responded: number }>>; timezone: string }) {
  const rates = heat.flat().filter((c) => c.contacts >= HEAT_MIN).map((c) => ratePct(c.responded, c.contacts)!);
  const max = Math.max(1, ...rates);
  const hours = Array.from({ length: 24 }, (_, h) => h);

  return (
    <figure className="m-0 @container">
      <div className="scroll-x -mx-1 px-1">
        <table className="w-full min-w-[36rem] table-fixed border-separate border-spacing-[3px] font-mono text-[10px]">
          <caption className="sr-only">Response rate by weekday and hour, {timezone} time. Cells with fewer than {HEAT_MIN} contacts are marked too few.</caption>
          <colgroup>
            <col className="w-10" />
            {hours.map((h) => (
              <col key={h} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <td />
              {hours.map((h) => (
                <th key={h} scope="col" className="pb-1 text-center font-normal text-muted">
                  <span aria-hidden="true">{h % 3 === 0 ? String(h).padStart(2, "0") : ""}</span>
                  <span className="sr-only">{hourRange(h)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {heat.map((row, d) => (
              <tr key={d}>
                <th scope="row" className="pr-1 text-left font-normal text-ink-2">
                  <span aria-hidden="true">{WEEKDAYS_SHORT[d]}</span>
                  <span className="sr-only">{WEEKDAYS[d]}</span>
                </th>
                {row.map((c, h) => {
                  const rate = ratePct(c.responded, c.contacts);
                  const enough = c.contacts >= HEAT_MIN;
                  const text =
                    c.contacts === 0
                      ? "no activity"
                      : `${c.contacts} ${c.contacts === 1 ? "contact" : "contacts"}, ${enough ? `${rate}% responded` : `too few to rate (${c.responded} responded)`}`;
                  const strength = enough ? 0.14 + 0.78 * ((rate ?? 0) / max) : 0;
                  return (
                    <td
                      key={h}
                      title={`${WEEKDAYS[d]} ${hourRange(h)}: ${text}`}
                      className={
                        "h-7 rounded-[5px] text-center align-middle " +
                        (enough ? "text-ink" : c.contacts > 0 ? "border border-dashed border-line text-muted" : "bg-surface-2/60")
                      }
                      style={enough ? { background: `color-mix(in oklab, var(--accent) ${Math.round(strength * 100)}%, var(--surface-2))` } : undefined}
                    >
                      {/* the rate is printed in the cell once there's room for it */}
                      <span aria-hidden="true" className="hidden @[46rem]:inline">
                        {enough ? Math.round(rate ?? 0) : ""}
                      </span>
                      <span className="sr-only">{text}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <figcaption className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted">
        <span className="flex items-center gap-2">
          Lower
          <span className="h-2.5 w-24 rounded-full" style={{ background: "linear-gradient(to right, color-mix(in oklab, var(--accent) 14%, var(--surface-2)), var(--accent))" }} aria-hidden="true" />
          Higher response rate
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block size-3 rounded-[3px] border border-dashed border-line" aria-hidden="true" /> Fewer than {HEAT_MIN} contacts
        </span>
        <span>Numbers are % responded · times in {timezone}</span>
      </figcaption>
    </figure>
  );
}
