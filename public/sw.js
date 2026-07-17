self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') {
    return;
  }

  const requestUrl = new URL(request.url);
  const sameOrigin = requestUrl.origin === self.location.origin;
  const destination = request.destination || '';

  if (!sameOrigin || destination === 'image' || destination === 'font' || destination === 'audio' || destination === 'video') {
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (!response || response.type !== 'basic' || response.status !== 200 || request.mode !== 'same-origin') {
          return response;
        }

        const responseClone = response.clone();
        caches.open('smart-career-vai-cache').then((cache) => {
          cache.put(request, responseClone);
        });

        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || Response.error()))
  );
});