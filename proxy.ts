import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, newNonce } from "@/lib/csp";

/**
 * Runs before every page and API route.
 *
 * 1. A quick cookie-presence check, as the Next.js docs recommend: visitors
 *    without a session cookie go to /login (API calls get 401). Whether the
 *    session is valid, and what the person may see, is decided by the
 *    database through lib/auth/session.ts and lib/dal.
 * 2. The Content Security Policy with a fresh nonce for this request
 *    (Next.js puts the nonce on its own scripts), so injected scripts can't run.
 *
 * The scheduler (/api/cron/…) is called by a cron job without a cookie; it
 * checks its own secret token instead.
 */
export const PUBLIC_PATHS = ["/login", "/forgot-password", "/reset-password", "/accept-invite", "/auth/signout", "/api/cron"];
const COOKIE = process.env.NODE_ENV === "production" ? "__Host-cn_session" : "cn_session";

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
  const isDevPreview = process.env.NODE_ENV !== "production" && pathname.startsWith("/dev");

  if (!isPublic && !isDevPreview && !request.cookies.has(COOKIE)) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  const nonce = newNonce();
  const csp = buildCsp(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|jpg|svg|webp|ico)$).*)"],
};
