import { afterAll, beforeAll, expect, it } from "vitest";
import { STRONG_PASSWORD, actorFor, createPerson, setupTestDatabase } from "./db";

/** In production the app refuses to create accounts on sample domains, through every route that creates one. */
let t: Awaited<ReturnType<typeof setupTestDatabase>>;
const env = process.env as Record<string, string | undefined>;
const before = env.NODE_ENV;

beforeAll(async () => {
  t = await setupTestDatabase();
});
afterAll(async () => {
  env.NODE_ENV = before;
  await t?.cleanup();
});

it("the first-admin setup refuses a sample address in production", async () => {
  const auth = await import("@/lib/dal/auth");
  env.NODE_ENV = "production";
  await expect(auth.bootstrapFirstAdmin({ email: "admin.one@example.test", password: STRONG_PASSWORD, fullName: "Sample" })).rejects.toThrow(/sample or test address/);
  env.NODE_ENV = before;
});

it("inviting a sample address is refused in production", async () => {
  const admin = await createPerson(t, { email: "boss@corenovait.com.au", preset: "admin", totp: true });
  const team = await import("@/lib/dal/team");
  const actor = await actorFor(t, admin.id);
  env.NODE_ENV = "production";
  await expect(team.inviteUser(actor, { email: "web.dev@example.test", fullName: "Casey Demo", jobTitle: "", presetId: "staff" })).rejects.toThrow(/sample or test address/);
  env.NODE_ENV = before;
  // fine outside production (local testing)
  await expect(team.inviteUser(actor, { email: "web.dev@example.test", fullName: "Casey Demo", jobTitle: "", presetId: "staff" })).resolves.toMatchObject({ email: "web.dev@example.test" });
});
