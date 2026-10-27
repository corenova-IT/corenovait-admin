import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * Visits every page at every target width, in both themes, and fails if
 * anything is clipped, sticks out of its card, makes the page scroll
 * sideways, or (from 1280px up) makes a table scroll sideways.
 *
 * CSS widths cover Windows display scaling too: 1920 at 125% = 1536 and at
 * 150% = 1280; 1440 at 125% = 1152; 1536 at 150% = 1024.
 */
const WIDTHS = process.env.E2E_WIDTHS ? process.env.E2E_WIDTHS.split(",").map(Number) : [1920, 1536, 1440, 1366, 1280, 1152, 1024, 768, 390];
const THEMES = (process.env.E2E_THEMES ? process.env.E2E_THEMES.split(",") : ["dark", "light"]) as Array<"dark" | "light">;
const BASE = "http://localhost:3210";
const COOKIE = "__Host-cn_session";

type Who = "none" | "admin" | "staff" | "mfaPending";
const tokens = () => JSON.parse(readFileSync(path.resolve(".e2e/sessions.json"), "utf8")) as Record<Exclude<Who, "none">, string> & { repId: string };

const PAGES: Array<{ path: string | ((t: ReturnType<typeof tokens>) => string); as: Who }> = [
  { path: "/login", as: "none" },
  { path: "/forgot-password", as: "none" },
  { path: "/mfa", as: "mfaPending" },
  { path: "/home", as: "admin" },
  { path: "/home?country=GB", as: "admin" },
  { path: "/home", as: "staff" },
  { path: "/analytics", as: "admin" },
  { path: "/analytics?country=AU", as: "admin" },
  { path: "/payments", as: "admin" },
  { path: "/payments?window=90", as: "admin" },
  { path: "/transactions", as: "admin" },
  { path: "/transactions?tab=expenses", as: "admin" },
  { path: "/streams", as: "admin" },
  { path: "/streams/1", as: "admin" },
  { path: "/streams/countries", as: "admin" },
  { path: "/streams/countries/GB", as: "admin" },
  { path: "/streams/representatives", as: "admin" },
  { path: (t) => `/streams/representatives/${t.repId}`, as: "admin" },
  { path: "/settings", as: "admin" },
  { path: "/team", as: "admin" },
  { path: "/audit", as: "admin" },
  { path: "/account", as: "admin" },
  { path: "/no-access?module=team", as: "staff" },
];

/** Runs in the page: returns a list of human-readable layout problems. */
function findLayoutProblems(checkTableScroll: boolean): string[] {
  const out: string[] = [];
  const label = (el: Element) => {
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 50);
    const cls = typeof el.className === "string" ? el.className.split(" ").slice(0, 3).join(".") : "";
    return `<${el.tagName.toLowerCase()}${cls ? "." + cls : ""}> "${text}"`;
  };
  const skip = (el: Element) => !!el.closest(".sr-only, svg, dialog:not([open]), [hidden]") || el.tagName === "OPTION";
  const visible = (el: Element) => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0;
  };
  const scrollParent = (el: Element) => {
    for (let p = el.parentElement; p; p = p.parentElement) if (/(auto|scroll)/.test(getComputedStyle(p).overflowX)) return p;
    return null;
  };

  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth + 1) {
    const insideScroller = (el: Element) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) if (/(auto|scroll)/.test(getComputedStyle(p).overflowX)) return true;
      return false;
    };
    // an <svg> itself can be the cause (its contents are skipped elsewhere)
    const wide = [...document.querySelectorAll("body *")].filter((el) => !(el.parentElement?.closest("svg") || el.closest("dialog:not([open]), [hidden]")) && visible(el) && el.getBoundingClientRect().right > de.clientWidth + 1 && !insideScroller(el));
    const innermost = wide.filter((el) => !wide.some((o) => o !== el && el.contains(o))).slice(0, 3);
    out.push(`page scrolls sideways (${de.scrollWidth}px content in ${de.clientWidth}px), caused by: ${innermost.map(label).join(" ; ")}`);
  }

  for (const el of document.querySelectorAll("body *")) {
    if (skip(el) || !visible(el)) continue;
    const s = getComputedStyle(el);
    const clips = /(hidden|clip)/.test(s.overflowX) || s.textOverflow === "ellipsis";
    if (clips && el.scrollWidth > el.clientWidth + 1 && (el.textContent ?? "").trim()) out.push(`clipped text: ${label(el)}`);
    if (checkTableScroll && /(auto|scroll)/.test(s.overflowX) && el.querySelector("table") && el.scrollWidth > el.clientWidth + 1) {
      out.push(`table needs sideways scrolling: ${label(el)}`);
    }
  }

  // cards never overlap each other (one card inside another is fine)
  const cards = [...document.querySelectorAll(".glass")].filter((c) => !skip(c) && visible(c) && getComputedStyle(c).position !== "absolute" && getComputedStyle(c).position !== "fixed");
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const [a, b] = [cards[i], cards[j]];
      if (a.contains(b) || b.contains(a)) continue;
      const [ra, rb] = [a.getBoundingClientRect(), b.getBoundingClientRect()];
      const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (w > 2 && h > 2) out.push(`cards overlap by ${Math.round(h)}px: ${label(a)} and ${label(b)}`);
    }
  }

  // an empty field's hint text fits inside the field
  const ctx2d = document.createElement("canvas").getContext("2d")!;
  for (const input of document.querySelectorAll<HTMLInputElement>("input[placeholder], textarea[placeholder]")) {
    if (skip(input) || !visible(input) || input.value || input.tagName === "TEXTAREA") continue;
    const s = getComputedStyle(input);
    ctx2d.font = `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
    const room = input.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
    if (ctx2d.measureText(input.placeholder).width > room + 1) out.push(`hint text cut off: <input> "${input.placeholder}"`);
  }

  // headings never break onto more than two lines
  for (const h of document.querySelectorAll("h1, h2, .title-card")) {
    if (skip(h) || !visible(h)) continue;
    const lh = parseFloat(getComputedStyle(h).lineHeight) || parseFloat(getComputedStyle(h).fontSize) * 1.2;
    const lines = Math.round(h.getBoundingClientRect().height / lh);
    if (lines > 2) out.push(`title wraps onto ${lines} lines: ${label(h)}`);
  }

  for (const card of document.querySelectorAll(".glass")) {
    if (skip(card) || !visible(card)) continue;
    const cr = card.getBoundingClientRect();
    for (const el of card.querySelectorAll("*")) {
      if (skip(el) || !visible(el)) continue;
      const sp = scrollParent(el);
      if (sp && card.contains(sp) && sp !== card) continue; // inside the card's own scroll area
      const r = el.getBoundingClientRect();
      if (r.right > cr.right + 1 || r.left < cr.left - 1) {
        out.push(`sticks out of its card by ${Math.round(Math.max(r.right - cr.right, cr.left - r.left))}px: ${label(el)}`);
        break;
      }
    }
  }
  return [...new Set(out)];
}

async function contextFor(browser: import("@playwright/test").Browser, who: Who, theme: "dark" | "light", width: number): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const cookies = [{ name: "cn_theme", value: theme, url: BASE }];
  // Chrome only plants a Secure cookie when given an https URL; it then sends it to http://localhost too
  if (who !== "none") cookies.push({ name: COOKIE, value: tokens()[who], url: BASE.replace("http:", "https:"), secure: true, httpOnly: true } as never);
  await ctx.addCookies(cookies as never);
  return ctx;
}

for (const theme of THEMES) {
  test(`every page fits at every width (${theme} theme)`, async ({ browser }) => {
    const problems: string[] = [];
    const t = tokens();
    for (const width of WIDTHS) {
      const contexts = new Map<Who, { ctx: BrowserContext; page: Page }>();
      for (const p of PAGES) {
        if (!contexts.has(p.as)) {
          const ctx = await contextFor(browser, p.as, theme, width);
          contexts.set(p.as, { ctx, page: await ctx.newPage() });
        }
        const { page } = contexts.get(p.as)!;
        const url = typeof p.path === "string" ? p.path : p.path(t);
        const res = await page.goto(BASE + url, { waitUntil: "networkidle" });
        if (!res || res.status() >= 400) {
          problems.push(`${width}px ${url}: HTTP ${res?.status()}`);
          continue;
        }
        if (p.as !== "none" && new URL(page.url()).pathname === "/login") {
          problems.push(`${width}px ${url}: unexpectedly sent to sign-in`);
          continue;
        }
        await page.evaluate(() => document.fonts.ready);
        const found = await page.evaluate(findLayoutProblems, width >= 1280);
        for (const f of found) problems.push(`${width}px ${url} (${p.as}): ${f}`);
      }
      for (const { ctx } of contexts.values()) await ctx.close();
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });
}
