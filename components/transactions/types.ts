/** Plain data the Transactions screens pass from the server to client components. */
export type Lookups = {
  streams: Array<{ id: number; name: string; active: boolean }>;
  countries: Array<{ code: string; name: string }>;
  representatives: Array<{ id: string; name: string; commissionRate: string; active: boolean }>;
  categories: string[];
  baseCurrency: string;
};

export type IncomeView = {
  id: string;
  entryDate: string;
  streamId: number;
  countryCode: string;
  client: string;
  description: string;
  amountMinor: number;
  currency: string;
  fxRateToBase: string;
  invoiceRef: string | null;
  status: "pending" | "paid" | "overdue";
  representativeId: string | null;
  invoiceFileId: string | null;
  notes: string | null;
};

export type ExpenseView = {
  id: string;
  expenseDate: string;
  category: string;
  vendor: string;
  description: string;
  amountMinor: number;
  currency: string;
  fxRateToBase: string;
  isRecurring: boolean;
  receiptFileId: string | null;
  notes: string | null;
};

export type LedgerState = { ok?: string; error?: string; errors?: string[] };
export type LedgerAction = (prev: LedgerState, fd: FormData) => Promise<LedgerState>;

export const CURRENCIES = ["AUD", "GBP", "USD", "EUR", "NZD", "CAD", "PKR"];
