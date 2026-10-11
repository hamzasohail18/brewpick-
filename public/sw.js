// BrewPick service worker: offline support for places and screens already opened (Section 4, 10).
// Hand-written and dependency-free so it works with Turbopack builds. Strategy:
//   - /_next/static/* (content-hashed): cache first
//   - page navigations and public GET /api/*: network first (6 s timeout), else the cached copy,
//     else the /offline page
//   - signed-in and admin areas are never cached
// Bump VERSION when this file's logic changes; old caches are dropped on activate.

const VERSION = "v1";
const STATIC = `bp-static-${VERSION}`;
const PAGES = `bp-pages-${VERSION}`;
const DATA = `bp-data-${VERSION}`;
const OFFLINE_URL = "/offline";
const NETWORK_TIMEOUT_MS = 6000;
const LIMITS = { [STATIC]: 250, [PAGES]: 40, [DATA]: 60 };

// Never cached: per-person or staff screens, auth flows, writes.
const PRIVATE = [/^\/admin/, /^\/capture/, /^\/owner/, /^\/login/, /^\/auth\//, /^\/api\/me/, /^\/api\/auth/, /^\/uploads\//];
// Public JSON worth keeping for offline reading.
const PUBLIC_API = [/^\/api\/places/, /^\/api\/pick/, /^\/api\/payment-methods/, /^\/api\/deals(\/|$)/];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PAGES)
      .then((c) => c.addAll([OFFLINE_URL]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("bp-") && !Object.keys(LIMITS).includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trim(cacheName) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  const extra = keys.length - LIMITS[cacheName];
  for (let i = 0; i < extra; i++) await cache.delete(keys[i]); // oldest first (insertion order)
}

async function put(cacheName, request, response) {
  const cache = await caches.open(cacheName);
  await cache.delete(request); // re-insert so it counts as newest
  await cache.put(request, response);
  await trim(cacheName);
}

// Next.js marks dynamic pages no-store for HTTP caches. This cache is the app's own offline copy, limited
// to public paths above, so the header doesn't apply here.
const cacheable = (res) => res && res.ok && res.type === "basic";

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

async function networkFirst(request, cacheName, fallback) {
  const network = fetch(request);
  try {
    const res = await withTimeout(network, NETWORK_TIMEOUT_MS);
    if (cacheable(res)) await put(cacheName, request, res.clone());
    return res;
  } catch {
    const cached = (await caches.match(request, { cacheName })) || (fallback && (await fallback()));
    if (cached) return cached;
    return network; // still waiting on a slow network: better late than an error
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request, { cacheName: STATIC });
  if (cached) return cached;
  const res = await fetch(request);
  if (cacheable(res)) await put(STATIC, request, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // map tiles etc.: browser HTTP cache
  if (PRIVATE.some((re) => re.test(url.pathname))) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(
      networkFirst(request, PAGES, async () => {
        // Same page with other filters, else the offline page.
        const cache = await caches.open(PAGES);
        return (await cache.match(request, { ignoreSearch: true })) || (await cache.match(OFFLINE_URL));
      }),
    );
    return;
  }
  if (PUBLIC_API.some((re) => re.test(url.pathname))) {
    event.respondWith(networkFirst(request, DATA));
  }
  // Everything else (RSC payloads, prefetches): straight to the network. When a client-side
  // navigation fails offline, Next.js falls back to a full page load, which the cache serves.
});

// The page that registered us lists what it already loaded before we controlled it, so the first
// visit works offline too.
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type !== "CACHE_URLS" || !Array.isArray(data.urls)) return;
  event.waitUntil(
    Promise.all(
      data.urls.slice(0, 100).map(async (u) => {
        try {
          const url = new URL(u, self.location.origin);
          if (url.origin !== self.location.origin || PRIVATE.some((re) => re.test(url.pathname))) return;
          const isStatic = url.pathname.startsWith("/_next/static/");
          const cacheName = isStatic ? STATIC : PAGES;
          if (await caches.match(url.href, { cacheName })) return;
          const res = await fetch(url.href, { credentials: "same-origin" });
          if (cacheable(res)) await put(cacheName, url.href, res);
        } catch {
          /* offline or gone: skip */
        }
      }),
    ),
  );
});
