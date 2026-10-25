import { createHmac, randomBytes, randomInt } from "node:crypto";

/**
 * TOTP (RFC 6238): 6 digits, 30-second steps, SHA-1, as every authenticator
 * app expects. Codes from one step either side are accepted for clock drift,
 * and a step that was already used is refused so a code can't be replayed.
 */
const STEP_SECONDS = 30;
const DIGITS = 6;
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error("Invalid base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 160-bit secret, base32 (what the QR code and manual key contain). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function hotp(key: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", key).update(msg).digest();
  const offset = mac[mac.length - 1] & 0xf;
  const bin = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 10 ** DIGITS).padStart(DIGITS, "0");
}

export const stepAt = (ms: number) => Math.floor(ms / 1000 / STEP_SECONDS);

export function totpAt(secret: string, ms: number): string {
  return hotp(base32Decode(secret), stepAt(ms));
}

/** Returns the matched step (store it as the new lastStep), or null. */
export function verifyTotp(
  secret: string,
  code: string,
  opts: { now?: number; lastStep?: number | null; window?: number } = {}
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const key = base32Decode(secret);
  const current = stepAt(opts.now ?? Date.now());
  const window = opts.window ?? 1;
  for (let d = -window; d <= window; d++) {
    const step = current + d;
    if (opts.lastStep != null && step <= opts.lastStep) continue;
    if (hotp(key, step) === code) return step;
  }
  return null;
}

export function otpauthUri(secret: string, account: string, issuer = "CoreNovaIT Portal"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${params}`;
}

/** Recovery codes look like 7KQ4-M2XP: 40 bits each, no ambiguous characters. */
const RC_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    let s = "";
    for (let i = 0; i < 8; i++) s += RC_ALPHABET[randomInt(RC_ALPHABET.length)];
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
}

export function normaliseRecoveryCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s-]/g, "");
  if (!/^[23456789A-HJKMNP-Z]{8}$/.test(s)) return null;
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}
