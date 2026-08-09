import type { Metadata } from "next";
import { Inter, Manrope, Geist_Mono } from "next/font/google";
import "./globals.css";

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
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
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
      </body>
    </html>
  );
}
