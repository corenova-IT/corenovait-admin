import type { Metadata } from "next";
import localFont from "next/font/local";
import { cookies } from "next/headers";
import { THEME_COOKIE, type Theme } from "@/lib/theme";
import "./globals.css";

// Self-hosted (latin subset, from @fontsource 5.3.0; licences in app/fonts) so builds never
// need to reach Google Fonts. Same weights and CSS variables as before.
const bricolage = localFont({
  src: [
    { path: "./fonts/bricolage-grotesque-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/bricolage-grotesque-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/bricolage-grotesque-latin-700-normal.woff2", weight: "700", style: "normal" },
    { path: "./fonts/bricolage-grotesque-latin-800-normal.woff2", weight: "800", style: "normal" },
  ],
  variable: "--font-bricolage",
  display: "swap",
});
const plexSans = localFont({
  src: [
    { path: "./fonts/ibm-plex-sans-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-sans-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-sans-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-plex-sans",
  display: "swap",
});
const plexMono = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-mono-latin-500-normal.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "CoreNovaIT Portal", template: "%s · CoreNovaIT Portal" },
  description: "CoreNovaIT internal admin and staff portal",
  robots: { index: false, follow: false },
  // made from the atom logo by npm run brand:icons
  icons: {
    icon: [
      { url: "/brand/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/brand/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The theme comes from a cookie so the server renders the right colours first time (no flash)
  const theme: Theme = (await cookies()).get(THEME_COOKIE)?.value === "light" ? "light" : "dark";
  return (
    <html lang="en-AU" data-theme={theme} className={`${bricolage.variable} ${plexSans.variable} ${plexMono.variable}`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
