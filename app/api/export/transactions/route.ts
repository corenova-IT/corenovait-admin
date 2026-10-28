import { NextResponse } from "next/server";
import { getSessionState } from "@/lib/auth/session";
import { limiters, slowDown } from "@/lib/rate-limit";
import { toCsv } from "@/lib/csv";
import { AccessDenied } from "@/lib/dal/guard";
import { EXPENSE_CSV_HEADER, INCOME_CSV_HEADER, expenseFilters, exportExpensesCsv, exportIncomeCsv, incomeFilters } from "@/lib/dal/finance";

/**
 * CSV download of what the Transactions filters currently show.
 *   /api/export/transactions?tab=income&stream=1&from=2026-01-01
 *   /api/export/transactions?tab=expenses&template=1   (empty import template)
 * Exports need the export permission, respect scope, and are audit-logged.
 */
export async function GET(request: Request) {
  const s = await getSessionState();
  if (s.status !== "ok") return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const rl = limiters.exportPerUser.hit(s.actor.userId);
  if (!rl.ok) return NextResponse.json({ error: slowDown("downloads", rl.retryAfterSec) }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const tab = params.tab === "expenses" ? "expenses" : "income";

  if (params.template === "1") {
    const csv =
      tab === "income"
        ? toCsv(INCOME_CSV_HEADER, [["2026-10-01", "Upwork", "GB", "Example Client Ltd", "Website build", "1250.00", "GBP", "1.95", "INV-1001", "paid", "", ""]])
        : toCsv(EXPENSE_CSV_HEADER, [["2026-10-01", "Software", "Example Vendor", "Design tool licence", "49.99", "AUD", "1", "yes", ""]]);
    return csvResponse(`${tab}-import-template.csv`, csv);
  }

  try {
    const out =
      tab === "income"
        ? await exportIncomeCsv(s.actor, incomeFilters.parse(params))
        : await exportExpensesCsv(s.actor, expenseFilters.parse(params));
    return csvResponse(out.filename, out.csv);
  } catch (e) {
    if (e instanceof AccessDenied) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }
}

function csvResponse(filename: string, csv: string) {
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
