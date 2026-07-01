/**
 * KelasKA Service Worker
 * Provides offline caching for the LMS application.
 * Cached: dashboard, course catalog, static assets.
 * Network-first: API routes (live data), AI streaming endpoints.
 */

const CACHE_NAME = 'kelaska-v1';
const OFFLINE_PAGE = '/offline';

// Assets to pre-cache on install
const PRECACHE_ASSETS = [
  '/',
  '/dashboard',
  '/courses',
  '/offline',
  '/favicon.ico',
];

// URL patterns that should NEVER be cached (always fetch from network)
const NETWORK_ONLY_PATTERNS = [
  '/api/generate',
  '/api/chat',
  '/api/stream',
  '/api/quiz-grade',
  '/api/auth',
];

// Cache-first patterns (static/infrequent assets)
const CACHE_FIRST_PATTERNS = [
  '/fonts/',
  '/_next/static/',
  '/images/',
  '/.next/',
];

/**
 * INSTALL — pre-cache core assets
 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Pre-caching offline assets');
      return cache.addAll(PRECACHE_ASSETS.map((url) => new Request(url, { cache: 'reload' })));
    }).then(() => self.skipWaiting())
  );
});

/**
 * ACTIVATE — clean up old caches
 */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

/**
 * FETCH — strategy routing
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignore non-GET and cross-origin requests
  if (request.method !== 'GET') return;
  if (url.origin !== location.origin) return;

  // NETWORK-ONLY: AI, auth, streaming
  const isNetworkOnly = NETWORK_ONLY_PATTERNS.some((p) => url.pathname.startsWith(p));
  if (isNetworkOnly) return;

  // CACHE-FIRST: static assets, fonts, Next.js chunks
  const isCacheFirst = CACHE_FIRST_PATTERNS.some((p) => url.pathname.startsWith(p));
  if (isCacheFirst) {
    event.respondWith(
      caches.match(request).then((cached) => {
        return cached || fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // STALE-WHILE-REVALIDATE for navigation pages (dashboard, courses)
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      const fetchPromise = fetch(request)
        .then((response) => {
          if (response.ok) {
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => {
          // If network fails and nothing cached, show offline page
          if (request.mode === 'navigate') {
            return cache.match(OFFLINE_PAGE);
          }
          return cached;
        });

      return cached || fetchPromise;
    })
  );
});
