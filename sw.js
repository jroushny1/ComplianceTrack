/**
 * sw.js — Service worker with versioned cache
 * Cache-first for JS/CSS/fonts, network-first for HTML
 */

const CACHE_NAME = 'compliancetrack-v3';

const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/app.js',
  './js/db.js',
  './js/ui.js',
  './js/candidates.js',
  './js/clients.js',
  './js/jobs.js',
  './js/pipeline.js',
  './js/import-export.js',
  './js/sw-register.js',
  './lib/papaparse.min.js',
  './lib/Sortable.min.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// Domains that should never be cached
const BYPASS_DOMAINS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

// Install — cache all static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate — clean old cache versions
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key.startsWith('compliancetrack-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch — cache-first for static, network-first for HTML
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Let font requests go to network (cached by browser HTTP cache)
  if (BYPASS_DOMAINS.some(d => url.hostname.includes(d))) return;

  // Navigation requests (HTML) — network-first
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Cache the fresh HTML
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // All other requests (JS, CSS, images) — cache-first
  event.respondWith(
    caches.match(event.request)
      .then((cached) => {
        if (cached) return cached;

        return fetch(event.request).then((response) => {
          // Only cache same-origin GET requests
          if (event.request.url.startsWith(self.location.origin)) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
      .catch(() => {
        // Offline fallback for navigation
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      })
  );
});
