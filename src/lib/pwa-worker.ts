/** Only the public offline page is cached. Never intercept APIs, streams, RSC or media. */
export function pwaWorker(build: string): string {
  return `
const CACHE = ${JSON.stringify(`libretv-offline-${build}`)};
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.add('/offline.html')));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith('libretv-offline-') && key !== CACHE).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});
self.addEventListener('message', event => {
  if (event.data?.type === 'ACTIVATE_UPDATE') self.skipWaiting();
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || request.mode !== 'navigate' ||
      url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(fetch(request).catch(async () => {
    const cache = await caches.open(CACHE);
    return await cache.match('/offline.html') || new Response('网络不可用，请联网后重试', {
      status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }));
});
`;
}
