import { z } from "zod";

/**
 * Strong-password rule: at least 12 characters, and at least 3 of: lowercase,
 * uppercase, digit, symbol. Must not contain the email's name part.
 * (Also turn on "leaked password protection" in Supabase Auth settings.)
 */
export const PASSWORD_MIN = 12;

export function passwordProblems(password: string, email?: string): string[] {
  const problems: string[] = [];
  if (password.length < PASSWORD_MIN) problems.push(`Use at least ${PASSWORD_MIN} characters.`);
  if (password.length > 128) problems.push("Use 128 characters or fewer.");
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
  if (classes < 3) problems.push("Mix at least three of: lowercase, uppercase, numbers, symbols.");
  const local = email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 3 && password.toLowerCase().includes(local)) {
    problems.push("Don't include your email name in the password.");
  }
  if (/^(.)\1+$/.test(password)) problems.push("Don't repeat one character.");
  return problems;
}

export const newPasswordSchema = (email?: string) =>
  z
    .object({ password: z.string(), confirm: z.string() })
    .superRefine((v, ctx) => {
      for (const message of passwordProblems(v.password, email)) {
        ctx.addIssue({ code: "custom", path: ["password"], message });
      }
      if (v.password !== v.confirm) {
        ctx.addIssue({ code: "custom", path: ["confirm"], message: "The two passwords don't match." });
      }
    });
