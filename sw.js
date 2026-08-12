/* ===== Doreen's Personal OS — Service Worker ===== */

const CACHE_NAME = 'doreen-os-v11';
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/icons/icon-180x180.png',
  '/icons/doreen-avatar.svg',
  '/icons/doreen-empty.svg',
  '/icons/doreen-full.svg'
];

// Install: precache core static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn('[SW] Precache failed:', err))
  );
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch:
//  - App shell (html/js/css/manifest): NETWORK-FIRST so code fixes reach the
//    installed PWA immediately instead of being stuck on a stale cached version.
//  - Immutable assets (icons/fonts/png/svg): CACHE-FIRST for fast offline loads.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  const path = url.pathname;
  const isManifest = /manifest\.webmanifest?$/.test(path);
  const isAppShell = isManifest
    || path === '/' || path.endsWith('/')
    || /\.(html|js|css)$/.test(path);
  const isImmutable = /\.(png|svg|ico|woff2?|ttf|otf)$/.test(path);

  if (isAppShell && !isImmutable) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request).then((c) => c || caches.match('/index.html')))
    );
  } else {
    event.respondWith(
      caches.match(request).then((cached) =>
        cached || fetch(request)
          .then((response) => {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            return response;
          })
          .catch(() => cached)
      )
    );
  }
});
