// Service Worker per Pizza Lab Pro — versione corretta
// Regola d'oro: il SW gestisce SOLO i file della nostra app.
// Tutto quello che è di Google/Firebase/CDN esterni passa DRITTO alla rete,
// altrimenti rompe il login e le chiamate in tempo reale.

const CACHE_NAME = 'pizzalab-v10';
const LOCAL_FILES = ['./', './index.html', './manifest.json', './icon.svg'];

// Installazione: precarica i file locali
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(LOCAL_FILES))
  );
  self.skipWaiting();
});

// Attivazione: pulisci le cache vecchie
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: comportamento diverso a seconda dell'origine
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // 1) Richieste NON GET (POST/PUT/DELETE): lasciamo passare senza toccare.
  //    Firebase Auth e Firestore usano spesso POST.
  if (req.method !== 'GET') {
    return;
  }

  // 2) Richieste cross-origin (googleapis, gstatic, tailwindcss, firebaseapp.com,
  //    accounts.google.com, ecc.): LASCIAMO PASSARE, zero cache, zero intercetti.
  //    Questa è la riga più importante del file: tenere il SW lontano da Firebase.
  if (url.origin !== self.location.origin) {
    return;
  }

  // 3) Da qui in giù: solo richieste sullo stesso dominio della nostra app.
  const isHTML =
    req.destination === 'document' ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('/');

  if (isHTML) {
    // HTML: prima la rete (per avere sempre l'ultima versione), cache come fallback offline.
    event.respondWith(
      fetch(req)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
          return response;
        })
        .catch(() =>
          caches.match(req).then(c => c || caches.match('./index.html'))
        )
    );
  } else {
    // Asset locali (icon.svg, manifest.json): prima la cache, poi la rete.
    // IMPORTANTE: se la rete fallisce NON rispondiamo con index.html — quello era il bug.
    event.respondWith(
      caches.match(req).then(cached => cached || fetch(req))
    );
  }
});
// Service Worker per Pizza Lab Pro — versione corretta
// Regola d'oro: il SW gestisce SOLO i file della nostra app.
// Tutto quello che è di Google/Firebase/CDN esterni passa DRITTO alla rete,
// altrimenti rompe il login e le chiamate in tempo reale.

const CACHE_NAME = 'pizzalab-v10';
const LOCAL_FILES = ['./', './index.html', './manifest.json', './icon.svg'];

// Installazione: precarica i file locali
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(LOCAL_FILES))
  );
  self.skipWaiting();
});

// Attivazione: pulisci le cache vecchie
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: comportamento diverso a seconda dell'origine
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // 1) Richieste NON GET (POST/PUT/DELETE): lasciamo passare senza toccare.
  //    Firebase Auth e Firestore usano spesso POST.
  if (req.method !== 'GET') {
    return;
  }

  // 2) Richieste cross-origin (googleapis, gstatic, tailwindcss, firebaseapp.com,
  //    accounts.google.com, ecc.): LASCIAMO PASSARE, zero cache, zero intercetti.
  //    Questa è la riga più importante del file: tenere il SW lontano da Firebase.
  if (url.origin !== self.location.origin) {
    return;
  }

  // 3) Da qui in giù: solo richieste sullo stesso dominio della nostra app.
  const isHTML =
    req.destination === 'document' ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('/');

  if (isHTML) {
    // HTML: prima la rete (per avere sempre l'ultima versione), cache come fallback offline.
    event.respondWith(
      fetch(req)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
          return response;
        })
        .catch(() =>
          caches.match(req).then(c => c || caches.match('./index.html'))
        )
    );
  } else {
    // Asset locali (icon.svg, manifest.json): prima la cache, poi la rete.
    // IMPORTANTE: se la rete fallisce NON rispondiamo con index.html — quello era il bug.
    event.respondWith(
      caches.match(req).then(cached => cached || fetch(req))
    );
  }
});
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
