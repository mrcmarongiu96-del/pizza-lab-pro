// Service Worker di Pizza Lab Pro.
//
// Due regole d'oro:
//  1. tutto ciò che è di Google/Firebase passa DRITTO alla rete, senza intercetti,
//     altrimenti si rompono login e sincronizzazione in tempo reale;
//  2. tutto ciò che serve a far partire l'app sta in cache, così funziona anche
//     senza rete (font e icone compresi).

const CACHE = 'pizzalab-v13';

const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./fonts.css",
  "./app.js",
  "./manifest.json",
  "./icon.svg",
  "./icons/apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./fonts/Fraunces-6NU78FyLNQOQZAnv9bYEvDiIdE9Ea92uemAk_WBq8U_9v0c2Wa0KxC9TeP2Xz5c.woff2",
  "./fonts/Fraunces-6NU78FyLNQOQZAnv9bYEvDiIdE9Ea92uemAk_WBq8U_9v0c2Wa0KxCFTeP2Xz5fU8w.woff2",
  "./fonts/Inter-UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7W0Q5nw.woff2",
  "./fonts/Inter-UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa25L7W0Q5n-wU.woff2",
  "./fonts/Poppins-pxiByp8kv8JHgFVrLCz7Z1JlFd2JQEl8qw.woff2",
  "./fonts/Poppins-pxiByp8kv8JHgFVrLCz7Z1xlFd2JQEk.woff2",
  "./fonts/Poppins-pxiByp8kv8JHgFVrLDz8Z1JlFd2JQEl8qw.woff2",
  "./fonts/Poppins-pxiByp8kv8JHgFVrLDz8Z1xlFd2JQEk.woff2",
  "./fonts/Poppins-pxiByp8kv8JHgFVrLEj6Z1JlFd2JQEl8qw.woff2",
  "./fonts/Poppins-pxiByp8kv8JHgFVrLEj6Z1xlFd2JQEk.woff2",
  "./fonts/Poppins-pxiEyp8kv8JHgFVrJJfecnFHGPc.woff2",
  "./fonts/Poppins-pxiEyp8kv8JHgFVrJJnecnFHGPezSQ.woff2",
  "./fonts/SpaceGrotesk-V8mDoQDjQSkFtoMM3T6r8E7mPb94C_k3HqUtEw.woff2",
  "./fonts/SpaceGrotesk-V8mDoQDjQSkFtoMM3T6r8E7mPbF4C_k3HqU.woff2"
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // addAll fallisce tutto se un solo file manca: li aggiungo uno a uno
      Promise.all(ASSETS.map((url) => cache.add(url).catch((e) => console.warn('[SW] salto', url, e))))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Firebase, Google, CDN: mai toccati

  const isHTML = req.mode === 'navigate' || req.destination === 'document' ||
                 url.pathname.endsWith('.html') || url.pathname.endsWith('/');

  if (isHTML) {
    // Pagina: prima la rete per avere sempre l'ultima versione, cache come rete di sicurezza
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match('./index.html')))
    );
    return;
  }

  const isCode = url.pathname.endsWith('.css') || url.pathname.endsWith('.js');
  if (isCode) {
    // Codice: rispondo subito dalla cache e intanto scarico la versione nuova
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // Font, icone, manifest: non cambiano mai, prima la cache
  event.respondWith(caches.match(req).then((cached) => cached || fetch(req)));
});
