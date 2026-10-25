import { z } from "zod";

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url("Set NEXT_PUBLIC_SUPABASE_URL in .env.local"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20, "Set NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local"),
});

let cached: z.infer<typeof publicSchema> | null = null;

/**
 * Public values: safe to ship to the browser. Parsed on first use (not at
 * import) so pages that never touch Supabase still render without them.
 */
export function publicEnv() {
  cached ??= publicSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
  return cached;
}

export const SESSION_IDLE_MINUTES = Math.max(5, Number(process.env.SESSION_IDLE_MINUTES ?? 30) || 30);

export function siteUrl(): string {
  return (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}
