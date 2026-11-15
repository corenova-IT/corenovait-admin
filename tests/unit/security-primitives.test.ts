import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "@/lib/auth/crypto";
import { base32Decode, base32Encode, codeOffset, hotp, normaliseRecoveryCode, generateRecoveryCodes, otpauthUri, totpAt, verifyTotp, whyWrongSetupCode } from "@/lib/auth/totp";
import { sniffType } from "@/lib/file-types";

// RFC 6238 appendix B uses the ASCII secret "12345678901234567890" (SHA-1)
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

describe("TOTP", () => {
  it("matches the RFC 6238 test vectors (last 6 digits)", () => {
    expect(totpAt(RFC_SECRET, 59_000)).toBe("287082");
    expect(totpAt(RFC_SECRET, 1_111_111_109_000)).toBe("081804");
    expect(totpAt(RFC_SECRET, 1_234_567_890_000)).toBe("005924");
    expect(totpAt(RFC_SECRET, 20_000_000_000_000)).toBe("353130");
  });

  it("matches RFC 4226 HOTP vectors", () => {
    const key = Buffer.from("12345678901234567890");
    expect([0, 1, 2, 9].map((c) => hotp(key, c))).toEqual(["755224", "287082", "359152", "520489"]);
  });

  it("explains a wrong setup code: how far off it was, or that it matches nothing", () => {
    // 15 seconds into a 30-second step, so "70 s ago" is two steps back and "100 s ahead" is three steps on
    const now = 1_700_000_025_000;
    // right two steps ago (a minute and a bit): too far to accept, close enough to explain
    expect(codeOffset(RFC_SECRET, totpAt(RFC_SECRET, now - 70_000), now)).toBe(-2);
    expect(codeOffset(RFC_SECRET, totpAt(RFC_SECRET, now + 100_000), now)).toBe(3);
    expect(codeOffset(RFC_SECRET, totpAt(RFC_SECRET, now), now)).toBe(0);
    // another secret's code, a code from far away, and things that aren't codes match nothing
    const other = base32Encode(Buffer.from("another-secret-key-20"));
    expect(codeOffset(RFC_SECRET, totpAt(other, now), now)).toBeNull();
    expect(codeOffset(RFC_SECRET, totpAt(RFC_SECRET, now - 40 * 30_000), now)).toBeNull();
    expect(codeOffset(RFC_SECRET, "12345", now)).toBeNull();
    // it only explains: a code two steps off is still refused
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, now - 70_000), { now })).toBeNull();
    expect(whyWrongSetupCode(-2)).toMatch(/^That code didn't work\..*about 60 seconds ago.*behind.*automatic date and time/);
    expect(whyWrongSetupCode(3)).toMatch(/about 90 seconds from now.*ahead/);
    expect(whyWrongSetupCode(null)).toMatch(/^That code didn't work\..*doesn't match this QR code.*Delete every CoreNovaIT entry/);
  });

  it("accepts one step of clock drift, refuses two, and refuses replays", () => {
    const now = 1_700_000_000_000;
    const prev = totpAt(RFC_SECRET, now - 30_000);
    const step = verifyTotp(RFC_SECRET, prev, { now });
    expect(step).not.toBeNull();
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, now - 60_000), { now })).toBeNull();
    expect(verifyTotp(RFC_SECRET, prev, { now, lastStep: step })).toBeNull();
    expect(verifyTotp(RFC_SECRET, "12345", { now })).toBeNull();
  });

  it("base32 round-trips and builds a standard otpauth URI", () => {
    const b = randomBytes(20);
    expect(base32Decode(base32Encode(b)).equals(b)).toBe(true);
    expect(otpauthUri("JBSWY3DPEHPK3PXP", "a@b.test")).toBe(
      "otpauth://totp/CoreNovaIT%20Portal%3Aa%40b.test?secret=JBSWY3DPEHPK3PXP&issuer=CoreNovaIT+Portal&algorithm=SHA1&digits=6&period=30"
    );
  });

  it("recovery codes are 10 distinct XXXX-XXXX codes, typed loosely", () => {
    const codes = generateRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    expect(codes.every((c) => /^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/.test(c))).toBe(true);
    expect(normaliseRecoveryCode(" 7kq4 m2xp ")).toBe("7KQ4-M2XP");
    expect(normaliseRecoveryCode("0000-0000")).toBeNull(); // 0 isn't in the alphabet
  });
});

describe("secret encryption (AES-256-GCM)", () => {
  const key = randomBytes(32);

  it("round-trips and uses a fresh IV each time", () => {
    const a = encryptSecret("JBSWY3DPEHPK3PXP", key);
    const b = encryptSecret("JBSWY3DPEHPK3PXP", key);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, key)).toBe("JBSWY3DPEHPK3PXP");
  });

  it("detects tampering and the wrong key", () => {
    const box = encryptSecret("JBSWY3DPEHPK3PXP", key);
    const parts = box.split(".");
    parts[3] = Buffer.from("tampered!").toString("base64url");
    expect(() => decryptSecret(parts.join("."), key)).toThrow();
    expect(() => decryptSecret(box, randomBytes(32))).toThrow();
  });
});

describe("upload allow-list", () => {
  it("decides the type from the file's bytes, not its name", () => {
    expect(sniffType(Buffer.from("%PDF-1.7 ..."))?.mime).toBe("application/pdf");
    expect(sniffType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))?.mime).toBe("image/png");
    expect(sniffType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))?.mime).toBe("image/jpeg");
    expect(sniffType(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]))?.mime).toBe("image/webp");
    expect(sniffType(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
    expect(sniffType(Buffer.from("<html><script>"))).toBeNull();
    expect(sniffType(Buffer.from("MZ\x90\x00"))).toBeNull(); // .exe
  });
});
