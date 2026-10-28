import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { pickClientIp } from "@/lib/client-ip";
import { buildCsp } from "@/lib/csp";
import { proxy } from "@/proxy";

/** Phase 6 security review: one test per fix (see SECURITY.md). */

describe("client IP for rate limits (fix: spoofed X-Forwarded-For)", () => {
  it("uses the address the proxy added, not one the client made up", () => {
    // the attacker sends "1.2.3.4"; Hostinger's proxy appends the real address
    expect(pickClientIp("1.2.3.4, 203.0.113.9", null, 1)).toBe("203.0.113.9");
    expect(pickClientIp("9.9.9.9, 8.8.8.8, 203.0.113.9", null, 1)).toBe("203.0.113.9");
  });

  it("so changing the fake address doesn't give a fresh rate-limit bucket", () => {
    const a = pickClientIp("10.0.0.1, 203.0.113.9", null, 1);
    const b = pickClientIp("10.0.0.2, 203.0.113.9", null, 1);
    expect(a).toBe(b);
  });

  it("supports two proxies, and falls back to X-Real-IP", () => {
    expect(pickClientIp("1.2.3.4, 203.0.113.9, 10.0.0.5", null, 2)).toBe("203.0.113.9");
    expect(pickClientIp(null, "198.51.100.7", 1)).toBe("198.51.100.7");
    expect(pickClientIp(null, null, 1)).toBe("unknown");
  });
});

describe("Content Security Policy (fix: no 'unsafe-inline' scripts)", () => {
  it("only runs scripts from this site or with this request's nonce", () => {
    const csp = buildCsp("abc123==", false);
    const script = csp.split("; ").find((d) => d.startsWith("script-src"))!;
    expect(script).toBe("script-src 'self' 'nonce-abc123==' 'strict-dynamic'");
    expect(script).not.toContain("unsafe-inline");
    expect(script).not.toContain("unsafe-eval");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("the proxy sends a different nonce on every request, on pages and API routes alike", () => {
    const req = () => new NextRequest("http://localhost/home", { headers: { cookie: "cn_session=x" } });
    const a = proxy(req()).headers.get("content-security-policy");
    const b = proxy(req()).headers.get("content-security-policy");
    expect(a).toMatch(/'nonce-[A-Za-z0-9+/=]{16,}'/);
    expect(a).not.toEqual(b);
  });
});

describe("the proxy (fix: the cron job was blocked)", () => {
  it("lets the scheduler through without a session cookie (it checks its own token)", () => {
    const res = proxy(new NextRequest("http://localhost/api/cron/notifications", { method: "POST" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("still refuses other API routes and pages without a cookie", () => {
    expect(proxy(new NextRequest("http://localhost/api/chat/sync")).status).toBe(401);
    expect(proxy(new NextRequest("http://localhost/api/files/abc")).status).toBe(401);
    const page = proxy(new NextRequest("http://localhost/analytics?country=GB"));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toBe("http://localhost/login?next=%2Fanalytics%3Fcountry%3DGB");
  });

  it("doesn't treat look-alike paths as public", () => {
    expect(proxy(new NextRequest("http://localhost/api/cronjobs")).status).toBe(401);
    expect(proxy(new NextRequest("http://localhost/loginx")).status).toBe(307);
  });
});

describe("sign-in and notification redirects stay on this site", () => {
  it.each([
    ["/\t/evil.example", "/home"], // a tab is dropped by URL parsers, leaving //evil.example
    ["/\n/evil.example", "/home"],
    ["/\\evil.example", "/home"], // a backslash is read as a slash
    ["/a\\b", "/home"],
    ["/\u0000/evil.example", "/home"],
    ["/%09/evil.example", "/%09/evil.example"], // encoded: stays a path on this site
    ["/calendar?view=agenda&date=2026-10-28", "/calendar?view=agenda&date=2026-10-28"],
  ])("%j -> %s", async (input, expected) => {
    const { safeNextPath } = await import("@/lib/safe-redirect");
    expect(safeNextPath(input)).toBe(expected);
    expect(new URL(safeNextPath(input), "https://admin.corenovait.com.au").origin).toBe("https://admin.corenovait.com.au");
  });
});
