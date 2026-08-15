import type { MetadataRoute } from "next";

/**
 * Served at /manifest.webmanifest by Next's metadata route handler.
 *
 * `display: standalone` and the icon set make the app installable on a
 * counter tablet; installation isn't the goal here, but a manifest is
 * what lets the browser treat the app as one offline-capable unit rather
 * than a set of pages.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Akribis — Gestion de pharmacie",
    short_name: "Akribis",
    description:
      "Gestion de stock, caisse et clients pour les pharmacies marocaines. Fonctionne même hors ligne.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#ffffff",
    // emerald-500, the brand primary defined in app/globals.css.
    theme_color: "#10b981",
    lang: "fr",
    dir: "ltr",
    // All three carry the same supplied artwork as the tab icon: a home
    // screen showing a different mark from the browser tab reads as a
    // different app.
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
