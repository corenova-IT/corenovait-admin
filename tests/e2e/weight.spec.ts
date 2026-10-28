import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { BASE, contextFor, type Who } from "./pages";

/**
 * Page weight: what a first visit downloads (compressed, empty cache) on the
 * main pages. Writes .e2e/page-weight.md (the table in the README comes from
 * it) and fails if a page goes over the budget.
 */
const PAGES: Array<[string, Who]> = [
  ["/login", "none"],
  ["/home", "admin"],
  ["/home", "staff"],
  ["/analytics", "admin"],
  ["/transactions", "admin"],
  ["/payments", "admin"],
  ["/marketing", "admin"],
  ["/calendar", "admin"],
  ["/tasks", "admin"],
  ["/chat", "staff"],
];
/** compressed bytes; the HTML is small, almost all of this is the shared React and Next.js runtime */
const BUDGET = { total: 450_000, js: 380_000 };

test("page weight on the main pages stays within budget", async ({ browser }) => {
  const rows: Array<{ page: string; who: Who; total: number; js: number; css: number; html: number; requests: number }> = [];
  for (const [path, who] of PAGES) {
    const ctx = await contextFor(browser, who, "dark", 1440);
    const page = await ctx.newPage();
    await page.goto(BASE + path, { waitUntil: "networkidle" });
    const entries = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
      const res = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
      return [{ name: nav.name, type: "html", size: nav.transferSize }, ...res.map((r) => ({ name: r.name, type: /\.js(\?|$)/.test(r.name) ? "js" : /\.css(\?|$)/.test(r.name) ? "css" : r.initiatorType, size: r.transferSize }))];
    });
    const sum = (type?: string) => entries.filter((e) => !type || e.type === type).reduce((n, e) => n + e.size, 0);
    rows.push({ page: path, who, total: sum(), js: sum("js"), css: sum("css"), html: sum("html"), requests: entries.length });
    await ctx.close();
  }
  const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
  const table = [
    "| Page | Signed in as | Total | JavaScript | CSS | HTML | Requests |",
    "|---|---|---:|---:|---:|---:|---:|",
    ...rows.map((r) => `| ${r.page} | ${r.who === "none" ? "nobody" : r.who} | ${kb(r.total)} | ${kb(r.js)} | ${kb(r.css)} | ${kb(r.html)} | ${r.requests} |`),
  ].join("\n");
  mkdirSync(".e2e", { recursive: true });
  writeFileSync(".e2e/page-weight.md", table + "\n");
  console.log("\n" + table);
  const over = rows.filter((r) => r.total > BUDGET.total || r.js > BUDGET.js).map((r) => `${r.page} (${r.who}): ${kb(r.total)} total, ${kb(r.js)} JavaScript`);
  expect(over, `over budget:\n${over.join("\n")}`).toEqual([]);
});
