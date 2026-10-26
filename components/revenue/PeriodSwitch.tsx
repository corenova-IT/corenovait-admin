import { PillSwitch } from "@/components/ui/Pill";

/** 12 months / this year / all time, kept in the URL. */
export function PeriodSwitch({ path, value }: { path: string; value: string }) {
  return (
    <PillSwitch
      label="Period"
      value={value}
      options={[
        { value: "12m", label: "12 months", href: `${path}?period=12m` },
        { value: "ytd", label: "This year", href: `${path}?period=ytd` },
        { value: "all", label: "All time", href: `${path}?period=all` },
      ]}
    />
  );
}

export const PERIOD_LABEL: Record<string, string> = { "12m": "last 12 months", ytd: "this calendar year", all: "all time" };
