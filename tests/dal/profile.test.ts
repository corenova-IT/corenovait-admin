import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STRONG_PASSWORD, actorFor, createPerson, sessionFor, setupTestDatabase } from "./db";

/** Your own profile: details, picture, password and recovery codes. Never anyone else's. */
let t: Awaited<ReturnType<typeof setupTestDatabase>>;
let profile: typeof import("@/lib/dal/profile");
let ids: { ann: string; ben: string };
let annSecret: string;
const as = (id: string) => actorFor(t, id);
const userRow = async (id: string) => (await t.db.select().from(t.schema.users).where(eq(t.schema.users.id, id)))[0];
const auditFor = async (id: string) => t.db.select().from(t.schema.auditLog).where(eq(t.schema.auditLog.entityId, id));

/** A real photo-like JPEG, 1200 × 800, carrying EXIF (camera and GPS-style tags) that must not survive. */
const photo = () =>
  sharp({ create: { width: 1200, height: 800, channels: 3, background: { r: 200, g: 40, b: 40 } } })
    .jpeg()
    .withExif({ IFD0: { Make: "SecretCam", Model: "X1", ImageDescription: "taken at home" } })
    .toBuffer();

beforeAll(async () => {
  t = await setupTestDatabase();
  profile = await import("@/lib/dal/profile");
  const ann = await createPerson(t, { email: "ann@example.test", totp: true });
  ids = { ann: ann.id, ben: (await createPerson(t, { email: "ben@example.test" })).id };
  annSecret = ann.totpSecret!;
});
afterAll(() => t?.cleanup());

describe("profile details", () => {
  it("changes only your own name, job title and phone, and audits what changed", async () => {
    await profile.updateMyProfile(await as(ids.ann), { fullName: "Ann Example", jobTitle: "Designer", phone: "+61 400 000 000" });
    expect(await userRow(ids.ann)).toMatchObject({ fullName: "Ann Example", jobTitle: "Designer", phone: "+61 400 000 000", email: "ann@example.test", presetId: "staff" });
    expect((await userRow(ids.ben)).fullName).toBe("ben");
    const [log] = (await auditFor(ids.ann)).filter((l) => l.summary === "Updated own profile");
    expect(log.before).toEqual({ fullName: "ann", jobTitle: "", phone: "" });
    expect(log.after).toEqual({ fullName: "Ann Example", jobTitle: "Designer", phone: "+61 400 000 000" });
  });

  it("refuses an empty name and a phone with letters, with a plain message", async () => {
    const ann = await as(ids.ann);
    await expect(profile.updateMyProfile(ann, { fullName: "  " })).rejects.toThrow(/Enter your name/);
    await expect(profile.updateMyProfile(ann, { fullName: "Ann", phone: "call me" })).rejects.toThrow(/digits/);
  });
});

describe("profile picture", () => {
  it("is cropped to a 512 px square WebP with no metadata, stored outside the web root, and audited without the picture", async () => {
    await profile.setMyAvatar(await as(ids.ann), await photo());
    const u = await userRow(ids.ann);
    expect(u.avatarKey).toMatch(/^[a-f0-9]{32}\.webp$/);
    const file = path.join(process.env.UPLOAD_DIR!, "avatars", u.avatarKey!);
    expect(path.relative(process.cwd(), file).startsWith("public")).toBe(false);
    const bytes = await profile.readAvatar(await as(ids.ben), ids.ann); // a colleague can see it
    const meta = await sharp(bytes!).metadata();
    expect(meta).toMatchObject({ format: "webp", width: 512, height: 512 });
    expect(meta.exif).toBeUndefined();
    expect(bytes!.includes(Buffer.from("SecretCam"))).toBe(false);
    const [log] = (await auditFor(ids.ann)).filter((l) => /profile picture/.test(l.summary ?? ""));
    expect(log).toMatchObject({ summary: "Added a profile picture", before: null, after: null });
  });

  it("refuses a file that isn't a JPG, PNG or WebP (whatever it's called) and anything over 2 MB, with a plain message", async () => {
    const ann = await as(ids.ann);
    const before = (await userRow(ids.ann)).avatarKey;
    await expect(profile.setMyAvatar(ann, Buffer.from("%PDF-1.7\nnot a picture"))).rejects.toThrow("Upload a JPG, PNG or WebP picture.");
    await expect(profile.setMyAvatar(ann, Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).rejects.toThrow("Upload a JPG, PNG or WebP picture.");
    await expect(profile.setMyAvatar(ann, Buffer.from("just text, renamed to photo.png"))).rejects.toThrow("Upload a JPG, PNG or WebP picture.");
    await expect(profile.setMyAvatar(ann, Buffer.alloc(2 * 1024 * 1024 + 1, 0xff))).rejects.toThrow("That picture is over 2 MB. Choose a smaller one.");
    // a PNG header with nothing after it
    await expect(profile.setMyAvatar(ann, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]))).rejects.toThrow(/couldn't be read/);
    expect((await userRow(ids.ann)).avatarKey).toBe(before);
  });

  it("a new picture replaces the old file; Remove goes back to initials and deletes it", async () => {
    const ann = await as(ids.ann);
    const dir = path.join(process.env.UPLOAD_DIR!, "avatars");
    const first = (await userRow(ids.ann)).avatarKey!;
    await profile.setMyAvatar(ann, await sharp({ create: { width: 300, height: 300, channels: 4, background: "#fff" } }).png().toBuffer());
    const second = (await userRow(ids.ann)).avatarKey!;
    expect(second).not.toBe(first);
    expect(existsSync(path.join(dir, first))).toBe(false);
    await profile.removeMyAvatar(ann);
    expect((await userRow(ids.ann)).avatarKey).toBeNull();
    expect(readdirSync(dir)).not.toContain(second);
    expect(await profile.readAvatar(ann, ids.ann)).toBeNull();
    expect((await profile.getMyProfile(await as(ids.ann))).avatarUrl).toBeNull();
  });
});

describe("password", () => {
  it("needs your current password, follows the strong-password rules, and signs out your other sessions only", async () => {
    const here = await sessionFor(t, ids.ben);
    const elsewhere = await sessionFor(t, ids.ben);
    const { resolveSession } = await import("@/lib/dal/auth");
    const s = await resolveSession(here);
    if (s.status !== "ok") throw new Error("expected a session");
    const hash = (await userRow(ids.ben)).passwordHash;

    await expect(profile.changeMyPassword(s.actor, "Not-The-Password-1", "Brand-New-Lantern-77")).rejects.toThrow("Your current password isn't right.");
    await expect(profile.changeMyPassword(s.actor, "", "Brand-New-Lantern-77")).rejects.toThrow("Your current password isn't right.");
    await expect(profile.changeMyPassword(s.actor, STRONG_PASSWORD, "short")).rejects.toThrow(/12/);
    await expect(profile.changeMyPassword(s.actor, STRONG_PASSWORD, STRONG_PASSWORD)).rejects.toThrow(/different/);
    expect((await userRow(ids.ben)).passwordHash).toBe(hash);

    await profile.changeMyPassword(s.actor, STRONG_PASSWORD, "Brand-New-Lantern-77");
    expect((await userRow(ids.ben)).passwordHash).not.toBe(hash);
    expect((await resolveSession(here)).status).toBe("ok");
    expect((await resolveSession(elsewhere)).status).toBe("ended");
    expect((await auditFor(ids.ben)).some((l) => l.action === "password_changed")).toBe(true);
  });
});

describe("recovery codes", () => {
  it("new codes need your password and a current code from your app", async () => {
    const { totpAt } = await import("@/lib/auth/totp");
    const ann = await actorFor(t, ids.ann, { mfaVerified: true });
    await expect(profile.regenerateMyRecoveryCodes(ann, "wrong", totpAt(annSecret, Date.now()))).rejects.toThrow(/password isn't right/);
    await expect(profile.regenerateMyRecoveryCodes(ann, STRONG_PASSWORD, "000000")).rejects.toThrow(/code didn't work/);
    const codes = await profile.regenerateMyRecoveryCodes(ann, STRONG_PASSWORD, totpAt(annSecret, Date.now()));
    expect(codes).toHaveLength(10);
    expect((await profile.getMyProfile(ann)).recoveryCodesLeft).toBe(10);
  });
});
