// Service Worker di Pizza Lab Pro.
//
// Due regole d'oro:
//  1. tutto ciò che è di Google/Firebase passa DRITTO alla rete, senza intercetti,
//     altrimenti si rompono login e sincronizzazione in tempo reale;
//  2. tutto ciò che serve a far partire l'app sta in cache, così funziona anche
//     senza rete (font e icone compresi).

// Alza questo numero a ogni modifica di app.js o styles.css: senza il cambio
// di versione i dispositivi già installati continuano a usare la copia in
// cache. Al cambio, l'app si ricarica una volta da sola (vedi boot() in app.js).
const CACHE = 'pizzalab-pro-v14';

const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./fonts.css",
  "./app.js",
  "./domain.js",
  "./workflows.js",
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

self.addEventListener('install', event => {
  // A release is available offline only when its complete shell was downloaded.
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});
self.addEventListener('message', event => {
  if (event.data?.type === 'ACTIVATE_UPDATE') self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(k => (k.startsWith('pizzalab-pro-') || /^pizzalab-v\d+$/.test(k)) && k !== CACHE)
    .map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const req = event.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  // All shell files come from the same installed release, never mixed versions.
  event.respondWith(caches.open(CACHE).then(async cache => {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') return (await cache.match('./index.html')) || fetch(req);
    return fetch(req);
  }));
});
