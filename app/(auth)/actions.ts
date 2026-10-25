"use server";

import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { z } from "zod";
import {
  clearSessionCookie,
  errorMessage,
  getSessionState,
  readSessionToken,
  setSessionCookie,
} from "@/lib/auth/session";
import * as auth from "@/lib/dal/auth";
import { resetEmail, sendMail } from "@/lib/email";
import { newPasswordSchema } from "@/lib/password";
import { limiters } from "@/lib/rate-limit";
import { requestContext } from "@/lib/request";
import { safeNextPath } from "@/lib/safe-redirect";

export type FormState = { error?: string; fieldErrors?: Record<string, string>; ok?: string; recoveryCodes?: string[] };

const minutes = (sec: number) => Math.max(1, Math.ceil(sec / 60));
const GENERIC_SIGNIN_ERROR = "That email and password don't match an active account. Check them and try again.";
const tooMany = (m: number) => `Too many sign-in attempts. Wait ${m} minute${m === 1 ? "" : "s"} and try again.`;

function fieldErrorsFrom(issues: Array<{ path: PropertyKey[]; message: string }>) {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const k = String(i.path[0] ?? "password");
    out[k] = out[k] ? `${out[k]} ${i.message}` : i.message;
  }
  return out;
}

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
  const ctx = await requestContext();

  // in-memory limits catch floods (including unknown emails); the database lockout protects each account
  const accountKey = `${ctx.ip}|${email}`;
  const perAccount = limiters.loginPerAccount.hit(accountKey);
  const perIp = limiters.loginPerIp.hit(ctx.ip);
  if (!perAccount.ok) return { error: tooMany(minutes(perAccount.retryAfterSec)) };
  if (!perIp.ok) return { error: tooMany(minutes(perIp.retryAfterSec)) };

  const result = await auth.signInWithPassword(email, password, ctx);
  if (!result.ok) return { error: result.reason === "locked" ? tooMany(result.minutes) : GENERIC_SIGNIN_ERROR };

  limiters.loginPerAccount.reset(accountKey);
  await setSessionCookie(result.token);
  redirect(result.next === "home" ? next : `/mfa?next=${encodeURIComponent(next)}`);
}

// ---------- forgot password ----------
const emailSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254) });
const RESET_REPLY = "If that email belongs to an active account, a reset link is on its way. It expires in one hour.";

export async function requestPasswordReset(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = emailSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: { email: "Enter a valid email address." } };
  const { ip } = await requestContext();
  const rl = limiters.resetPerIp.hit(ip);
  if (!rl.ok) return { error: `Too many requests. Wait ${minutes(rl.retryAfterSec)} minutes and try again.` };

  // The reply is the same whether or not the email has an account.
  const link = await auth.createPasswordResetToken(parsed.data.email);
  if (link) await sendMail(resetEmail(link.email, link.token));
  return { ok: RESET_REPLY };
}

// ---------- choose a password from an email link ----------
const linkSchema = z.object({ token: z.string().min(20).max(200), password: z.string().max(200), confirm: z.string().max(200) });

export async function resetPassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = linkSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "That link isn't valid. Request a new one." };
  const who = await auth.peekLinkToken(parsed.data.token, "reset");
  if (!who) return { error: "That link has expired or was already used. Request a new one." };
  const pw = newPasswordSchema(who.email).safeParse(parsed.data);
  if (!pw.success) return { fieldErrors: fieldErrorsFrom(pw.error.issues) };
  try {
    await auth.completePasswordReset(parsed.data.token, parsed.data.password, await requestContext());
  } catch (e) {
    return { error: errorMessage(e, "We couldn't save your password. Request a new link and try again.") };
  }
  await clearSessionCookie();
  redirect("/login?reason=password_reset");
}

export async function acceptInvite(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = linkSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "That invite link isn't valid. Ask an admin to send a new one." };
  const who = await auth.peekLinkToken(parsed.data.token, "invite");
  if (!who) return { error: "That invite has expired or was already used. Ask an admin to send a new one." };
  const pw = newPasswordSchema(who.email).safeParse(parsed.data);
  if (!pw.success) return { fieldErrors: fieldErrorsFrom(pw.error.issues) };
  let next: string;
  try {
    const result = await auth.acceptInvite(parsed.data.token, parsed.data.password, await requestContext());
    await setSessionCookie(result.token);
    next = result.next === "home" ? "/home" : "/mfa?next=/home";
  } catch (e) {
    return { error: errorMessage(e, "We couldn't activate your account. Ask an admin to send a new invite.") };
  }
  redirect(next);
}

// ---------- two-factor ----------
export type EnrollResult = { qrCode: string; secret: string } | { error: string };

export async function startTotpEnrollment(): Promise<EnrollResult> {
  const token = await readSessionToken();
  if (!token) return { error: "Your session has ended. Sign in again." };
  try {
    const { secret, uri } = await auth.beginTotpSetup(token);
    const svg = await QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
    return { qrCode: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`, secret };
  } catch (e) {
    return { error: errorMessage(e, "We couldn't start two-factor setup. Refresh the page and try again.") };
  }
}

const codeSchema = z.object({ code: z.string().trim().max(20), next: z.string().max(500).optional() });

async function mfaLimit(): Promise<string | null> {
  const s = await getSessionState();
  const key = s.status === "ok" ? s.actor.userId : s.status === "ended" ? null : s.userId;
  if (!key) return "Your session has ended. Sign in again.";
  const rl = limiters.mfaPerUser.hit(key);
  return rl.ok ? null : `Too many attempts. Wait ${minutes(rl.retryAfterSec)} minutes and try again.`;
}

/** Finishes setup. Returns the recovery codes so the page can show them once. */
export async function confirmTotp(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = codeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success || !/^\d{6}$/.test(parsed.data.code)) return { fieldErrors: { code: "Enter the 6-digit code from your authenticator app." } };
  const limited = await mfaLimit();
  if (limited) return { error: limited };
  const token = await readSessionToken();
  try {
    const recoveryCodes = await auth.confirmTotpSetup(token ?? "", parsed.data.code);
    return { ok: "Two-factor is on.", recoveryCodes };
  } catch (e) {
    return { fieldErrors: { code: errorMessage(e) } };
  }
}

export async function verifySecondFactor(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = codeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success || !parsed.data.code) return { fieldErrors: { code: "Enter the 6-digit code from your authenticator app." } };
  const limited = await mfaLimit();
  if (limited) return { error: limited };
  const token = await readSessionToken();
  let destination = safeNextPath(parsed.data.next);
  try {
    const r = await auth.verifySecondFactor(token ?? "", parsed.data.code);
    if (r.usedRecoveryCode) destination = `/account?recovery_left=${r.recoveryCodesLeft}`;
  } catch (e) {
    return { fieldErrors: { code: errorMessage(e) } };
  }
  redirect(destination);
}
