import Link from "next/link";
import { IconReceipt } from "@/components/icons";
import { AddEntry, ExportLink, ImportCsv, RowActions } from "@/components/transactions/LedgerActions";
import type { ExpenseView, IncomeView } from "@/components/transactions/types";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { ButtonLink, buttonClass } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DataTable, Pagination, type Column } from "@/components/ui/DataTable";
import { Field, Input, Select } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { PillSwitch } from "@/components/ui/Pill";
import { requirePerm } from "@/lib/auth/session";
import {
  PAGE_SIZE,
  expenseFilters,
  financeLookups,
  hasSampleData,
  incomeFilters,
  listExpenses,
  listIncome,
  type ExpenseRow,
  type IncomeRow,
} from "@/lib/dal/finance";
import { hasPerm } from "@/lib/dal/guard";
import { formatMoney } from "@/lib/money";
import { fmtDate, hrefWith } from "@/lib/format";
import { deleteExpense, deleteIncome, importCsv, saveExpense, saveIncome } from "./actions";

export const metadata = { title: "Transactions" };

const STATUS: Record<IncomeRow["status"], { label: string; tone: BadgeTone }> = {
  paid: { label: "Paid", tone: "green" },
  pending: { label: "Pending", tone: "amber" },
  overdue: { label: "Overdue", tone: "red" },
};

type SP = Record<string, string | undefined>;

// only what the edit forms need goes to the browser
const incomeView = (r: IncomeRow): IncomeView => ({
  id: r.id,
  entryDate: r.entryDate,
  streamId: r.streamId,
  countryCode: r.countryCode,
  client: r.client,
  description: r.description,
  amountMinor: r.amountMinor,
  currency: r.currency,
  fxRateToBase: r.fxRateToBase,
  invoiceRef: r.invoiceRef,
  status: r.status,
  representativeId: r.representativeId,
  invoiceFileId: r.invoiceFileId,
  notes: r.notes,
});
const expenseView = (r: ExpenseRow): ExpenseView => ({
  id: r.id,
  expenseDate: r.expenseDate,
  category: r.category,
  vendor: r.vendor,
  description: r.description,
  amountMinor: r.amountMinor,
  currency: r.currency,
  fxRateToBase: r.fxRateToBase,
  isRecurring: r.isRecurring,
  countryCode: r.countryCode,
  receiptFileId: r.receiptFileId,
  notes: r.notes,
});

/** Amount in the base currency, with the original amount underneath when it was in another currency. */
function Amount({ base, original }: { base: string; original: string | null }) {
  return (
    <span className="num block whitespace-nowrap font-mono">
      <span className="font-semibold text-ink">{base}</span>
      {original && <span className="block text-xs text-muted">{original}</span>}
    </span>
  );
}

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requirePerm("transactions");
  const sp = await searchParams;
  const tab = sp.tab === "expenses" ? "expenses" : "income";
  const [lookups, sample] = await Promise.all([financeLookups(actor), hasSampleData(actor)]);
  const can = {
    create: hasPerm(actor, "transactions", "create"),
    edit: hasPerm(actor, "transactions", "edit"),
    delete: hasPerm(actor, "transactions", "delete"),
    export: hasPerm(actor, "transactions", "export"),
  };
  const base = lookups.baseCurrency;
  const path = "/transactions";

  const filters = tab === "income" ? incomeFilters.parse(sp) : expenseFilters.parse(sp);
  const keep: SP = { tab, ...Object.fromEntries(Object.entries(filters).map(([k, v]) => [k, v === undefined ? undefined : String(v)])) };
  const sortLink = (key: string, defaultDir: "asc" | "desc") => {
    const active = (filters.sort ?? "date") === key;
    const dir = (filters.dir ?? (key === "date" || key === "amount" ? "desc" : "asc")) as "asc" | "desc";
    const nextDir = active ? (dir === "asc" ? "desc" : "asc") : defaultDir;
    return { href: hrefWith(path, keep, { sort: key, dir: nextDir, page: undefined }), active, dir };
  };
  const filtered = Object.entries(filters).some(([k, v]) => v !== undefined && !["page", "sort", "dir"].includes(k));
  const exportHref = `/api/export/transactions?${new URLSearchParams(
    Object.entries(keep).filter(([k, v]) => v !== undefined && k !== "page") as Array<[string, string]>
  )}`;

  const data = tab === "income" ? await listIncome(actor, incomeFilters.parse(sp)) : await listExpenses(actor, expenseFilters.parse(sp));
  const page = filters.page ?? 1;

  const incomeColumns: Column<IncomeRow>[] = [
    { key: "date", header: "Date", sort: sortLink("date", "desc"), cell: (r) => <span className="whitespace-nowrap font-mono text-sm text-ink-2">{fmtDate(r.entryDate)}</span> },
    {
      key: "client",
      header: "Client",
      sort: sortLink("client", "asc"),
      cell: (r) => (
        <div className="min-w-[10rem]">
          <p className="clamp-2 font-medium leading-snug text-ink">{r.client || "No client"}</p>
          <p className="clamp-2 text-sm text-muted">
            {[r.description, r.invoiceRef].filter(Boolean).join(" · ")}
            {r.invoiceFileId && (
              <a href={`/api/files/${r.invoiceFileId}?download=1`} className="ml-2 inline-flex items-center gap-1 text-accent-text hover:underline">
                <IconReceipt size={14} /> Invoice
              </a>
            )}
          </p>
        </div>
      ),
    },
    {
      key: "stream",
      header: "Stream",
      hideBelow: "md",
      cell: (r) => (
        <div className="min-w-[8rem]">
          <p className="clamp-2 leading-snug text-ink-2">{r.streamName}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
            <span className="font-mono">{r.countryCode}</span>
            {r.representativeName && <span>via {r.representativeName}</span>}
          </p>
        </div>
      ),
    },
    {
      key: "amount",
      header: `Amount (${base})`,
      align: "right",
      sort: sortLink("amount", "desc"),
      cell: (r) => <Amount base={formatMoney(r.amountBaseMinor, base)} original={r.currency === base ? null : formatMoney(r.amountMinor, r.currency)} />,
    },
    { key: "status", header: "Status", sort: sortLink("status", "asc"), cell: (r) => <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge> },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (r) => (
        <RowActions
          tab="income"
          row={incomeView(r)}
          label={`${fmtDate(r.entryDate)} · ${r.client || r.description || "income"}`}
          lookups={lookups}
          canEdit={can.edit}
          canDelete={can.delete}
          save={saveIncome}
          remove={deleteIncome}
        />
      ),
    },
  ];

  const expenseColumns: Column<ExpenseRow>[] = [
    { key: "date", header: "Date", sort: sortLink("date", "desc"), cell: (r) => <span className="whitespace-nowrap font-mono text-sm text-ink-2">{fmtDate(r.expenseDate)}</span> },
    {
      key: "vendor",
      header: "Vendor",
      sort: sortLink("vendor", "asc"),
      cell: (r) => (
        <div className="min-w-[10rem]">
          <p className="clamp-2 font-medium leading-snug text-ink">{r.vendor || "No vendor"}</p>
          <p className="clamp-2 text-sm text-muted">
            {r.description}
            {r.receiptFileId && (
              <a href={`/api/files/${r.receiptFileId}?download=1`} className="ml-2 inline-flex items-center gap-1 text-accent-text hover:underline">
                <IconReceipt size={14} /> Receipt
              </a>
            )}
          </p>
        </div>
      ),
    },
    {
      key: "category",
      header: "Category",
      sort: sortLink("category", "asc"),
      cell: (r) => (
        <div className="flex flex-col items-start gap-1">
          <Badge>{r.category}</Badge>
          <span className="whitespace-nowrap text-xs text-muted">
            {r.countryCode ?? "Shared"} · {r.isRecurring ? <span className="text-warning">Recurring</span> : "One-off"}
          </span>
        </div>
      ),
    },
    {
      key: "amount",
      header: `Amount (${base})`,
      align: "right",
      sort: sortLink("amount", "desc"),
      cell: (r) => <Amount base={formatMoney(r.amountBaseMinor, base)} original={r.currency === base ? null : formatMoney(r.amountMinor, r.currency)} />,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (r) => (
        <RowActions
          tab="expenses"
          row={expenseView(r)}
          label={`${fmtDate(r.expenseDate)} · ${r.vendor || r.category}`}
          lookups={lookups}
          canEdit={can.edit}
          canDelete={can.delete}
          save={saveExpense}
          remove={deleteExpense}
        />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Transactions"
        subtitle={`Income and expenses · amounts in ${base} use the rate on each entry`}
        sample={sample}
        actions={
          <div className="flex flex-wrap gap-3">
            {can.export && <ExportLink href={exportHref} />}
            {can.create && <ImportCsv tab={tab} action={importCsv} />}
            {can.create && <AddEntry tab={tab} lookups={lookups} saveIncome={saveIncome} saveExpense={saveExpense} initialOpen={sp.new === "1"} />}
          </div>
        }
      />

      <div className="mb-[var(--space-gap)] flex flex-wrap items-center justify-between gap-4">
        <PillSwitch
          label="Ledger"
          value={tab}
          options={[
            { value: "income", label: "Income", href: `${path}?tab=income` },
            { value: "expenses", label: "Expenses", href: `${path}?tab=expenses` },
          ]}
        />
        <p className="font-mono text-sm text-ink-2" aria-live="polite">
          {data.total} {tab === "income" ? (data.total === 1 ? "entry" : "entries") : data.total === 1 ? "expense" : "expenses"}
          {filtered ? " matching" : ""}
          {"paidBaseMinor" in data ? (
            <>
              {" "}· paid <span className="font-semibold text-ink">{formatMoney(data.paidBaseMinor, base)}</span> · outstanding{" "}
              <span className="font-semibold text-warning">{formatMoney(data.outstandingBaseMinor, base)}</span>
            </>
          ) : (
            <>
              {" "}· total <span className="font-semibold text-ink">{formatMoney(data.totalBaseMinor, base)}</span>
            </>
          )}
        </p>
      </div>

      <Card className="mb-6">
        <form method="get" className="grid gap-4 @min-[34rem]:grid-cols-2 @min-[52rem]:grid-cols-3 @min-[76rem]:grid-cols-6 @min-[52rem]:items-end">
          <input type="hidden" name="tab" value={tab} />
          <Field label="Search" htmlFor="f-q" className="sm:col-span-2">
            <Input id="f-q" name="q" defaultValue={filters.q} placeholder={tab === "income" ? "Client, description, invoice" : "Vendor, description, category"} />
          </Field>
          <Field label="From" htmlFor="f-from">
            <Input id="f-from" name="from" type="date" defaultValue={filters.from} />
          </Field>
          <Field label="To" htmlFor="f-to">
            <Input id="f-to" name="to" type="date" defaultValue={filters.to} />
          </Field>
          {tab === "income" ? (
            <>
              <Field label="Stream" htmlFor="f-stream">
                <Select id="f-stream" name="stream" defaultValue={sp.stream ?? ""}>
                  <option value="">All streams</option>
                  {lookups.streams.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Country" htmlFor="f-country">
                <Select id="f-country" name="country" defaultValue={sp.country ?? ""}>
                  <option value="">All countries</option>
                  {lookups.countries.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Status" htmlFor="f-status">
                <Select id="f-status" name="status" defaultValue={sp.status ?? ""}>
                  <option value="">Any status</option>
                  <option value="paid">Paid</option>
                  <option value="pending">Pending</option>
                  <option value="overdue">Overdue</option>
                </Select>
              </Field>
              <Field label="Representative" htmlFor="f-rep">
                <Select id="f-rep" name="rep" defaultValue={sp.rep ?? ""}>
                  <option value="">Anyone</option>
                  <option value="none">No representative</option>
                  {lookups.representatives.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          ) : (
            <>
              <Field label="Category" htmlFor="f-cat">
                <Select id="f-cat" name="category" defaultValue={sp.category ?? ""}>
                  <option value="">All categories</option>
                  {lookups.allCategories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Type" htmlFor="f-rec">
                <Select id="f-rec" name="recurring" defaultValue={sp.recurring ?? ""}>
                  <option value="">All</option>
                  <option value="yes">Recurring</option>
                  <option value="no">One-off</option>
                </Select>
              </Field>
              <Field label="Country" htmlFor="f-ecountry">
                <Select id="f-ecountry" name="country" defaultValue={sp.country ?? ""}>
                  <option value="">All</option>
                  <option value="shared">Shared costs</option>
                  {lookups.countries.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          )}
          <div className="flex gap-2 lg:col-span-2 xl:col-span-1 xl:justify-end">
            <button type="submit" className={buttonClass("primary")}>
              Filter
            </button>
            {filtered && (
              <ButtonLink href={`${path}?tab=${tab}`} variant="ghost">
                Clear
              </ButtonLink>
            )}
          </div>
        </form>
      </Card>

      <Card>
        {tab === "income" ? (
          <DataTable
            caption="Income entries"
            columns={incomeColumns}
            rows={data.rows as IncomeRow[]}
            rowKey={(r) => r.id}
            empty={{ title: filtered ? "No income matches these filters" : "No income recorded yet", body: can.create ? "Add an entry or import a CSV to get started." : undefined }}
          />
        ) : (
          <DataTable
            caption="Expenses"
            columns={expenseColumns}
            rows={data.rows as ExpenseRow[]}
            rowKey={(r) => r.id}
            empty={{ title: filtered ? "No expenses match these filters" : "No expenses recorded yet", body: can.create ? "Add an expense or import a CSV to get started." : undefined }}
          />
        )}
        <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} hrefFor={(p) => hrefWith(path, keep, { page: String(p) })} />
      </Card>
      <p className="mt-4 text-sm text-muted">
        Revenue reports by stream, country and representative are in <Link className="text-accent-text hover:underline" href="/streams">Revenue streams</Link>.
      </p>
    </>
  );
}
