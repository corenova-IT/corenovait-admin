import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authCookieOptions } from "@/lib/supabase/cookie-options";

/**
 * Runs before every page. Only quick, cookie-based checks live here (as the
 * Next.js docs recommend): refresh the Supabase session, enforce the idle
 * timeout, and bounce signed-out visitors to /login. The real authorization
 * happens in lib/auth/session.ts and, ultimately, in Postgres row-level security.
 */
const PUBLIC_PATHS = ["/login", "/forgot-password", "/auth/confirm", "/auth/signout"];
const IDLE_COOKIE = "cn_last_active";

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
  const isDevPreview = process.env.NODE_ENV !== "production" && pathname.startsWith("/dev");

  let response = NextResponse.next({ request });
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    // Not configured yet (.env.local missing): only the public and dev-preview pages can work.
    if (isPublic || isDevPreview) return response;
    return NextResponse.redirect(new URL("/login", request.url));
  }
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: authCookieOptions,
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          for (const { name, value } of toSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
        },
      },
    }
  );

  // Refreshes the access token if needed and verifies it.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  if (!signedIn) {
    if (isPublic || isDevPreview) return response;
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  // Idle timeout
  const idleMs = Math.max(5, Number(process.env.SESSION_IDLE_MINUTES ?? 30) || 30) * 60_000;
  const last = Number(request.cookies.get(IDLE_COOKIE)?.value ?? 0);
  const now = Date.now();
  if (last && now - last > idleMs && pathname !== "/auth/signout") {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/signout";
    url.search = "?reason=idle";
    return NextResponse.redirect(url);
  }
  response.cookies.set(IDLE_COOKIE, String(now), { ...authCookieOptions, maxAge: 60 * 60 * 24 });

  if (pathname === "/login" || pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/home";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|jpg|svg|webp|ico)$).*)"],
};
