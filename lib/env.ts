/**
 * Server configuration, read on first use (not at import) so pages that never
 * touch the database, like the /dev design preview, render without a .env.local.
 * Nothing here is sent to the browser: there are no NEXT_PUBLIC_ variables.
 */

function required(name: string, hint: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is not set. ${hint}`);
  return v;
}

export function databaseUrl(): string {
  const url = required("DATABASE_URL", "Add it to .env.local (see .env.example).");
  if (!/^mysql:\/\//.test(url)) throw new Error("DATABASE_URL must start with mysql://");
  return url;
}

/** 32-byte key (base64) that encrypts two-factor secrets at rest. */
export function encryptionKey(): Buffer {
  const raw = required("APP_ENCRYPTION_KEY", "Generate one with: npm run gen:key");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("APP_ENCRYPTION_KEY must be 32 bytes, base64-encoded (npm run gen:key).");
  return key;
}

export const SESSION_IDLE_MINUTES = Math.max(5, Number(process.env.SESSION_IDLE_MINUTES ?? 30) || 30);
/** A session ends after this long even if it stays active. */
export const SESSION_MAX_HOURS = Math.min(72, Math.max(1, Number(process.env.SESSION_MAX_HOURS ?? 12) || 12));

export function siteUrl(): string {
  return (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function mailConfig(): { apiKey: string; from: string } | null {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.MAIL_FROM?.trim();
  return apiKey && from ? { apiKey, from } : null;
}

export const isProduction = () => process.env.NODE_ENV === "production";

/**
 * Shared secret for the scheduler endpoint (/api/cron/notifications), which
 * a Hostinger cron job calls every few minutes. Null (endpoint disabled) when
 * unset or shorter than 32 characters.
 */
export function cronSecret(): string | null {
  const v = process.env.CRON_SECRET?.trim();
  return v && v.length >= 32 ? v : null;
}
