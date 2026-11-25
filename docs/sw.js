// Keeps the whole app on the phone so it opens and works without internet.
// Change VERSION with every change to the app, otherwise phones keep the old one.
const VERSION = 'bs-1.1.0', SHELL = VERSION, ENGINE = 'bs-engine-7.0.0';
const FILES = ['./', 'index.html', 'app.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-180.png',
  ...['app', 'ui', 'store', 'engine', 'camera', 'detect', 'imageproc', 'pdf', 'docx', 'ocr', 'worker'].map(f => `js/${f}.js`)];
self.addEventListener('install', e => e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(k => Promise.all(k.filter(n => n.startsWith('bs-') && n !== SHELL && n !== ENGINE).map(n => caches.delete(n)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  const name = u.pathname.includes('/vendor/') ? ENGINE : SHELL;
  e.respondWith(caches.open(name).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const r = await fetch(e.request);
      if (r.ok && name === ENGINE) c.put(e.request, r.clone());
      return r;
    } catch (err) {
      if (e.request.mode === 'navigate') return (await c.match('index.html')) || Response.error();
      throw err;
    }
  }));
});
