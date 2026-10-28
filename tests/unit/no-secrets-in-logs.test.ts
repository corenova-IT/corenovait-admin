import { afterEach, describe, expect, it, vi } from "vitest";

/** Security review: nothing secret (tokens, keys, passwords, message text) reaches the server log. */
const TOKEN = "reset-token-4f9c2b7d1e8a6035";
const KEY = "re_live_key_that_must_not_leak";

function captureLogs() {
  const lines: string[] = [];
  for (const m of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void lines.push(a.map(String).join(" ")));
  return lines;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("secrets stay out of the logs", () => {
  const mail = { to: "someone@corenovait.com", subject: "Reset your password", text: `Open https://portal.corenovait.com/reset-password?token=${TOKEN}`, html: "" };

  it("in production, an email that can't be sent is reported without its contents", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RESEND_API_KEY", "");
    const lines = captureLogs();
    const { sendMail } = await import("@/lib/email");
    expect(await sendMail(mail)).toEqual({ ok: false });
    expect(lines.join("\n")).not.toContain(TOKEN);
    expect(lines.join("\n")).not.toContain(mail.to);
  });

  it("a failed or refused Resend call logs neither the API key nor the message", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RESEND_API_KEY", KEY);
    vi.stubEnv("MAIL_FROM", "CoreNovaIT <portal@corenovait.com>");
    const lines = captureLogs();
    const { sendMail } = await import("@/lib/email");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`bad key ${KEY}`, { status: 401 })));
    expect(await sendMail(mail)).toEqual({ ok: false });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error(`connect failed with ${KEY}`))));
    expect(await sendMail(mail)).toEqual({ ok: false });
    const all = lines.join("\n");
    for (const secret of [KEY, TOKEN, mail.to]) expect(all).not.toContain(secret);
  });

  it("an unexpected error in a form action is logged by its type only, never its message", async () => {
    const lines = captureLogs();
    const { errorMessage } = await import("@/lib/auth/session");
    expect(errorMessage(new Error(`Access denied for user 'portal'@'db' (using password: ${KEY})`))).toMatch(/couldn't be saved/);
    expect(lines.join("\n")).not.toContain(KEY);
  });
});
