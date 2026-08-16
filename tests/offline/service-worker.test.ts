import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * public/sw.js is plain JavaScript loaded by the browser, not a module the
 * app imports, so it is executed here inside a stand-in
 * ServiceWorkerGlobalScope with a stand-in Cache API. That makes the
 * routing decisions testable: which requests are cached, which are
 * deliberately passed through, and what is served when the network fails.
 *
 * What this cannot prove is the browser actually registering and
 * intercepting — see the manual procedure in docs/offline-verification.md.
 */

type FakeResponse = {
  ok: boolean;
  redirected: boolean;
  tag: string;
  body?: string;
  clone: () => FakeResponse;
  json: () => Promise<unknown>;
};

function response(
  tag: string,
  init: { ok?: boolean; redirected?: boolean; body?: string } = {},
): FakeResponse {
  const res: FakeResponse = {
    ok: init.ok ?? true,
    redirected: init.redirected ?? false,
    tag,
    body: init.body,
    clone: () => res,
    json: async () => JSON.parse(res.body ?? "null"),
  };
  return res;
}

/**
 * The worker builds real Responses now, to persist its page index. A bare
 * object literal for `Response` would blow up on `new`.
 */
class FakeResponseCtor {
  ok = true;
  redirected = false;
  tag = "constructed";
  body: string;
  constructor(body: string) {
    this.body = body;
  }
  clone() {
    return this;
  }
  async json() {
    return JSON.parse(this.body);
  }
  static error() {
    return response("network-error", { ok: false });
  }
  static redirect(href: string) {
    return response(`redirect:${href}`, { redirected: true });
  }
}

const ORIGIN = "https://akribis.test";

const SW_SOURCE = readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8");

/**
 * Read from the worker rather than pinned here: VERSION is bumped whenever
 * a precached asset changes, and a test that hard-codes it would fail for
 * the wrong reason every time the icons are redrawn.
 */
const VERSION = SW_SOURCE.match(/const VERSION = "([^"]+)"/)![1];
const STATIC_CACHE = `akribis-static-${VERSION}`;
const PAGES_CACHE = `akribis-pages-${VERSION}`;

/**
 * Enough of the Cache API for the worker. Keys are resolved to absolute
 * URLs, as browsers do — otherwise `cache.add("/offline")` and
 * `caches.match("/offline")` would look like a miss here while matching
 * perfectly in a real service worker.
 */
function cacheKey(request: Request | string): string {
  return new URL(typeof request === "string" ? request : request.url, ORIGIN).href;
}

class FakeCache {
  store = new Map<string, FakeResponse>();
  async match(request: Request | string) {
    return this.store.get(cacheKey(request));
  }
  async put(request: Request | string, res: FakeResponse) {
    this.store.set(cacheKey(request), res);
  }
  async add(request: Request | string) {
    const url = typeof request === "string" ? request : request.url;
    this.store.set(cacheKey(request), response(`precached:${new URL(url, ORIGIN).pathname}`));
  }
  async delete(request: Request | string) {
    return this.store.delete(cacheKey(request));
  }
  async keys() {
    return [...this.store.keys()].map((url) => ({ url }) as Request);
  }
}

/**
 * jsdom resolves `new Request("/offline")` against the *document's* base
 * URL; a real service worker resolves it against its own scope. Injecting
 * this keeps the harness on the worker's side of that difference.
 */
class ScopedRequest {
  url: string;
  method = "GET";
  mode = "no-cors";
  headers = { get: () => null };
  constructor(input: string) {
    this.url = new URL(input, ORIGIN).href;
  }
}

type Listener = (event: unknown) => void;

function loadWorker() {
  const caches = new Map<string, FakeCache>();
  const listeners = new Map<string, Listener>();
  const fetchMock = vi.fn();

  const cacheStorage = {
    open: async (name: string) => {
      if (!caches.has(name)) caches.set(name, new FakeCache());
      return caches.get(name)!;
    },
    keys: async () => [...caches.keys()],
    delete: async (name: string) => caches.delete(name),
    match: async (request: Request | string) => {
      for (const cache of caches.values()) {
        const hit = await cache.match(request);
        if (hit) return hit;
      }
      return undefined;
    },
  };

  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    skipWaiting: vi.fn(async () => {}),
    clients: { claim: vi.fn(async () => {}) },
    caches: cacheStorage,
  };

  const run = new Function("self", "caches", "fetch", "Response", "Request", "URL", SW_SOURCE);
  run(self, cacheStorage, fetchMock, FakeResponseCtor, ScopedRequest, URL);

  return { self, caches, listeners, fetchMock, cacheStorage };
}

type Worker = ReturnType<typeof loadWorker>;

function makeRequest(url: string, init: { mode?: string; headers?: Record<string, string>; method?: string } = {}) {
  return {
    url,
    method: init.method ?? "GET",
    mode: init.mode ?? "no-cors",
    headers: { get: (name: string) => init.headers?.[name] ?? null },
  } as unknown as Request;
}

/** Dispatches a fetch event and returns what the worker responded with, if anything. */
async function dispatchFetch(worker: Worker, request: Request) {
  const waits: Promise<unknown>[] = [];
  // Held on an object rather than a `let`: TypeScript cannot see the
  // assignment happening inside respondWith and would narrow a plain
  // variable to `null` for the rest of the function.
  const captured: { value: Promise<FakeResponse> | null } = { value: null };
  const event = {
    request,
    respondWith: (value: Promise<FakeResponse>) => {
      captured.value = value;
    },
    waitUntil: (value: Promise<unknown>) => waits.push(value),
  };

  worker.listeners.get("fetch")!(event);
  const result = captured.value ? await captured.value : null;
  await Promise.all(waits.map((p) => p.catch(() => {})));
  return { result, handled: captured.value !== null };
}

async function install(worker: Worker) {
  const waits: Promise<unknown>[] = [];
  worker.listeners.get("install")!({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
  await Promise.all(waits);
}

let worker: Worker;

beforeEach(async () => {
  worker = loadWorker();
  await install(worker);
});

describe("what the worker keeps", () => {
  it("precaches the offline fallback at install, before anything can fail", async () => {
    const cache = await worker.cacheStorage.open(STATIC_CACHE);
    expect(await cache.match("/offline")).toBeTruthy();
  });

  it("caches a page document on a successful visit", async () => {
    worker.fetchMock.mockResolvedValue(response("fresh-stock-page"));
    const request = makeRequest(`${ORIGIN}/dashboard/stock`, { mode: "navigate" });

    const { result } = await dispatchFetch(worker, request);

    expect(result!.tag).toBe("fresh-stock-page");
    const pages = await worker.cacheStorage.open(PAGES_CACHE);
    expect(await pages.match(request)).toBeTruthy();
  });

  it("serves the cached document first and revalidates behind it", async () => {
    const pages = await worker.cacheStorage.open(PAGES_CACHE);
    const request = makeRequest(`${ORIGIN}/dashboard/stock`, { mode: "navigate" });
    await pages.put(request, response("cached-stock-page"));
    worker.fetchMock.mockResolvedValue(response("fresh-stock-page"));

    const { result } = await dispatchFetch(worker, request);

    // Stale-while-revalidate: the old copy paints immediately...
    expect(result!.tag).toBe("cached-stock-page");
    // ...and the new one replaces it for next time.
    expect((await pages.match(request))!.tag).toBe("fresh-stock-page");
  });
});

describe("what happens with no network", () => {
  it("serves a previously visited page instead of the browser error page", async () => {
    const pages = await worker.cacheStorage.open(PAGES_CACHE);
    const request = makeRequest(`${ORIGIN}/dashboard/pos`, { mode: "navigate" });
    await pages.put(request, response("cached-pos-page"));
    worker.fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const { result } = await dispatchFetch(worker, request);

    expect(result!.tag).toBe("cached-pos-page");
  });

  it("redirects to the offline page for a route never visited online", async () => {
    worker.fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const request = makeRequest(`${ORIGIN}/commandes`, { mode: "navigate" });

    const { result } = await dispatchFetch(worker, request);

    // A redirect, not the fallback's body: serving /offline's HTML under
    // /commandes made Next hydrate a document that disagreed with the
    // router and throw "a client-side exception has occurred" — seen in a
    // real browser before this was changed.
    expect(result!.tag).toBe("redirect:https://akribis.test/offline");
  });

  it("serves the offline page itself from cache rather than redirecting to it", async () => {
    worker.fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const request = makeRequest(`${ORIGIN}/offline`, { mode: "navigate" });

    const { result } = await dispatchFetch(worker, request);

    // Redirecting /offline to /offline would loop forever.
    expect(result!.tag).toBe("precached:/offline");
  });

  it("keeps a cached page after a failed revalidation", async () => {
    const pages = await worker.cacheStorage.open(PAGES_CACHE);
    const request = makeRequest(`${ORIGIN}/dashboard/stock`, { mode: "navigate" });
    await pages.put(request, response("cached-stock-page"));
    worker.fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await dispatchFetch(worker, request);

    // A network failure must never be read as "this page is gone".
    expect(await pages.match(request)).toBeTruthy();
  });

  it("serves hashed build output from cache", async () => {
    const request = makeRequest(`${ORIGIN}/_next/static/chunks/main-abc123.js`);
    worker.fetchMock.mockResolvedValue(response("chunk"));
    await dispatchFetch(worker, request);

    worker.fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const { result } = await dispatchFetch(worker, request);

    expect(result!.tag).toBe("chunk");
    expect(worker.fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("what the worker deliberately refuses to cache", () => {
  it("passes RSC payload requests straight through", async () => {
    const { handled } = await dispatchFetch(
      worker,
      makeRequest(`${ORIGIN}/dashboard/stock?_rsc=1a2b3c`, { mode: "navigate" }),
    );

    // Not handled: the payload varies by router headers the Cache API does
    // not key on, and a failed RSC fetch makes Next do a full page load,
    // which this worker *can* answer from the page cache.
    expect(handled).toBe(false);
  });

  it("passes auth routes straight through", async () => {
    const { handled } = await dispatchFetch(
      worker,
      makeRequest(`${ORIGIN}/auth/callback`, { mode: "navigate" }),
    );

    expect(handled).toBe(false);
  });

  it("ignores non-GET requests, so server actions always hit the server", async () => {
    const { handled } = await dispatchFetch(
      worker,
      makeRequest(`${ORIGIN}/dashboard/stock`, { mode: "navigate", method: "POST" }),
    );

    expect(handled).toBe(false);
  });

  it("ignores other origins", async () => {
    const { handled } = await dispatchFetch(
      worker,
      makeRequest("https://supabase.example/rest/v1/products", { mode: "navigate" }),
    );

    expect(handled).toBe(false);
  });

  it("drops a cached page when revalidation redirects, e.g. the session ended", async () => {
    const pages = await worker.cacheStorage.open(PAGES_CACHE);
    const request = makeRequest(`${ORIGIN}/dashboard/stock`, { mode: "navigate" });
    await pages.put(request, response("cached-stock-page"));
    worker.fetchMock.mockResolvedValue(response("login-page", { redirected: true }));

    await dispatchFetch(worker, request);

    // Otherwise the next offline visit would show a dashboard to someone
    // the server has already signed out.
    expect(await pages.match(request)).toBeUndefined();
  });
});

describe("signing out", () => {
  it("empties the page cache on request, leaving static assets alone", async () => {
    const pages = await worker.cacheStorage.open(PAGES_CACHE);
    await pages.put(makeRequest(`${ORIGIN}/dashboard`, { mode: "navigate" }), response("doc"));

    const waits: Promise<unknown>[] = [];
    worker.listeners.get("message")!({
      data: { type: "akribis:clear-pages" },
      waitUntil: (p: Promise<unknown>) => waits.push(p),
    });
    await Promise.all(waits);

    expect(await worker.cacheStorage.keys()).not.toContain(PAGES_CACHE);
    // The shell's JS and the offline fallback survive — they are not
    // account data, and re-downloading them defeats the point.
    expect(await worker.cacheStorage.keys()).toContain(STATIC_CACHE);
  });
});

describe("warming the cache from client-side navigation", () => {
  /**
   * The gap this closes, found in a browser: clicking through the sidebar
   * produces only an RSC payload, never a document request, so nothing was
   * stored. A page read a minute earlier was still unavailable offline.
   */
  const rsc = (path: string) =>
    makeRequest(`${ORIGIN}${path}?_rsc=a1b2c3`, { mode: "cors", headers: { RSC: "1" } });

  it("fetches and stores the document behind an RSC request", async () => {
    worker.fetchMock.mockResolvedValue(response("commandes-document"));

    const { handled } = await dispatchFetch(worker, rsc("/commandes"));

    // The payload itself is still passed straight through.
    expect(handled).toBe(false);
    const pages = await worker.cacheStorage.open(PAGES_CACHE);
    // Stored under the bare path — `_rsc` is a per-navigation cache-buster,
    // and the navigation handler will look the page up without it.
    expect((await pages.match(`${ORIGIN}/commandes`))!.tag).toBe("commandes-document");
    expect(worker.fetchMock).toHaveBeenCalledWith(
      `${ORIGIN}/commandes`,
      expect.objectContaining({ headers: { Accept: "text/html" } }),
    );
  });

  it("serves that warmed page offline, without it ever being reloaded", async () => {
    worker.fetchMock.mockResolvedValue(response("commandes-document"));
    await dispatchFetch(worker, rsc("/commandes"));

    worker.fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const { result } = await dispatchFetch(
      worker,
      makeRequest(`${ORIGIN}/commandes`, { mode: "navigate" }),
    );

    expect(result!.tag).toBe("commandes-document");
  });

  it("does not re-warm a page it fetched moments ago", async () => {
    worker.fetchMock.mockResolvedValue(response("doc"));
    await dispatchFetch(worker, rsc("/ventes"));
    expect(worker.fetchMock).toHaveBeenCalledTimes(1);

    await dispatchFetch(worker, rsc("/ventes"));

    // Warming on every navigation would double the requests on a slow
    // counter connection for no benefit.
    expect(worker.fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not store a warm response that redirected", async () => {
    worker.fetchMock.mockResolvedValue(response("login", { redirected: true }));

    await dispatchFetch(worker, rsc("/commandes"));

    const pages = await worker.cacheStorage.open(PAGES_CACHE);
    // The session ended; caching the login page under /commandes would show
    // the wrong screen on the next offline visit.
    expect(await pages.match(`${ORIGIN}/commandes`)).toBeUndefined();
  });

  it("stays quiet when the warm fetch fails", async () => {
    worker.fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const { handled } = await dispatchFetch(worker, rsc("/commandes"));

    expect(handled).toBe(false);
    const pages = await worker.cacheStorage.open(PAGES_CACHE);
    expect(await pages.match(`${ORIGIN}/commandes`)).toBeUndefined();
  });
});

describe("the ceiling on stored pages", () => {
  async function warm(path: string, tag = path) {
    worker.fetchMock.mockResolvedValue(response(tag));
    await dispatchFetch(
      worker,
      makeRequest(`${ORIGIN}${path}?_rsc=x`, { mode: "cors", headers: { RSC: "1" } }),
    );
  }

  it("keeps at most 50 documents", async () => {
    for (let i = 0; i < 60; i += 1) await warm(`/commandes/${i}`);

    const pages = await worker.cacheStorage.open(PAGES_CACHE);
    const stored = (await pages.keys()).filter((r) => !r.url.includes("__akribis_page_index__"));
    // Every visited route is warmed, detail pages included, so without a
    // ceiling the cache grows all day on a till.
    expect(stored).toHaveLength(50);
  });

  it("evicts the least recently used, not the newest", async () => {
    for (let i = 0; i < 60; i += 1) await warm(`/commandes/${i}`);

    const pages = await worker.cacheStorage.open(PAGES_CACHE);
    expect(await pages.match(`${ORIGIN}/commandes/0`)).toBeUndefined();
    expect(await pages.match(`${ORIGIN}/commandes/9`)).toBeUndefined();
    expect(await pages.match(`${ORIGIN}/commandes/59`)).toBeTruthy();
  });

  it("re-reading a page saves it from eviction", async () => {
    await warm("/commandes/0");
    for (let i = 1; i < 45; i += 1) await warm(`/commandes/${i}`);

    // Opening it again marks it as recently used...
    worker.fetchMock.mockResolvedValue(response("fresh"));
    await dispatchFetch(worker, makeRequest(`${ORIGIN}/commandes/0`, { mode: "navigate" }));

    // ...so the pages that push past the cap take the older ones instead.
    for (let i = 45; i < 60; i += 1) await warm(`/commandes/${i}`);

    const pages = await worker.cacheStorage.open(PAGES_CACHE);
    expect(await pages.match(`${ORIGIN}/commandes/0`)).toBeTruthy();
    expect(await pages.match(`${ORIGIN}/commandes/1`)).toBeUndefined();
  });
});

describe("several routes prefetched at once", () => {
  /**
   * Next prefetches every `<Link>` in view, so warms fire in parallel.
   * Each one read the index, appended to it and wrote it back — a lost
   * update. Seen in a browser: three pages in the cache, two in the index.
   * An unlisted page is never evicted and never looks fresh, so the LRU
   * ceiling quietly stops applying.
   */
  async function readIndex() {
    const pages = await worker.cacheStorage.open(PAGES_CACHE);
    const stored = await pages.match("/__akribis_page_index__");
    return stored ? ((await stored.json()) as Array<{ url: string }>) : [];
  }

  it("lists every page it cached, not just the last writer's", async () => {
    worker.fetchMock.mockImplementation(async (url: string) => response(`doc:${url}`));

    await Promise.all(
      ["/commandes", "/ventes", "/factures", "/rappels", "/clients"].map((path) =>
        dispatchFetch(
          worker,
          makeRequest(`${ORIGIN}${path}?_rsc=x`, { mode: "cors", headers: { RSC: "1" } }),
        ),
      ),
    );

    const pages = await worker.cacheStorage.open(PAGES_CACHE);
    const cached = (await pages.keys())
      .map((r) => new URL(r.url).pathname)
      .filter((p) => p !== "/__akribis_page_index__")
      .sort();
    const listed = (await readIndex()).map((e) => new URL(e.url).pathname).sort();

    expect(cached).toEqual(["/clients", "/commandes", "/factures", "/rappels", "/ventes"]);
    // The invariant: anything in the cache is in the index, or the ceiling
    // can never evict it.
    expect(listed).toEqual(cached);
  });

  it("still honours the ceiling when the warms arrive in parallel", async () => {
    worker.fetchMock.mockImplementation(async (url: string) => response(`doc:${url}`));

    await Promise.all(
      Array.from({ length: 60 }, (_, i) =>
        dispatchFetch(
          worker,
          makeRequest(`${ORIGIN}/commandes/${i}?_rsc=x`, { mode: "cors", headers: { RSC: "1" } }),
        ),
      ),
    );

    const pages = await worker.cacheStorage.open(PAGES_CACHE);
    const cached = (await pages.keys()).filter(
      (r) => !r.url.includes("__akribis_page_index__"),
    );
    expect(cached).toHaveLength(50);
    expect(await readIndex()).toHaveLength(50);
  });
});
