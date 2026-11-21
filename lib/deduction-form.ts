import type { DeductionInput } from "@/lib/dal/income-deductions";

/** Reads the repeated kind/label/amount fields of the taxes-and-fees form. Rows with no amount are skipped. */
export function deductionItemsFromForm(fd: FormData): DeductionInput[] {
  const kinds = fd.getAll("kind").map(String);
  const labels = fd.getAll("label").map(String);
  const amounts = fd.getAll("amount").map(String);
  const out: DeductionInput[] = [];
  for (let i = 0; i < kinds.length; i++) {
    const amount = (amounts[i] ?? "").trim();
    if (!amount) continue;
    out.push({ kind: kinds[i] as DeductionInput["kind"], label: labels[i] ?? "", amount });
  }
  return out;
}
