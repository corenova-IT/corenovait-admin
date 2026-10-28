/** Only allow same-site relative paths as post-login destinations (no open redirects). */
export function safeNextPath(next: string | null | undefined, fallback = "/home"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return fallback;
  // URL parsers drop tabs and newlines and read "\" as "/", so "/<tab>/evil.com" or "/\evil.com" would leave the site
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return fallback;
  // and whatever is left must still resolve to this site
  const base = "https://portal.invalid";
  try {
    if (new URL(next, base).origin !== base) return fallback;
  } catch {
    return fallback;
  }
  return next;
}
