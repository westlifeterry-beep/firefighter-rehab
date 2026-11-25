// 舊網址的離線快取：清除並解除註冊，讓舊 QR / 舊書籤轉到新網址
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k))))
  .then(() => self.registration.unregister()).then(() => self.clients.matchAll({ type: 'window' }))
  .then(cs => cs.forEach(c => { const u = new URL(c.url); c.navigate('https://fire-rehab.web.app/' + u.search + u.hash); }))); });
