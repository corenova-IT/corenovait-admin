import { hash, verify } from "@node-rs/argon2";

/**
 * argon2id with the OWASP-recommended cost (19 MiB, 2 passes, 1 lane).
 * The library's default algorithm is argon2id; the parameters are pinned here
 * so a library update can't quietly weaken them.
 */
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32 };

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(stored: string | null, password: string): Promise<boolean> {
  if (!stored) {
    // Unknown or invited account: still spend the same time, so response
    // timing doesn't reveal which emails exist.
    await verify(await dummyHash(), password).catch(() => false);
    return false;
  }
  return verify(stored, password).catch(() => false);
}

let dummy: Promise<string> | null = null;
const dummyHash = () => (dummy ??= hash("not-a-real-password", OPTIONS));
