import { NextResponse, type NextRequest } from "next/server";

/**
 * Runs before every page. Only a quick cookie-presence check lives here (as
 * the Next.js docs recommend): visitors without a session cookie go to /login.
 * Whether the session is still valid, and what the person may see, is decided
 * by the database through lib/auth/session.ts and lib/dal.
 */
const PUBLIC_PATHS = ["/login", "/forgot-password", "/reset-password", "/accept-invite", "/auth/signout"];
const COOKIE = process.env.NODE_ENV === "production" ? "__Host-cn_session" : "cn_session";

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
  const isDevPreview = process.env.NODE_ENV !== "production" && pathname.startsWith("/dev");
  if (isPublic || isDevPreview || request.cookies.has(COOKIE)) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" || pathname.startsWith("/api/") ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|jpg|svg|webp|ico)$).*)"],
};
