/** 125 -> "2h 05m". Used wherever hours worked are shown. */
export function fmtMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
