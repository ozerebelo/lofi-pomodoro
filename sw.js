// Service worker: permite instalar a app e abri-la mesmo sem rede
// (o temporizador funciona offline; a música precisa de internet).
// Estratégia "rede primeiro": quando há rede vês sempre a versão mais recente.

const CACHE = 'lofi-pomodoro-v1';
const SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/timer.js',
  './js/catalog.js',
  './js/youtube.js',
  './js/youtube-url.js',
  './js/notify.js',
  './js/ticker.js',
  './js/stats.js',
  './js/storage.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(request, { ignoreSearch: true }).then((cached) => cached ?? caches.match('./')),
      ),
  );
});

// Clicar numa notificação traz a app para a frente.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const client = clients.find((c) => c.url.startsWith(self.registration.scope));
      if (client) return client.focus();
      return self.clients.openWindow('./');
    }),
  );
});
