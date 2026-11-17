// Minimal offline support: app shell is cache-first, GET /api is network-first with a
// read-only cached fallback. API cache is wiped on logout so a shared device never
// serves one account's data to the next.
const SHELL = 'wb-shell-v1';
const DATA = 'wb-data-v1';
self.addEventListener('install', (event) => { event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(['/', '/assets/icon.png', '/assets/Caveat.ttf', '/manifest.webmanifest'])).then(() => self.skipWaiting())); });
self.addEventListener('activate', (event) => { event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => ![SHELL, DATA].includes(key)).map((key) => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('message', (event) => { if (event.data === 'clear-data') event.waitUntil(caches.delete(DATA)); });
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) {
    if (url.pathname.startsWith('/api/auth/')) return;
    event.respondWith(fetch(request).then((response) => { if (response.ok) { const copy = response.clone(); caches.open(DATA).then((cache) => cache.put(request, copy)); } return response; }).catch(() => caches.match(request).then((hit) => hit || new Response(JSON.stringify({ error: '当前离线，且没有缓存的数据' }), { status: 503, headers: { 'Content-Type': 'application/json' } }))));
    return;
  }
  if (request.mode === 'navigate') { event.respondWith(fetch(request).catch(() => caches.match('/'))); return; }
  event.respondWith(caches.match(request).then((hit) => hit || fetch(request).then((response) => { if (response.ok) { const copy = response.clone(); caches.open(SHELL).then((cache) => cache.put(request, copy)); } return response; })));
});
