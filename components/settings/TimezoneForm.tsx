"use client";

import { useActionState, useMemo, useState } from "react";
import { Msg } from "@/components/transactions/LedgerForms";
import { Button } from "@/components/ui/Button";
import { Field, Select } from "@/components/ui/Field";
import { useKeepValues } from "@/components/ui/useKeepValues";

type State = { ok?: string; error?: string };

/** The company time zone, with the current time there so the choice is easy to check. */
export function TimezoneForm({ current, zones, action }: { current: string; zones: string[]; action: (p: State, fd: FormData) => Promise<State> }) {
  const [state, formAction, pending] = useActionState(action, {});
  const submit = useKeepValues(formAction);
  const [tz, setTz] = useState(current);
  const now = useMemo(() => {
    try {
      return new Intl.DateTimeFormat("en-AU", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short" }).format(new Date());
    } catch {
      return "";
    }
  }, [tz]);
  return (
    <form action={formAction} onSubmit={submit} className="flex flex-col gap-4">
      <Msg state={state} />
      <Field label="Company time zone" htmlFor="tz" hint={now ? `Now there: ${now}` : undefined}>
        <Select id="tz" name="timezone" value={tz} onChange={(e) => setTz(e.target.value)}>
          {zones.map((z) => (
            <option key={z} value={z}>
              {z.replace(/_/g, " ")}
            </option>
          ))}
        </Select>
      </Field>
      <Button type="submit" disabled={pending || tz === current} className="self-start">
        {pending ? "Saving…" : "Save time zone"}
      </Button>
    </form>
  );
}
