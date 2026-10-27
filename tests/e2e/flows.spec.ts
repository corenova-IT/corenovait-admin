import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * The interactive parts, in a real browser against the sample data: drag a
 * task between board columns, tick a checklist item and comment, drag a
 * calendar event to another day, log marketing activity, and open a quick
 * action from My Day. Each change is checked again after a reload.
 */
const BASE = "http://localhost:3210";

async function as(browser: Browser, who: "admin" | "staff" | "marketing") {
  const tokens = JSON.parse(readFileSync(path.resolve(".e2e/sessions.json"), "utf8"));
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addCookies([{ name: "__Host-cn_session", value: tokens[who], url: BASE.replace("http:", "https:"), secure: true, httpOnly: true }] as never);
  return { ctx, page: await ctx.newPage() };
}
/** Waits for the server action's reply, so a reload doesn't cancel it. */
const saved = (page: Page) => page.waitForResponse((r) => r.request().method() === "POST" && r.status() === 200);

test("tasks: drag a card to Done, tick the checklist, comment", async ({ browser }) => {
  const { ctx, page } = await as(browser, "admin");
  await page.goto(BASE + "/tasks", { waitUntil: "networkidle" });
  const card = page.getByRole("region", { name: /^To do/ }).locator("li").first();
  const title = (await card.locator("a > span").first().innerText()).trim();
  await card.scrollIntoViewIfNeeded();
  // drop on the column heading, which is on screen, so nothing scrolls mid-drag
  await Promise.all([saved(page), card.dragTo(page.getByRole("region", { name: /^Done/ }).getByRole("heading"))]);
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("region", { name: /^Done/ }).getByText(title, { exact: true })).toBeVisible();

  await page.goto(BASE + "/tasks?view=list", { waitUntil: "networkidle" });
  await page.getByRole("link", { name: /Update the Example Dental home page \(sample\)/ }).first().click();
  const panel = page.getByRole("dialog", { name: "Update the Example Dental home page (sample)" });
  const box = panel.getByRole("checkbox").first();
  const was = await box.isChecked();
  await box.click();
  await expect(box).toBeChecked({ checked: !was, timeout: 10_000 });
  await panel.getByLabel("Add a comment").fill("Checked from the browser test");
  await panel.getByRole("button", { name: "Post comment" }).click();
  await expect(panel.getByText("Checked from the browser test")).toBeVisible({ timeout: 10_000 });
  await ctx.close();
});

test("calendar: drag an event to the next day, keeping its time", async ({ browser }) => {
  const { ctx, page } = await as(browser, "admin");
  await page.goto(BASE + "/calendar?view=week", { waitUntil: "networkidle" });
  const monday = page.locator("div[aria-label^='Monday']");
  const tuesday = page.locator("div[aria-label^='Tuesday']");
  await Promise.all([saved(page), monday.getByRole("button", { name: /Team stand-up/ }).dragTo(tuesday.locator("span").first())]);
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator("div[aria-label^='Tuesday']").getByRole("button", { name: /09:30.*Team stand-up/ })).toBeVisible();
  await expect(page.locator("div[aria-label^='Monday']").getByRole("button", { name: /Team stand-up/ })).toHaveCount(0);
  await page.locator("div[aria-label^='Tuesday']").getByRole("button", { name: /Team stand-up/ }).click();
  await expect(page.getByRole("dialog", { name: "Team stand-up (sample)" }).getByRole("link", { name: "Add to my calendar (.ics)" })).toBeVisible();
  await ctx.close();
});

test("marketing: log a won deal; the form clears for the next one", async ({ browser }) => {
  const { ctx, page } = await as(browser, "marketing");
  await page.goto(BASE + "/marketing", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Log activity" }).click();
  const form = page.getByRole("dialog", { name: "Log activity" });
  await form.getByLabel("Who you contacted").fill("Flow Test Person");
  await form.getByLabel("Channel").selectOption("cold_call");
  await form.getByText("Deal won", { exact: true }).click();
  await form.getByLabel("Deal value").fill("1234.50");
  await form.getByRole("button", { name: "Log activity" }).click();
  await expect(form.getByText(/Logged Flow Test Person/)).toBeVisible({ timeout: 15_000 });
  await expect(form.getByLabel("Who you contacted")).toHaveValue("");
  await page.keyboard.press("Escape");
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByText("Flow Test Person").first()).toBeVisible();
  await ctx.close();
});

test("My Day: a quick action opens the form straight away", async ({ browser }) => {
  const { ctx, page } = await as(browser, "staff");
  await page.goto(BASE + "/home", { waitUntil: "networkidle" });
  await page.getByRole("link", { name: /New task/ }).click();
  await expect(page.getByRole("dialog", { name: "New task" })).toBeVisible({ timeout: 10_000 });
  await ctx.close();
});
