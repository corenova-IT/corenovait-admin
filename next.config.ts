import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // native argon2 binary and the MySQL driver run as normal Node modules, not bundled
  serverExternalPackages: ["@node-rs/argon2", "mysql2", "sharp"],
  experimental: {
    // receipts and invoices up to UPLOAD_MAX_MB (10 MB) plus the form fields
    serverActions: { bodySizeLimit: "12mb" },
    proxyClientMaxBodySize: "12mb",
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
