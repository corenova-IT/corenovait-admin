import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Hostinger's CDN compresses responses itself. When Next.js gzips them too, the CDN passes the
  // stream through and sometimes cuts it off at a 16 KiB boundary, so big script files arrive
  // incomplete and the page never starts. Sending plain responses lets the CDN do the compressing.
  compress: false,
  // native argon2 binary and the MySQL driver run as normal Node modules, not bundled
  serverExternalPackages: ["@node-rs/argon2", "mysql2", "sharp"],
  experimental: {
    // receipts and invoices up to UPLOAD_MAX_MB (10 MB) plus the form fields
    serverActions: { bodySizeLimit: "12mb" },
    proxyClientMaxBodySize: "12mb",
    // Hostinger's build machine reports dozens of CPUs but only lets the build start a few threads, so
    // "Collecting page data" crashed with "OS can't spawn worker thread". A small fixed number of
    // build workers keeps the build inside that limit.
    cpus: 2,
    workerThreads: false,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // the Content Security Policy is set per request (with a nonce) in proxy.ts
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          // private internal tool: never index
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default nextConfig;
