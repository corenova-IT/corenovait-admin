import { formatRatePercent } from "@/lib/money";
import type { RepView } from "./RepForms";

/** Only what the representative form needs goes to the browser. */
export const repView = (r: { id: string; name: string; email: string | null; phone: string | null; commissionRate: string; userId: string | null; active: boolean }): RepView => ({
  id: r.id,
  name: r.name,
  email: r.email,
  phone: r.phone,
  commissionPercent: formatRatePercent(r.commissionRate).replace("%", ""),
  userId: r.userId,
  active: r.active,
});
