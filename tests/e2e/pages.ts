import { readFileSync } from "node:fs";
import path from "node:path";
import type { Browser, BrowserContext } from "@playwright/test";

/** The pages the browser tests visit, and who visits them (sessions come from scripts/e2e-server.mjs). */
export const BASE = "http://localhost:3210";
export const COOKIE = "__Host-cn_session";

export type Who = "none" | "admin" | "staff" | "mfaPending" | "marketing";
export const tokens = () => JSON.parse(readFileSync(path.resolve(".e2e/sessions.json"), "utf8")) as Record<Exclude<Who, "none">, string> & { repId: string; dmAlexCasey: string };

export const PAGES: Array<{ path: string | ((t: ReturnType<typeof tokens>) => string); as: Who }> = [
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
  { path: "/account", as: "staff" },
  { path: "/reset-password?token=not-a-real-token-but-long-enough", as: "none" },
  { path: "/no-access?module=team", as: "staff" },
  { path: "/marketing", as: "admin" },
  { path: "/marketing?channel=cold_call&page=2", as: "admin" },
  { path: "/marketing?channel=individual_referral&campaign=none", as: "admin" },
  { path: "/marketing", as: "marketing" },
  { path: "/home", as: "marketing" },
  { path: "/calendar", as: "admin" },
  { path: "/calendar?view=week", as: "admin" },
  { path: "/calendar?view=agenda", as: "admin" },
  { path: "/calendar", as: "staff" },
  { path: "/tasks", as: "admin" },
  { path: "/tasks?view=list", as: "admin" },
  { path: "/tasks?assignee=me&view=list", as: "staff" },
  { path: "/tasks", as: "staff" },
  { path: "/chat", as: "admin" },
  { path: "/chat", as: "staff" },
  { path: (t) => `/chat?c=${t.dmAlexCasey}`, as: "staff" },
  { path: "/notifications", as: "admin" },
  { path: "/notifications", as: "staff" },
  { path: "/search?q=example", as: "admin" },
  { path: "/search?q=example", as: "staff" },
];

export async function contextFor(browser: Browser, who: Who, theme: "dark" | "light", width: number): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const cookies = [{ name: "cn_theme", value: theme, url: BASE }];
  // Chrome only plants a Secure cookie when given an https URL; it then sends it to http://localhost too
  if (who !== "none") cookies.push({ name: COOKIE, value: tokens()[who], url: BASE.replace("http:", "https:"), secure: true, httpOnly: true } as never);
  await ctx.addCookies(cookies as never);
  return ctx;
}

