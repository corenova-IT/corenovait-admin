import { toLocalInput } from "@/lib/zoned";

type ShiftLike = {
  id: string;
  clockInAt: string;
  clockOutAt: string | null;
  minutes: number;
  open: boolean;
  flagged: boolean;
  corrected: boolean;
  correctionNote: string | null;
};

/** Adds the company-time-zone form values the correction form needs. (An open shift offers "now" as the clock-out.) */
export function shiftRows<T extends ShiftLike>(shifts: T[], timeZone: string) {
  return shifts.map((s) => ({
    id: s.id,
    clockInAt: s.clockInAt,
    clockOutAt: s.clockOutAt,
    minutes: s.minutes,
    open: s.open,
    flagged: s.flagged,
    corrected: s.corrected,
    correctionNote: s.correctionNote,
    inLocal: toLocalInput(new Date(s.clockInAt), timeZone),
    outLocal: toLocalInput(s.clockOutAt ? new Date(s.clockOutAt) : new Date(), timeZone),
  }));
}
