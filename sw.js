const CACHE_NAME = 'lk-manager-pwa-v2025-12-22-6';
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=2025-12-22-6',
  './app.js?v=2025-12-22-6',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.map((k) => (k === CACHE_NAME ? Promise.resolve() : caches.delete(k)))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (url.origin !== self.location.origin) return;

  // Network-first for HTML/CSS/JS so updates are reflected on normal refresh.
  const dest = req.destination;
  const isAppShell = dest === 'document' || dest === 'style' || dest === 'script';

  if (isAppShell) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Cache-first for other same-origin requests
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});
