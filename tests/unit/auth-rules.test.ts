import { describe, expect, it } from "vitest";
import { newPasswordSchema, passwordProblems } from "@/lib/password";
import { RateLimiter } from "@/lib/rate-limit";
import { safeNextPath } from "@/lib/safe-redirect";

describe("password rules", () => {
  it("accepts a long mixed password", () => {
    expect(passwordProblems("Copper-Lantern-42", "umair@corenovait.com.au")).toEqual([]);
  });
  it.each([
    ["short", "Ab1!"],
    ["one class", "aaaaaaaaaaaaaaaa"],
    ["two classes", "abcdefghijklmn12"],
  ])("rejects %s", (_label, pw) => expect(passwordProblems(pw).length).toBeGreaterThan(0));
  it("rejects a password containing the email name", () => {
    expect(passwordProblems("Umair-Secure-2026", "umair@corenovait.com.au")).toContain(
      "Don't include your email name in the password."
    );
  });
  it("requires matching confirmation", () => {
    const r = newPasswordSchema().safeParse({ password: "Copper-Lantern-42", confirm: "Copper-Lantern-43" });
    expect(r.success).toBe(false);
  });
});

describe("rate limiter", () => {
  it("blocks after the limit and resets after the window", () => {
    let t = 0;
    const rl = new RateLimiter(3, 1000, () => t);
    expect([rl.hit("k"), rl.hit("k"), rl.hit("k")].every((r) => r.ok)).toBe(true);
    const blocked = rl.hit("k");
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfterSec).toBe(1);
    t = 1001;
    expect(rl.hit("k").ok).toBe(true);
  });
  it("keeps keys separate", () => {
    const rl = new RateLimiter(1, 1000, () => 0);
    rl.hit("a");
    expect(rl.hit("b").ok).toBe(true);
  });
});

describe("safe redirects", () => {
  it.each([
    ["/team", "/team"],
    ["/audit?page=2", "/audit?page=2"],
    ["//evil.com", "/home"],
    ["https://evil.com", "/home"],
    ["/\\evil.com", "/home"],
    [null, "/home"],
    ["javascript:alert(1)", "/home"],
  ])("%j -> %s", (input, expected) => expect(safeNextPath(input)).toBe(expected));
});
