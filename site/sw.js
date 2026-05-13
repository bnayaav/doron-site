/* Service Worker - דורון PWA */
const CACHE_VERSION = 'doron-v2';
const PRECACHE = [
  '/',
  '/styles.css',
  '/api.js',
  '/config.js',
  '/main.js',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  
  const url = new URL(req.url);
  
  // Don't cache API calls — always go to the network
  if (url.pathname.startsWith('/api/') || url.hostname.includes('workers.dev')) {
    return;
  }
  
  // Don't cache admin/editor pages or their assets — admin needs fresh content always
  if (url.pathname.startsWith('/admin') || url.pathname.startsWith('/editor') || url.pathname.startsWith('/dashboard') || url.pathname.startsWith('/login')) {
    return;
  }
  
  // Network-first for HTML navigation (so updates show up)
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(c => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then(r => r || caches.match('/')))
    );
    return;
  }
  
  // Cache-first for assets (CSS, JS, images, fonts)
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (!res || res.status !== 200 || res.type === 'opaque') return res;
        const copy = res.clone();
        caches.open(CACHE_VERSION).then(c => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => cached);
    })
  );
});
