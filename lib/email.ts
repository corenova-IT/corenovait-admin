import "server-only";
import { isProduction, mailConfig, siteUrl } from "@/lib/env";

type Mail = { to: string; subject: string; text: string; html: string };

/**
 * Sends through Resend's HTTP API. In development without RESEND_API_KEY the
 * message is printed to the dev-server console instead, so invite and reset
 * links can be tested locally. In production a missing key is an error.
 */
export async function sendMail(mail: Mail): Promise<{ ok: true } | { ok: false }> {
  const cfg = mailConfig();
  if (!cfg) {
    if (isProduction()) {
      console.error("[mail] RESEND_API_KEY / MAIL_FROM not set; email not sent");
      return { ok: false };
    }
    console.info(`\n[mail:dev] To: ${mail.to}\nSubject: ${mail.subject}\n\n${mail.text}\n`);
    return { ok: true };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: cfg.from, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html }),
    });
    if (!res.ok) console.error(`[mail] Resend returned ${res.status}`);
    return res.ok ? { ok: true } : { ok: false };
  } catch {
    console.error("[mail] Resend request failed");
    return { ok: false };
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function layout(heading: string, body: string, cta: { href: string; label: string }, footer: string) {
  return `<!doctype html><html><body style="margin:0;background:#F5F1EA;font-family:Arial,sans-serif;color:#15171D">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:520px;background:#fff;border-radius:16px;padding:32px">
<tr><td><p style="margin:0 0 4px;font-size:13px;letter-spacing:.08em;color:#AF2524;font-weight:bold">CORENOVAIT PORTAL</p>
<h1 style="margin:0 0 16px;font-size:22px">${esc(heading)}</h1>
<p style="margin:0 0 24px;font-size:15px;line-height:1.6">${esc(body)}</p>
<a href="${esc(cta.href)}" style="display:inline-block;background:#AF2524;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:bold">${esc(cta.label)}</a>
<p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#5A5F6B">${esc(footer)}</p></td></tr></table>
</td></tr></table></body></html>`;
}

export function inviteEmail(to: string, name: string, token: string, invitedBy: string): Mail {
  const href = `${siteUrl()}/accept-invite?token=${encodeURIComponent(token)}`;
  const body = `${invitedBy} invited you to the CoreNovaIT portal. Choose a password to activate your account.`;
  const footer = "This link works once and expires in 7 days. If you weren't expecting it, ignore this email.";
  return {
    to,
    subject: "You're invited to the CoreNovaIT portal",
    text: `Hi ${name},\n\n${body}\n\n${href}\n\n${footer}`,
    html: layout(`Hi ${name}`, body, { href, label: "Accept invite" }, footer),
  };
}

export function resetEmail(to: string, token: string): Mail {
  const href = `${siteUrl()}/reset-password?token=${encodeURIComponent(token)}`;
  const body = "Someone asked to reset the password for this account. Choose a new one with the button below.";
  const footer = "This link works once and expires in 1 hour. If you didn't ask for it, ignore this email: your password stays the same.";
  return {
    to,
    subject: "Reset your CoreNovaIT portal password",
    text: `${body}\n\n${href}\n\n${footer}`,
    html: layout("Reset your password", body, { href, label: "Choose a new password" }, footer),
  };
}
