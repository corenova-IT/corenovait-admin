"use client";

import { useId, useState } from "react";
import { fmtMonth } from "@/lib/format";
import { formatCompact, formatMoney } from "@/lib/money";

export type TrendPoint = { month: string; revenue: number; expenses: number; profit: number };

/**
 * Revenue, profit and expenses by month, as in the Overview design: a red
 * glowing revenue line with an area fill, a white profit line and a dashed
 * expenses line. Hover, focus and the arrow keys show the month's figures;
 * a screen-reader table carries the same numbers.
 */
export function TrendChart({ data, currency, label, partialLast = false }: { data: TrendPoint[]; currency: string; label: string; partialLast?: boolean }) {
  const id = useId().replace(/:/g, "");
  const [active, setActive] = useState(data.length - 1);
  const W = 720;
  const H = 260;
  const padL = 52;
  const padR = 16;
  const padT = 16;
  const padB = 28;
  const values = data.flatMap((d) => [d.revenue, d.expenses, d.profit]);
  const rawMax = Math.max(1, ...values);
  const rawMin = Math.min(0, ...values);
  const step = niceStep((rawMax - rawMin) / 4);
  const top = Math.ceil(rawMax / step) * step;
  const bottom = Math.floor(rawMin / step) * step;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const x = (i: number) => padL + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
  const y = (v: number) => padT + ((top - v) / (top - bottom || 1)) * plotH;
  const path = (key: keyof Omit<TrendPoint, "month">, from = 0, to = data.length - 1) =>
    data
      .slice(from, to + 1)
      .map((d, j) => `${j ? "L" : "M"}${x(from + j).toFixed(1)},${y(d[key]).toFixed(1)}`)
      .join(" ");
  // a month still in progress is drawn dashed, so its lower total doesn't read as a drop
  const solidTo = partialLast && data.length > 1 ? data.length - 2 : data.length - 1;
  const tail = (key: keyof Omit<TrendPoint, "month">) => (solidTo < data.length - 1 ? path(key, solidTo, data.length - 1) : null);
  const area = `${path("revenue")} L${x(data.length - 1).toFixed(1)},${y(Math.max(0, bottom)).toFixed(1)} L${x(0).toFixed(1)},${y(Math.max(0, bottom)).toFixed(1)} Z`;
  const ticks: number[] = [];
  for (let v = bottom; v <= top + 1; v += step) ticks.push(v);
  const a = data[active];
  const tipLeft = x(active) > W * 0.62;

  return (
    <figure className="m-0">
      <div className="mb-4 flex flex-wrap gap-5 text-sm text-ink-2" aria-hidden="true">
        <span className="flex items-center gap-2">
          <span className="h-[3px] w-5 rounded bg-accent shadow-[0_0_8px_rgba(214,56,56,0.8)]" /> Revenue
        </span>
        <span className="flex items-center gap-2">
          <span className="h-[3px] w-5 rounded bg-ink" /> Profit
        </span>
        <span className="flex items-center gap-2">
          <span className="w-5 border-t-2 border-dashed border-muted" /> Expenses
        </span>
      </div>
      <div className="scroll-x">
        <div className="relative min-w-[34rem]">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full overflow-visible outline-none"
            role="img"
            aria-label={`${label}. Use left and right arrow keys to read each month.`}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") setActive((i) => Math.max(0, i - 1));
              if (e.key === "ArrowRight") setActive((i) => Math.min(data.length - 1, i + 1));
            }}
            onMouseLeave={() => setActive(data.length - 1)}
          >
            <defs>
              <linearGradient id={`fill-${id}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.32" />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
              </linearGradient>
              <filter id={`glow-${id}`} x="-10%" y="-30%" width="120%" height="160%">
                <feGaussianBlur stdDeviation="4" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
                <text x={padL - 10} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--muted)" fontFamily="var(--font-plex-mono)">
                  {formatCompact(t, currency)}
                </text>
              </g>
            ))}
            {data.map((d, i) => (
              <text key={d.month} x={x(i)} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--muted)" fontFamily="var(--font-plex-mono)">
                {fmtMonth(d.month)}
                {partialLast && i === data.length - 1 ? "*" : ""}
              </text>
            ))}
            <path d={area} fill={`url(#fill-${id})`} />
            <path d={path("expenses", 0, solidTo)} fill="none" stroke="var(--muted)" strokeWidth={2} strokeDasharray="6 6" />
            <path d={path("profit", 0, solidTo)} fill="none" stroke="var(--text)" strokeWidth={2.5} strokeLinejoin="round" />
            <path d={path("revenue", 0, solidTo)} fill="none" stroke="var(--accent)" strokeWidth={3} strokeLinejoin="round" filter={`url(#glow-${id})`} />
            {tail("revenue") && (
              <g strokeDasharray="2 5" strokeLinecap="round" fill="none" opacity={0.7}>
                <path d={tail("expenses")!} stroke="var(--muted)" strokeWidth={2} />
                <path d={tail("profit")!} stroke="var(--text)" strokeWidth={2.5} />
                <path d={tail("revenue")!} stroke="var(--accent)" strokeWidth={3} />
              </g>
            )}
            <line x1={x(active)} x2={x(active)} y1={padT} y2={padT + plotH} stroke="var(--muted)" strokeDasharray="3 4" strokeWidth={1} />
            <circle cx={x(active)} cy={y(a.revenue)} r={6} fill="var(--accent)" stroke="var(--bg)" strokeWidth={2} filter={`url(#glow-${id})`} />
            <circle cx={x(active)} cy={y(a.profit)} r={4.5} fill="var(--text)" />
            <circle cx={x(active)} cy={y(a.expenses)} r={4.5} fill="var(--bg)" stroke="var(--muted)" strokeWidth={2} />
            {data.map((d, i) => (
              <rect
                key={d.month}
                x={x(i) - plotW / (2 * Math.max(1, data.length - 1))}
                y={padT}
                width={plotW / Math.max(1, data.length - 1)}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setActive(i)}
              />
            ))}
          </svg>
          <div
            aria-live="polite"
            className="pointer-events-none absolute top-2 rounded-xl border border-line bg-surface/95 px-3 py-2 font-mono text-xs shadow-lg backdrop-blur"
            style={tipLeft ? { right: `${((W - x(active)) / W) * 100 + 2}%` } : { left: `${(x(active) / W) * 100 + 2}%` }}
          >
            <p className="mb-1 uppercase tracking-[0.1em] text-muted">
              {fmtMonth(a.month, true)}
              {partialLast && active === data.length - 1 ? " · month to date" : ""}
            </p>
            <p className="text-ink">
              Revenue <span className="text-accent-text">{formatMoney(a.revenue, currency, { cents: false })}</span>
            </p>
            <p className="text-ink-2">
              Profit {formatMoney(a.profit, currency, { cents: false })} · Exp. {formatMoney(a.expenses, currency, { cents: false })}
            </p>
          </div>
        </div>
      </div>
      {/* a table ignores width:1px and overflow, so the screen-reader copy sits in a hidden div */}
      <div className="sr-only">
        <table>
          <caption>{label}</caption>
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col">Revenue</th>
              <th scope="col">Expenses</th>
              <th scope="col">Profit</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.month}>
                <th scope="row">{fmtMonth(d.month, true)}</th>
                <td>{formatMoney(d.revenue, currency)}</td>
                <td>{formatMoney(d.expenses, currency)}</td>
                <td>{formatMoney(d.profit, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {partialLast && <figcaption className="mt-2 font-mono text-xs text-muted">* {fmtMonth(data[data.length - 1].month, true)} is month to date</figcaption>}
    </figure>
  );
}

function niceStep(raw: number): number {
  if (raw <= 0) return 100_00;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}
