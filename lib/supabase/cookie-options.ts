/**
 * Auth cookies: httpOnly so page scripts can never read the session, Secure in
 * production, SameSite=Lax. All auth happens on the server, so the browser
 * never needs to read them.
 */
export const authCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};
