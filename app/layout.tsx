import type { Metadata } from "next";
import { Inter, Manrope, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ServiceWorkerRegistrar } from "@/components/providers/service-worker-registrar";

// Body copy — tables, forms, descriptions.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

// Headings (h1-h3) — see app/globals.css's `@layer base` for the
// per-level weight (extrabold/bold/semibold).
const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Akribis — Gestion de pharmacie",
  description:
    "Akribis, le logiciel de gestion de stock, caisse et clients pensé pour les pharmacies marocaines. Fonctionne même hors ligne.",
  icons: {
    // No SVG entry: Chrome and Firefox prefer an SVG icon over every PNG
    // regardless of order, so leaving the old flat mark declared here would
    // have quietly kept it in the tab and hidden the supplied artwork.
    icon: [
      { url: "/favicon-96.png", type: "image/png", sizes: "96x96" },
      { url: "/favicon.png", type: "image/png", sizes: "920x920" },
      { url: "/favicon.ico", sizes: "any" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${inter.variable} ${manrope.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
