// Offline-first cache so the game runs installed on Mac, Android and Raspberry Pi without a network.
const CACHE = 'heat-stack-v2';
const ASSETS = ['./', 'index.html', 'styles.css', 'manifest.webmanifest', 'icon.svg',
  'src/main.js', 'src/engine.js', 'src/ai.js', 'src/renderers.js', 'src/shaders.js', 'src/audio.js', 'src/input.js', 'src/rival-worker.js', 'src/camera.js', 'src/street.js', 'src/world.js', 'src/world-shader.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  // Network first (fresh code during development), cache fallback (offline).
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});
