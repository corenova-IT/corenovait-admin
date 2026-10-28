/**
 * The Content Security Policy, built per request with a fresh nonce (proxy.ts).
 * Scripts only run from this site or with the nonce Next.js adds to its own
 * inline scripts ('strict-dynamic' lets those load the page's chunks), so an
 * injected <script> can't run. Styles allow inline attributes because charts
 * and progress bars set sizes and colours with style="…"; that can't run code.
 */
export function buildCsp(nonce: string, dev = process.env.NODE_ENV !== "production"): string {
  return [
    "default-src 'self'",
    // dev also needs eval for React's error overlays
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    // the two-factor QR code is a data: SVG; chat image previews come from /api/files
    "img-src 'self' data: blob:",
    "font-src 'self'",
    // chat uses Server-Sent Events and polling on the same origin
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
