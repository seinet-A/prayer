const CACHE = 'prayer-v3';
const BIBLE = 'bible-v1';
const FILES = ['./', './index.html', './style.css', './app.js', './ui.js', './store.js', './speech.js', './commands.js', './bible.js', './bible-ui.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './bible/index.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== BIBLE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const isBible = url.pathname.includes('/bible/') && !url.pathname.endsWith('index.json');
  if (isBible) {
    // 본문: 캐시 우선. 내용이 안 바뀌므로 한 번 받으면 그대로.
    e.respondWith(caches.open(BIBLE).then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const r = await fetch(e.request);
      if (r.ok) c.put(e.request, r.clone());
      return r;
    }));
    return;
  }
  // 껍데기: 네트워크 우선, 실패하면 캐시. 성공 응답만 저장.
  e.respondWith(
    fetch(e.request)
      .then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return r; })
      .catch(() => caches.match(e.request))
  );
});
