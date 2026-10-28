/**
 * Production guard for sample data. The dev seed (npm run db:local / seed:dev)
 * creates clearly fake people on the reserved example.test domain; none of it
 * may ever reach the live portal. Three layers:
 *
 * 1. the seed refuses to run in production, against a database that isn't on
 *    this computer, or when SITE_URL points at a real site (assertSampleSeedAllowed);
 * 2. it does nothing if the database already has people;
 * 3. in production the app refuses to create any account on a sample domain
 *    (isSampleEmail), whatever creates it (invite, first-admin script).
 */
const SAMPLE_DOMAINS = ["example.test", "example.com", "example.org", "example.net"];

export function isSampleEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  return SAMPLE_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`)) || domain.endsWith(".test") || domain.endsWith(".invalid") || domain === "localhost";
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** Throws (with the reason) unless sample data may be loaded here. */
export function assertSampleSeedAllowed(env: Record<string, string | undefined> = process.env): void {
  if (env.NODE_ENV === "production") throw new Error("Sample data never loads in production (NODE_ENV=production).");
  const dbHost = /^mysql:\/\/(?:[^@/]*@)?(\[[^\]]+\]|[^:/]+)/.exec(env.DATABASE_URL ?? "")?.[1]?.toLowerCase();
  if (!dbHost || !LOCAL_HOSTS.has(dbHost)) throw new Error("Sample data only loads into a database on this computer (127.0.0.1 or localhost).");
  let site: URL | null = null;
  try {
    site = env.SITE_URL ? new URL(env.SITE_URL) : null;
  } catch {
    site = null;
  }
  if (site && !LOCAL_HOSTS.has(site.hostname.toLowerCase())) throw new Error(`Sample data never loads when SITE_URL points at a real site (${site.hostname}).`);
}

/** In production, no account may be created on a sample domain. */
export function assertRealEmailInProduction(email: string, env: Record<string, string | undefined> = process.env): void {
  if (env.NODE_ENV === "production" && isSampleEmail(email)) throw new Error("That looks like a sample or test address. Use the person's real email.");
}
