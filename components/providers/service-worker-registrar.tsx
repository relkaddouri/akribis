"use client";

import { useEffect } from "react";

/**
 * Registers public/sw.js once the page is interactive.
 *
 * Development is deliberately excluded: the dev server serves modules that
 * change on every keystroke, and a worker caching them fights hot reload
 * in ways that look like phantom bugs. To exercise offline behaviour, run
 * a production build (`npm run build && npm start`).
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      // Not registering is not enough. A worker installed by an earlier
      // `npm start` on this same origin keeps controlling localhost:3000
      // for ever, and goes on serving cached documents and `_next/static`
      // chunks to the dev server. Dev rebuilds those chunks under new
      // names on every restart, so the cached document asks for a file
      // that no longer exists, the module factory comes back undefined,
      // and React fails with "Cannot read properties of undefined
      // (reading 'call')" on the first client component it meets — a
      // wholly misleading error that survives deleting .next.
      void (async () => {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const registration of registrations) await registration.unregister();
        if (registrations.length > 0 && "caches" in window) {
          await Promise.all((await caches.keys()).map((key) => caches.delete(key)));
          console.info(
            "[akribis] Service worker de production désenregistré et caches vidés — " +
              "il servait des fichiers périmés au serveur de développement. Rechargez la page.",
          );
        }
      })();
      return;
    }

    // After load, so registering never competes with the first paint for
    // bandwidth on a slow counter connection.
    const register = () => {
      void navigator.serviceWorker.register("/sw.js", { scope: "/" });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register);
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}

/**
 * Empties the cached page documents. Called on sign-out: those pages were
 * rendered for one account, and on a shared counter machine the next user
 * must not be served them from cache.
 */
export async function clearCachedPages(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration();
  registration?.active?.postMessage({ type: "akribis:clear-pages" });
}
