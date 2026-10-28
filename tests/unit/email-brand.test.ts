import { afterEach, describe, expect, it, vi } from "vitest";

/** Emails show the atom logo from the live site, with text that still says who it's from when images are blocked. */
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("email branding", () => {
  it("every email has the light-theme logo from SITE_URL, with alt text and the name beside it", async () => {
    vi.stubEnv("SITE_URL", "https://admin.corenovait.com.au");
    const { inviteEmail, notificationEmail, resetEmail } = await import("@/lib/email");
    for (const m of [inviteEmail("a@corenovait.com.au", "Ann", "tok", "Ben"), resetEmail("a@corenovait.com.au", "tok"), notificationEmail("a@corenovait.com.au", { title: "Due today", body: "", href: "/tasks" })]) {
      expect(m.html).toContain('<img src="https://admin.corenovait.com.au/brand/corenova-logo.png" width="44" height="44" alt="CoreNovaIT"');
      expect(m.html).toContain("CORENOVAIT PORTAL");
      expect(m.html).not.toContain("light-lines");
      // the plain-text version needs no picture
      expect(m.text).not.toContain("<img");
    }
  });
});
