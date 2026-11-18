"use client";

import { useActionState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field, FormMessage, Input } from "@/components/ui/Field";
import { fmtMinutes } from "@/lib/hours";

export type ShiftState = { ok?: string; error?: string };
export type ShiftAction = (prev: ShiftState, fd: FormData) => Promise<ShiftState>;
export type ShiftRow = {
  id: string;
  clockInAt: string;
  clockOutAt: string | null;
  minutes: number;
  open: boolean;
  flagged: boolean;
  corrected: boolean;
  correctionNote: string | null;
  /** the shift's times as "YYYY-MM-DDTHH:mm" in the company time zone, to prefill the correction form */
  inLocal: string;
  outLocal: string;
};

function CorrectForm({ shift, action }: { shift: ShiftRow; action: ShiftAction }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="mt-3 grid gap-3 sm:grid-cols-2" noValidate>
      <input type="hidden" name="shiftId" value={shift.id} />
      <Field label="Clock in" htmlFor={`in-${shift.id}`}>
        <Input id={`in-${shift.id}`} name="clockIn" type="datetime-local" required defaultValue={shift.inLocal} />
      </Field>
      <Field label="Clock out" htmlFor={`out-${shift.id}`} hint={shift.open ? "Set when they really finished" : undefined}>
        <Input id={`out-${shift.id}`} name="clockOut" type="datetime-local" required defaultValue={shift.outLocal} />
      </Field>
      <Field label="Why are you correcting it?" htmlFor={`note-${shift.id}`} className="sm:col-span-2">
        <Input id={`note-${shift.id}`} name="note" required maxLength={300} placeholder="e.g. Forgot to clock out" />
      </Field>
      <div className="flex flex-col gap-2 sm:col-span-2">
        {state.error && <FormMessage tone="error">{state.error}</FormMessage>}
        {state.ok && <FormMessage tone="success">{state.ok}</FormMessage>}
        <Button type="submit" size="sm" disabled={pending} className="self-start">{pending ? "Saving…" : "Save correction"}</Button>
        <p className="text-xs text-muted">Corrections are logged: who, when, why, and the times before and after.</p>
      </div>
    </form>
  );
}

/** An employee's shifts with their hours. Partners and admins can correct a shift (the employee can't). */
export function ShiftPanel({ shifts, timeZone, action }: { shifts: ShiftRow[]; timeZone: string; action?: ShiftAction }) {
  const fmt = new Intl.DateTimeFormat("en-AU", { timeZone, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  if (shifts.length === 0) return <p className="text-sm text-muted">No shifts in this period.</p>;
  return (
    <ul className="flex flex-col">
      {shifts.map((s) => (
        <li key={s.id} className="border-b border-line/70 py-3 last:border-b-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-ink">
              {fmt.format(new Date(s.clockInAt))} – {s.clockOutAt ? fmt.format(new Date(s.clockOutAt)) : "still open"}
            </span>
            {s.clockOutAt && <span className="text-sm text-muted">{fmtMinutes(s.minutes)}</span>}
            {s.flagged && <Badge tone="red">Forgot to clock out</Badge>}
            {s.open && !s.flagged && <Badge tone="green">Clocked in</Badge>}
            {s.corrected && <Badge tone="amber">Corrected</Badge>}
          </div>
          {s.corrected && s.correctionNote && <p className="mt-1 text-xs text-muted">Reason: {s.correctionNote}</p>}
          {action && (
            <details className="mt-2">
              <summary className="cursor-pointer text-sm text-accent-text">{s.flagged ? "Correct this shift" : "Correct"}</summary>
              <CorrectForm shift={s} action={action} />
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}

/** The employee's own clock: one button that changes with their state. */
export function ClockButtons({ open, flagged, clockIn, clockOut }: { open: boolean; flagged: boolean; clockIn: ShiftAction; clockOut: ShiftAction }) {
  const [inState, inAction, inPending] = useActionState(clockIn, {});
  const [outState, outAction, outPending] = useActionState(clockOut, {});
  return (
    <div className="flex flex-col gap-2">
      {!open ? (
        <form action={inAction}>
          <Button type="submit" disabled={inPending}>{inPending ? "Clocking in…" : "Clock in"}</Button>
        </form>
      ) : (
        <form action={outAction}>
          <Button type="submit" variant="secondary" disabled={outPending || flagged}>{outPending ? "Clocking out…" : "Clock out"}</Button>
        </form>
      )}
      {flagged && <FormMessage tone="error">You forgot to clock out of an earlier shift. Ask your partner to correct it, then you can clock in again.</FormMessage>}
      {inState.error && <FormMessage tone="error">{inState.error}</FormMessage>}
      {outState.error && <FormMessage tone="error">{outState.error}</FormMessage>}
      {outState.ok && <FormMessage tone="success">{outState.ok}</FormMessage>}
    </div>
  );
}
