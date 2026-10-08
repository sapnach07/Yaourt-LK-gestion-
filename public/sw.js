const CACHE_NAME = 'yaourt-gestion-v1';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon.svg',
];

// Installation : mise en cache initiale et skipWaiting
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// Activation : suppression des anciens caches et prise de contrôle immédiate
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

// Interception des requêtes
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Traiter uniquement les requêtes GET
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // Ignorer les requêtes externes (conserver strict même origine)
  if (url.origin !== self.location.origin) {
    return;
  }

  // 1. Pour les navigations (mode navigate) :
  // Réseau d'abord, mise en cache sous /index.html, et repli sur le cache en cas d'échec
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put('/index.html', responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // 2. Pour les autres requêtes GET de même origine :
  // Répondre depuis le cache si disponible et mettre à jour le cache en arrière-plan
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.match(request).then((cachedResponse) => {
        const fetchPromise = fetch(request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              cache.put(request, networkResponse.clone());
            }
            return networkResponse;
          })
          .catch(() => cachedResponse);

        return cachedResponse || fetchPromise;
      });
    })
  );
});
