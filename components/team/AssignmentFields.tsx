"use client";

import { useState } from "react";
import { FormMessage } from "@/components/ui/Field";
import type { AssignmentOptions } from "./types";

/**
 * The streams and countries a partner runs. Streams that already belong to another
 * partner are shown but can't be ticked (the server refuses them too). The warning appears
 * whenever the form would leave the partner able to see nothing.
 */
export function AssignmentFields({
  options,
  initial,
  userId,
  idPrefix,
}: {
  options: AssignmentOptions;
  initial?: { streamIds: number[]; countryCodes: string[] };
  /** the person being edited, so their own streams stay tickable */
  userId?: string;
  idPrefix: string;
}) {
  const [streamIds, setStreamIds] = useState<number[]>(initial?.streamIds ?? []);
  const [countryCodes, setCountryCodes] = useState<string[]>(initial?.countryCodes ?? []);
  const toggle = <T,>(list: T[], v: T, on: boolean) => (on ? [...list, v] : list.filter((x) => x !== v));

  return (
    <div className="flex flex-col gap-5">
      <fieldset>
        <legend className="label-mono mb-2">Streams they run</legend>
        <ul className="grid gap-2 sm:grid-cols-2">
          {options.streams.map((s) => {
            const takenByOther = s.partnerUserId !== null && s.partnerUserId !== userId;
            const id = `${idPrefix}-stream-${s.id}`;
            return (
              <li key={s.id} className="flex items-start gap-2">
                <input
                  id={id}
                  type="checkbox"
                  name="streamIds"
                  value={s.id}
                  checked={streamIds.includes(s.id)}
                  disabled={takenByOther}
                  onChange={(e) => setStreamIds((l) => toggle(l, s.id, e.target.checked))}
                  className="mt-0.5 size-[18px] cursor-pointer accent-[var(--accent)] disabled:cursor-not-allowed"
                />
                <label htmlFor={id} className={takenByOther ? "text-sm text-muted" : "text-sm text-ink"}>
                  {s.name}
                  {takenByOther && <span className="block text-xs">Already belongs to {s.partnerName}</span>}
                </label>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-xs text-muted">A stream can have only one partner.</p>
      </fieldset>

      <fieldset>
        <legend className="label-mono mb-2">Countries they can see</legend>
        <ul className="grid gap-2 sm:grid-cols-2">
          {options.countries.map((c) => {
            const id = `${idPrefix}-country-${c.code}`;
            return (
              <li key={c.code} className="flex items-start gap-2">
                <input
                  id={id}
                  type="checkbox"
                  name="countryCodes"
                  value={c.code}
                  checked={countryCodes.includes(c.code)}
                  onChange={(e) => setCountryCodes((l) => toggle(l, c.code, e.target.checked))}
                  className="mt-0.5 size-[18px] cursor-pointer accent-[var(--accent)]"
                />
                <label htmlFor={id} className="text-sm text-ink">
                  {c.name}
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>

      {countryCodes.length === 0 && (
        <FormMessage tone="info">This partner won&apos;t see any data until you assign at least one country.</FormMessage>
      )}
      {countryCodes.length > 0 && streamIds.length === 0 && (
        <FormMessage tone="info">This partner won&apos;t see any data until you assign at least one stream.</FormMessage>
      )}
    </div>
  );
}
