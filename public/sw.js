/**
 * Akribis service worker — the navigation half of offline support.
 *
 * Dexie already keeps the *data* usable with no connectivity, but none of
 * it was reachable: every dashboard route is server-rendered, so a reload
 * or a page change with no network got the browser's error page. This
 * worker caches the rendered documents and the static build output, so a
 * page already visited online opens again offline, shell and all.
 *
 * Written by hand rather than via next-pwa/Serwist: the whole policy is
 * about twenty lines of routing, and a hand-written worker keeps the
 * build pipeline (Turbopack) untouched.
 */

/**
 * Bump this whenever a precached asset's *content* changes under an
 * unchanged filename — the icons and the offline page. Static assets are
 * served cache-first with no expiry, so without a new version an existing
 * install keeps handing out the old artwork for ever. `activate` deletes
 * every cache that doesn't carry the current version.
 *
 * v4: designer-supplied favicon replaces the flat mark in the tab.
 */
const VERSION = "v4";
const STATIC_CACHE = `akribis-static-${VERSION}`;
const PAGES_CACHE = `akribis-pages-${VERSION}`;
const OFFLINE_URL = "/offline";

/**
 * Fetched at install time so the fallback exists before the first
 * failure. Everything else is cached as it is actually used — the build
 * output is content-hashed, so there is no fixed list to precache.
 */
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/icon.svg",
  "/logo.png",
  "/favicon.png",
  "/favicon-96.png",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
];

async function precache(cache, url) {
  try {
    await cache.add(new Request(url, { cache: "reload" }));
    return true;
  } catch {
    // Best effort — the browser logs it; one missing icon must not abandon
    // the whole install and leave the app with no offline fallback at all.
    return false;
  }
}

/**
 * Caching the offline page's HTML is not enough: Next hydrates it, and
 * hydration needs its JavaScript. Those files are content-hashed, so their
 * names can't be listed ahead of time — they are read out of the page's own
 * markup instead, which keeps working across rebuilds with no build step.
 *
 * Skipping this produced a page that redirected correctly and then died
 * with "a client-side exception has occurred", because the chunks it needed
 * had never been downloaded. Found in a browser, not in a unit test.
 */
async function precacheOfflineAssets(cache) {
  try {
    const response = await cache.match(OFFLINE_URL);
    if (!response) return;
    const html = await response.clone().text();
    const assets = new Set(html.match(/\/_next\/static\/[^"'\\\s)]+/g) ?? []);
    await Promise.all([...assets].map((asset) => precache(cache, asset)));
  } catch {
    // The fallback still renders unstyled rather than not at all.
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      await Promise.all(PRECACHE_URLS.map((url) => precache(cache, url)));
      await precacheOfflineAssets(cache);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("akribis-") && !key.endsWith(`-${VERSION}`))
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

/** Content-hashed build output and images: safe to serve from cache forever. */
function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    /\.(?:js|css|woff2?|ttf|png|jpe?g|svg|ico|webp)$/i.test(url.pathname)
  );
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

/**
 * Stale-while-revalidate for whole pages: the cached document is returned
 * straight away and a fresh copy is fetched in the background for next
 * time. Offline, the background fetch simply fails and the cached copy is
 * all the user ever sees — which is the point.
 */
function staleWhileRevalidate(event) {
  const { request } = event;
  const url = new URL(request.url);

  return (async () => {
    const cache = await caches.open(PAGES_CACHE);
    const cached = await cache.match(request);

    const network = fetch(request)
      .then(async (response) => {
        // A redirect means the session ended or the route moved. Storing
        // the login page under a dashboard URL would show the wrong screen
        // on the next offline visit, so the stale copy is dropped instead.
        if (response.redirected || !response.ok) {
          await cache.delete(request);
          return response;
        }
        await cache.put(request, response.clone());
        return response;
      })
      .catch(async () => {
        if (cached) return cached;

        // Redirect rather than serve the fallback's body under the
        // requested URL. Returning /offline's HTML for, say, /commandes
        // leaves Next hydrating a document that disagrees with the router's
        // idea of the current route, which throws "a client-side exception
        // has occurred" instead of showing the message. Verified in-browser.
        const offlineUrl = new URL(OFFLINE_URL, self.location.origin);
        if (url.pathname === offlineUrl.pathname) {
          // Already asking for the fallback itself: serve it, or there is
          // nothing left to redirect to.
          const fallback = await caches.match(OFFLINE_URL);
          return fallback ?? Response.error();
        }
        return Response.redirect(offlineUrl.href, 302);
      });

    if (cached) {
      // Keeps the worker alive long enough to finish revalidating, even
      // though the response has already been handed to the page.
      event.waitUntil(network.catch(() => {}));
      return cached;
    }
    return network;
  })();
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Auth callbacks and API routes must always reach the server: a cached
  // answer to "who is signed in?" is worse than no answer.
  if (url.pathname.startsWith("/auth/") || url.pathname.startsWith("/api/")) return;

  /**
   * React Server Component payloads are deliberately NOT cached.
   *
   * Their content depends on `RSC` / `Next-Router-State-Tree` headers that
   * the Cache API does not key on, so a stored payload is regularly the
   * wrong one for the next navigation. Letting the request fail is also
   * more useful: Next reacts to a failed RSC fetch by falling back to a
   * full page load, which comes back through this worker as a navigation
   * and is served from the page cache below.
   */
  if (request.headers.get("RSC") === "1" || url.searchParams.has("_rsc")) return;

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(staleWhileRevalidate(event));
  }
});

/**
 * Signing out has to empty the page cache: those documents are rendered
 * for one account, and the next person at the counter must not be handed
 * the previous one's dashboard from cache.
 */
self.addEventListener("message", (event) => {
  if (event.data?.type !== "akribis:clear-pages") return;
  event.waitUntil(caches.delete(PAGES_CACHE));
});
