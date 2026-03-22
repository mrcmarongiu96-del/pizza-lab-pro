const CACHE_NAME = 'pizzalab-v9';
const LOCAL_FILES = ['./', './index.html', './manifest.json', './icon.svg'];

self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(LOCAL_FILES)));
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    const isHTML = event.request.destination === 'document' || url.pathname.endsWith('.html') || url.pathname.endsWith('/');

    if (isHTML) {
        // Network-first per HTML: prova sempre la rete, fallback su cache
        event.respondWith(
            fetch(event.request).then(response => {
                const clone = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                return response;
            }).catch(() => caches.match(event.request).then(c => c || caches.match('./index.html')))
        );
    } else {
        // Cache-first per assets statici (icone, CDN)
        event.respondWith(
            caches.match(event.request).then(cached => {
                if (cached) return cached;
                return fetch(event.request).then(response => {
                    const isCDN = ['tailwindcss', 'googleapis', 'gstatic'].some(h => event.request.url.includes(h));
                    if (isCDN) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    }
                    return response;
                }).catch(() => caches.match('./index.html'));
            })
        );
    }
});
