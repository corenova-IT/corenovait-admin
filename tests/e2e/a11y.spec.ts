import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { BASE, PAGES, contextFor, tokens, type Who } from "./pages";

/**
 * Accessibility checks, in both themes:
 * - axe (WCAG 2.1 A and AA rules, including 4.5:1 text contrast) on every page,
 *   on a desktop and a phone width, and with the main dialogs open; any
 *   "serious" or "critical" finding fails the test
 * - keyboard only: a visible focus ring on every stop, the skip link first,
 *   dialogs that open from the keyboard, trap focus and give it back
 * - prefers-reduced-motion switches animations and transitions off
 */
const THEMES = (process.env.E2E_THEMES ? process.env.E2E_THEMES.split(",") : ["dark", "light"]) as Array<"dark" | "light">;
const WIDTHS = [1280, 390];

async function axe(page: Page, where: string): Promise<string[]> {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return r.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .flatMap((v) => v.nodes.slice(0, 4).map((n) => `${where}: [${v.id}] ${v.help} → ${n.target.join(" ")}${n.failureSummary ? ` (${n.failureSummary.split("\n").slice(1, 2).join(" ").trim()})` : ""}`));
}

for (const theme of THEMES) {
  test(`no serious accessibility problems on any page (${theme} theme)`, async ({ browser }) => {
    const problems: string[] = [];
    const t = tokens();
    for (const width of WIDTHS) {
      const pages = new Map<Who, Page>();
      for (const p of PAGES) {
        if (!pages.has(p.as)) pages.set(p.as, await (await contextFor(browser, p.as, theme, width)).newPage());
        const page = pages.get(p.as)!;
        const url = typeof p.path === "string" ? p.path : p.path(t);
        await page.goto(BASE + url, { waitUntil: "networkidle" });
        problems.push(...(await axe(page, `${width}px ${url} (${p.as})`)));
      }
      for (const page of pages.values()) await page.context().close();
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });

  test(`dialogs and forms are accessible when open (${theme} theme)`, async ({ browser }) => {
    const problems: string[] = [];
    const page = await (await contextFor(browser, "admin", theme, 1280)).newPage();
    for (const [url, button] of [
      ["/calendar", "New event"],
      ["/tasks", "New task"],
      ["/transactions", "Add income"],
      ["/payments", "Add payment"],
      ["/marketing", "Log activity"],
      ["/team", "Invite person"],
    ] as const) {
      await page.goto(BASE + url, { waitUntil: "networkidle" });
      const open = page.getByRole("button", { name: button }).first();
      if (!(await open.count())) {
        problems.push(`${url}: no "${button}" button`);
        continue;
      }
      await open.click();
      await expect(page.getByRole("dialog")).toBeVisible();
      problems.push(...(await axe(page, `${url} with "${button}" open`)));
    }
    await page.context().close();
    expect(problems, problems.join("\n")).toEqual([]);
  });
}

/** Runs in the page: what the focused element looks like. */
const focusInfo = () => {
  const el = document.activeElement as HTMLElement | null;
  if (!el || el === document.body) return null;
  // focus is inside one of the browser's own controls (e.g. a date field's calendar button), which draws its own ring
  if (!el.matches(":focus")) return { tag: el.tagName.toLowerCase(), text: "", ring: true, visible: true };
  const s = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const ring = (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || (s.boxShadow !== "none" && s.boxShadow !== "");
  const what = el.tagName === "INPUT" ? ` type=${(el as HTMLInputElement).type} name=${(el as HTMLInputElement).name}` : "";
  return { tag: el.tagName.toLowerCase() + what, text: (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40), ring, visible: r.width > 0 && r.height > 0 };
};

test("keyboard only: skip link first, a visible focus ring on every stop, nothing hidden takes focus", async ({ browser }) => {
  const problems: string[] = [];
  for (const [who, url] of [
    ["staff", "/home"],
    ["admin", "/home"],
    ["admin", "/transactions"],
    ["admin", "/calendar"],
    ["staff", "/tasks"],
    ["staff", "/chat"],
    ["admin", "/settings"],
    ["none", "/login"],
  ] as const) {
    const page = await (await contextFor(browser, who, "light", 1280)).newPage();
    await page.goto(BASE + url, { waitUntil: "networkidle" });
    await page.keyboard.press("Tab");
    const first = await page.evaluate(focusInfo);
    if (who !== "none" && !/skip to content/i.test(first?.text ?? "")) problems.push(`${url}: the first Tab goes to "${first?.text}", not the skip link`);
    for (let i = 0; i < 40; i++) {
      const f = await page.evaluate(focusInfo);
      if (!f) break;
      if (!f.visible) problems.push(`${url}: an invisible <${f.tag}> "${f.text}" takes focus`);
      else if (!f.ring) problems.push(`${url}: no focus ring on <${f.tag}> "${f.text}"`);
      await page.keyboard.press("Tab");
    }
    await page.context().close();
  }
  expect([...new Set(problems)], problems.join("\n")).toEqual([]);
});

test("keyboard only: the skip link jumps to the page, and a dialog opens, keeps focus inside and gives it back", async ({ browser }) => {
  const page = await (await contextFor(browser, "admin", "dark", 1280)).newPage();
  await page.goto(BASE + "/calendar", { waitUntil: "networkidle" });
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => !!document.activeElement?.closest("main"))).toBe(true);

  const open = page.getByRole("button", { name: "New event" });
  await open.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // Tab round the whole dialog and a bit more: focus never reaches the page behind it
  // (at the end of the cycle Chrome briefly hands focus to its own toolbar, which leaves <body> active)
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement === document.body || !!document.activeElement?.closest("dialog, [role=dialog]"))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();
  await page.context().close();
});

test("prefers-reduced-motion turns animations and transitions off", async ({ browser }) => {
  const ctx = await contextFor(browser, "admin", "dark", 1280);
  const page = await ctx.newPage();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(BASE + "/home", { waitUntil: "networkidle" });
  const moving = await page.evaluate(() =>
    [...document.querySelectorAll("*")]
      .map((el) => getComputedStyle(el))
      .filter((s) => s.animationName !== "none" && parseFloat(s.animationDuration) > 0.001)
      .concat([...document.querySelectorAll("*")].map((el) => getComputedStyle(el)).filter((s) => s.transitionDuration.split(",").some((d) => parseFloat(d) > 0.001))).length
  );
  expect(moving).toBe(0);
  await ctx.close();
});
