"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { siteUrl } from "@/lib/env";
import { newPasswordSchema } from "@/lib/password";
import { limiters } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import { safeNextPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

export type FormState = { error?: string; fieldErrors?: Record<string, string>; ok?: string };

const minutes = (sec: number) => Math.max(1, Math.ceil(sec / 60));
const GENERIC_SIGNIN_ERROR = "That email and password don't match an active account. Check them and try again.";

// ---------- sign in ----------
const signInSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(128),
  next: z.string().max(500).optional(),
});

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signInSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Enter your email address and password." };
  const { email, password } = parsed.data;
  const next = safeNextPath(parsed.data.next);

  const ip = await clientIp();
  const accountKey = `${ip}|${email}`;
  const perAccount = limiters.loginPerAccount.hit(accountKey);
  const perIp = limiters.loginPerIp.hit(ip);
  if (!perAccount.ok || !perIp.ok) {
    const wait = !perAccount.ok ? perAccount.retryAfterSec : perIp.ok ? 60 : perIp.retryAfterSec;
    return { error: `Too many sign-in attempts. Wait ${minutes(wait)} minutes and try again.` };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: GENERIC_SIGNIN_ERROR };

  const session = await getSession();
  if (!session?.profile?.active) {
    await supabase.auth.signOut();
    return { error: GENERIC_SIGNIN_ERROR };
  }
  limiters.loginPerAccount.reset(accountKey);
  await supabase.rpc("log_event", { p_action: "sign_in", p_entity: "auth", p_entity_id: null, p_summary: "Signed in" });

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const needsSecondFactor = aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2";
  if (needsSecondFactor || session.profile.mfa_required) {
    redirect(`/mfa?next=${encodeURIComponent(next)}`);
  }
  redirect(next);
}

// ---------- forgot password ----------
const emailSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254) });

export async function requestPasswordReset(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = emailSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: { email: "Enter a valid email address." } };
  const ip = await clientIp();
  const rl = limiters.resetPerIp.hit(ip);
  if (!rl.ok) return { error: `Too many requests. Wait ${minutes(rl.retryAfterSec)} minutes and try again.` };

  const supabase = await createClient();
  // The result is ignored on purpose: the reply is the same whether or not the email has an account.
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${siteUrl()}/auth/confirm?next=/set-password`,
  });
  return { ok: "If that email belongs to an active account, a reset link is on its way. It expires in one hour." };
}

// ---------- set a new password (after an invite or reset link) ----------
export async function setNewPassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await getSession();
  if (!session?.profile) return { error: "Your link has expired. Request a new one from the sign-in page." };

  const parsed = newPasswordSchema(session.profile.email).safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "password");
      fieldErrors[key] = fieldErrors[key] ? `${fieldErrors[key]} ${issue.message}` : issue.message;
    }
    return { fieldErrors };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (/reauthentication|aal2/i.test(error.message)) {
      return { error: "For security, verify your two-factor code first, then set your password." };
    }
    if (/same|different/i.test(error.message)) return { fieldErrors: { password: "Choose a password you haven't used here before." } };
    if (/weak|pwned|leaked/i.test(error.message)) return { fieldErrors: { password: "That password has appeared in a data breach. Choose a different one." } };
    return { error: "We couldn't save your password. Try again, or request a new link." };
  }
  redirect(session.profile.mfa_required ? "/mfa?next=/home" : "/home");
}

// ---------- two-factor ----------
export type EnrollResult = { factorId: string; qrCode: string; secret: string } | { error: string };

export async function startTotpEnrollment(): Promise<EnrollResult> {
  const session = await getSession();
  if (!session?.profile?.active) return { error: "Your session has ended. Sign in again." };
  const supabase = await createClient();
  // clear any half-finished setup so stale QR codes stop working
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const f of factors?.all ?? []) {
    if (f.factor_type === "totp" && f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
  }
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `CoreNovaIT ${new Date().toISOString().slice(0, 10)}`,
  });
  if (error || !data) return { error: "We couldn't start two-factor setup. Refresh the page and try again." };
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

const codeSchema = z.object({
  factorId: z.string().uuid(),
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app."),
  next: z.string().max(500).optional(),
});

export async function verifyTotp(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = codeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: { code: "Enter the 6-digit code from your authenticator app." } };
  const session = await getSession();
  if (!session?.profile?.active) return { error: "Your session has ended. Sign in again." };
  const rl = limiters.mfaPerUser.hit(session.userId);
  if (!rl.ok) return { error: `Too many attempts. Wait ${minutes(rl.retryAfterSec)} minutes and try again.` };

  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: parsed.data.factorId, code: parsed.data.code });
  if (error) return { fieldErrors: { code: "That code didn't work. Check the time on your phone and use the newest code." } };
  limiters.mfaPerUser.reset(session.userId);
  redirect(safeNextPath(parsed.data.next));
}
