import { formatMoney } from "@/lib/money";

/** Small helpers shared by the partner's and the admin's pay screens (plain functions, no database). */
const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};

/** The "add pay" form as input for addPayPlan (which validates everything again on the server). */
export function payInputFromForm(fd: FormData) {
  return {
    employeeId: str(fd, "employeeId"),
    kind: (str(fd, "kind") || "monthly") as "monthly",
    streamId: str(fd, "streamId") || undefined,
    countryCode: str(fd, "countryCode") || undefined,
    projectId: str(fd, "projectId") || null,
    startMonth: str(fd, "startMonth") || undefined,
    amount: str(fd, "amount"),
    currency: str(fd, "currency"),
    fxRate: str(fd, "fxRate") || "1",
  };
}

export type PlanForView = {
  id: string;
  kind: "monthly" | "project";
  streamId: number;
  countryCode: string;
  project: string | null;
  amountMinor: number;
  currency: string;
  amountBaseMinor: number;
  startMonth: string | null;
  active: boolean;
  status: "due" | "paid" | null;
  paidDate: string | null;
};

/** Turns plans into the plain rows the pay panel shows. */
export function payRows(plans: PlanForView[], streams: Array<{ id: number; name: string }>, base: string) {
  return plans.map((p) => ({
    id: p.id,
    kind: p.kind,
    streamName: streams.find((s) => s.id === p.streamId)?.name ?? "",
    countryCode: p.countryCode,
    project: p.project,
    amountText: formatMoney(p.amountMinor, p.currency),
    baseText: p.currency === base ? null : `${formatMoney(p.amountBaseMinor, base)} in ${base}`,
    startMonth: p.startMonth,
    active: p.active,
    status: p.status,
    paidDate: p.paidDate,
  }));
}
