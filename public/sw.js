// ── Shopkeeper PWA Service Worker ─────────────────────────────────────────────
// Strategy:
//   • Navigation (HTML): network-first → cached shell → offline.html
//   • App assets (JS/CSS/images): stale-while-revalidate (cache on first fetch)
//   • External / Firebase: skip (handled by Firebase SDK offline layer)
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_NAME  = 'shopkeeper-v2';
const OFFLINE_URL = '/offline.html';

// These are the only URLs we know at install time.
// All hashed JS/CSS chunks get cached progressively via the fetch handler.
const PRECACHE_URLS = [
  '/',
  '/offline.html',
  '/manifest.json',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
];

// ── Install: precache shell assets ────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // addAll fails atomically — if one URL 404s the whole install fails.
      // Use individual puts so a missing icon never blocks the SW.
      Promise.allSettled(
        PRECACHE_URLS.map((url) =>
          fetch(url, { cache: 'reload' })
            .then((res) => { if (res.ok) cache.put(url, res); })
            .catch(() => {})
        )
      )
    ).then(() => self.skipWaiting())
  );
});

// ── Activate: purge stale caches ──────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) =>
        Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
      )
      .then(() => self.clients.claim())
  );
});

// ── Fetch: serve from cache / update cache ────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only intercept GET requests from our own origin.
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // ── Navigation (page loads) ─────────────────────────────────────────────────
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          // Cache a fresh copy of the shell on every successful navigate
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(request, clone));
          }
          return res;
        })
        .catch(async () => {
          // Network failed — try the exact page, then the SPA root, then offline.html
          const cached =
            (await caches.match(request)) ||
            (await caches.match('/')) ||
            (await caches.match(OFFLINE_URL));
          return cached || new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
        })
    );
    return;
  }

  // ── Static assets (JS/CSS/fonts/images) ────────────────────────────────────
  // Stale-while-revalidate: serve from cache instantly, refresh in background.
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);

      const networkFetch = fetch(request)
        .then((res) => {
          if (res.ok) cache.put(request, res.clone());
          return res;
        })
        .catch(() => null);

      // Return cached immediately; update cache in background.
      if (cached) {
        event.waitUntil(networkFetch);
        return cached;
      }

      // Nothing cached yet — wait for network (first visit).
      const fresh = await networkFetch;
      if (fresh) return fresh;

      // Total failure — nothing we can do for non-navigation requests.
      return new Response('', { status: 503, statusText: 'Offline' });
    })
  );
});

// ── Message: manual cache clear ───────────────────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'CLEAR_CACHE') {
    caches.delete(CACHE_NAME).then(() => {
      event.ports?.[0]?.postMessage({ ok: true });
    });
  }
});
