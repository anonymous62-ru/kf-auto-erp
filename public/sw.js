// Service worker minimal : rend l'app-shell disponible hors-ligne.
// Strategie :
// - navigation (chargement de page) : reseau d'abord, cache en secours,
//   et sinon la page offline.html generique.
// - assets statiques (_next/static, icones...) : cache d'abord, reseau en secours,
//   avec mise en cache dynamique de tout ce qui est recupere avec succes.
// Les DONNEES (clients, documents...) ne passent JAMAIS par ce cache : elles
// vivent dans IndexedDB (voir lib/offline/db.ts), qui est la vraie source de
// verite hors-ligne pour le metier.
const CACHE_NAME = 'kf-auto-shell-v1';
const PRECACHE_URLS = ['/offline.html', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // les mutations passent par Supabase + la file locale, jamais par le SW
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // laisse passer Supabase/API tierces telles quelles

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/offline.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request)
          .then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            }
            return response;
          })
          .catch(() => cached)
    )
  );
});
