import Link from "next/link";
import { IconChevronLeft, IconChevronRight } from "@/components/icons";
import { cx } from "./cx";
import { EmptyState } from "./States";

export type Column<T> = {
  key: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  align?: "left" | "right";
  className?: string;
  /** hide below this breakpoint to keep phone layouts readable */
  hideBelow?: "sm" | "md" | "lg";
};

const hide = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell" };

/**
 * Accessible data table: real <table>, <caption> for screen readers, column
 * headers with scope, horizontal scroll on small screens. Pagination is done
 * on the server; this only renders the current page.
 */
export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  empty,
}: {
  caption: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: { title: string; body?: string };
}) {
  if (rows.length === 0) {
    return <EmptyState title={empty?.title ?? "Nothing here yet"}>{empty?.body}</EmptyState>;
  }
  return (
    <div className="-mx-2 overflow-x-auto px-2">
      <table className="w-full border-separate border-spacing-0 text-left">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cx(
                  "label-mono border-b border-line pb-3 pr-4 font-normal",
                  c.align === "right" && "text-right",
                  c.hideBelow && hide[c.hideBelow]
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className="group">
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cx(
                    "border-b border-line/70 py-4 pr-4 align-middle text-[15px] text-ink group-last:border-b-0",
                    c.align === "right" && "text-right",
                    c.hideBelow && hide[c.hideBelow],
                    c.className
                  )}
                >
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  hrefFor,
}: {
  page: number;
  pageSize: number;
  total: number;
  hrefFor: (page: number) => string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const link = "grid size-10 place-items-center rounded-xl border border-line text-ink-2 hover:border-accent-line hover:text-ink";
  return (
    <nav aria-label="Pagination" className="mt-5 flex items-center justify-between gap-4">
      <p className="font-mono text-xs text-muted">
        {from}–{to} of {total}
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link className={link} href={hrefFor(page - 1)} aria-label="Previous page">
            <IconChevronLeft />
          </Link>
        ) : (
          <span className={cx(link, "opacity-40")} aria-hidden="true">
            <IconChevronLeft />
          </span>
        )}
        {page < pages ? (
          <Link className={link} href={hrefFor(page + 1)} aria-label="Next page">
            <IconChevronRight />
          </Link>
        ) : (
          <span className={cx(link, "opacity-40")} aria-hidden="true">
            <IconChevronRight />
          </span>
        )}
      </div>
    </nav>
  );
}
