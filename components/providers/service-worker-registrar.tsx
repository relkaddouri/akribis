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
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

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
