import { afterAll, beforeAll, expect, it } from "vitest";
import { STRONG_PASSWORD, setupTestDatabase } from "./db";

let t: Awaited<ReturnType<typeof setupTestDatabase>>;
beforeAll(async () => {
  t = await setupTestDatabase();
});
afterAll(() => t?.cleanup());

it("the first-admin seed creates one admin who must set up two-factor, and only once", async () => {
  const auth = await import("@/lib/dal/auth");
  await expect(auth.bootstrapFirstAdmin({ email: "boss@example.test", password: "weak", fullName: "Boss" })).rejects.toThrow(/at least 12/);
  await auth.bootstrapFirstAdmin({ email: "Boss@Example.test", password: STRONG_PASSWORD, fullName: "Boss" });
  const [u] = await t.db.select().from(t.schema.users);
  expect(u).toMatchObject({ email: "boss@example.test", presetId: "admin", status: "active", mfaRequired: true });
  const r = await auth.signInWithPassword("boss@example.test", STRONG_PASSWORD, {});
  expect(r.ok && r.next).toBe("mfa_setup");
  await expect(auth.bootstrapFirstAdmin({ email: "second@example.test", password: STRONG_PASSWORD, fullName: "Two" })).rejects.toThrow(/already exists/);
});
