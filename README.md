# Pizza Lab Pro

App web per il banco di una pizzeria: calcola le dosi di un impasto a partire
dal numero di palline, permette di spuntare gli ingredienti mentre si pesa,
tiene il conto delle palline in frigo e registra lo storico delle produzioni.

**Online:** https://mrcmarongiu96-del.github.io/pizza-lab-pro/

Non c'è nulla da compilare: è HTML, CSS e JavaScript serviti così come sono.

---

## Far girare il progetto

Serve un server statico qualsiasi, perché il service worker e i moduli non
funzionano aprendo il file dal disco (`file://`).

```bash
python3 -m http.server 8765
```

Poi apri http://127.0.0.1:8765. Per provare senza toccare i dati veri, usa il
pulsante **"Usa senza account"**: l'app lavora su `localStorage` e non parla
con Firebase.

**Pubblicazione:** GitHub Pages sul ramo `main`, cartella radice. Un push su
`main` aggiorna il sito nel giro di un minuto.

---

## Struttura dei file

| File | Contenuto |
|---|---|
| `index.html` | Solo markup. Nessuna logica, a parte tre righe che applicano il tema salvato prima del disegno per evitare il lampeggio. |
| `styles.css` | Token di design dei tre temi, poi i componenti. Vedi *Aggiungere un tema*. |
| `app.js` | Tutta la logica, divisa in 13 sezioni numerate elencate in cima al file. |
| `sw.js` | Service worker: precarica i 25 file dell'app per il funzionamento offline. |
| `fonts.css` + `fonts/` | Font ospitati in locale, così l'app resta leggibile senza rete. |
| `icons/` | Icone PNG generate; `icon.svg` è la sorgente. |

---

## Modello dati

**Questa è la parte da leggere prima di modificare qualcosa.** Ci sono dati di
produzione con questa forma: cambiarla senza migrazione li rende illeggibili.

### Firestore

```
users/{uid}/history/{id}          un impasto registrato
users/{uid}/batches/{id}          un lotto di palline in frigo
users/{uid}/frigoLog/{autoId}     movimenti del frigo (solo cronologia)
users/{uid}/data/recipes          { list: [Ricetta, ...] }
users/{uid}/data/presets          { recipeId: [{ name, qty: {ingredientId: numero} }] }
users/{uid}/data/prices           { items: { ingredientId: { cal, prezzo } } }
```

**Impasto** (`history`) — `id` è il timestamp di creazione e fa da chiave:

```js
{ id: 1788696859621, date: '2026-09-06', time: '14:14', type: 'Solina',
  recipeId: 'solina', palline: 55, ballWeight: 290, cassetti: 0, note: '' }
```

`type` è il **nome** della ricetta, non il suo id: è così dalle prime versioni
e i grafici e il frigo raggruppano per quella stringa. `recipeId` è stato
aggiunto dopo, quindi le voci vecchie non ce l'hanno: non darlo mai per
scontato.

**Lotto in frigo** (`batches`) — ogni pallina è tracciata singolarmente, così
si sa quanti giorni ha:

```js
{ id: 'b...', createdAt: '2026-09-06T12:14:00.000Z', type: 'Solina',
  ballWeight: 290, note: '', source: 'calcolo' | 'manuale',
  balls: [{ id: 'b...', createdAt: '...', status: 'in_frigo' | 'consumata', consumedAt }] }
```

**Ricetta** (`data/recipes`) — le dosi sono valori di riferimento, l'app li
riscala in proporzione:

```js
{ id: 'solina', name: 'Solina', icon: '🌾', ballWeight: 290,
  ingredients: [
    { id: 'solina', name: 'Solina', icon: '🌾', unit: 'kg', qty: 3.5, flour: true },
    { id: 'acqua',  name: 'Acqua',  icon: '💧', unit: 'kg', qty: 4.5, water: true },
    ...
  ] }
```

`flour: true` e `water: true` servono solo a calcolare l'idratazione. `unit` è
`'kg'` o `'g'`.

### localStorage

| Chiave | A cosa serve |
|---|---|
| `pizzalab_theme` | Tema scelto. Letto anche da `index.html` prima del disegno. |
| `pizzalab_checklist` | Spunte della checklist in corso, legate a una firma della ricetta: sopravvivono a un ricaricamento durante l'impasto. |
| `pizzalab_local_*` | Dati della modalità senza account. |
| `pizzalab_mirror_*` | Copia dei dati cloud, usata in sola lettura quando manca la rete. |
| `pizzalab_last_uid` | Serve a distinguere "non ho mai avuto un account" da "sono offline". |
| `pizzalab_migrated_{uid}` | Segna che la migrazione dal vecchio codice condiviso è già avvenuta. |
| `pizzalab_costi` | Formato vecchio dei prezzi, letto una volta sola e poi portato sull'account. |

---

## Le tre modalità del livello dati

Tutte le letture e scritture passano dall'oggetto `Store` in `app.js`, che ha
tre modalità. È il pezzo di architettura meno ovvio, quindi vale la pena
conoscerlo prima di aggiungere una funzione che salva qualcosa.

| Modalità | Quando | Comportamento |
|---|---|---|
| `cloud` | Utente autenticato | Firestore con persistenza offline dell'SDK. Ogni dato che arriva viene copiato in `localStorage` come specchio. |
| `local` | "Usa senza account" oppure primo avvio senza rete e senza account | Tutto su `localStorage`, nessuna sincronizzazione. |
| `offline` | L'SDK Firebase non si è caricato ma esiste un `pizzalab_last_uid` | Sola lettura dallo specchio. Il calcolo funziona, salvataggi e modifiche sono bloccati con un avviso. |

Regola pratica: **non chiamare mai Firestore direttamente**, usa `Store`.
Prima di una scrittura chiama `requireWritable()`, che avvisa l'utente e
restituisce `false` quando siamo in sola lettura.

---

## Aggiungere un tema

I componenti in `styles.css` usano solo variabili CSS, mai colori scritti a
mano. Aggiungere un tema significa quindi scrivere un blocco di variabili, non
una cascata di eccezioni:

1. In `styles.css`, copia il blocco `:root[data-theme="forno"]` e cambia i
   valori. Le variabili `--c1`…`--c6` (più le versioni `-soft`) sono le tinte
   delle serie nei grafici, una per impasto.
2. In `app.js`, aggiungi una voce all'oggetto `THEMES` con nome, descrizione e
   colore della barra di sistema.
3. In `styles.css`, aggiungi l'anteprima `.theme-prev.<nome>` usata dal
   selettore in Strumenti.

Non serve altro: il selettore, i grafici e la scheda condivisibile si adeguano
da soli. Eventuali ritocchi strutturali vanno nella sezione *4. Ritocchi per
tema*, tenendoli al minimo.

---

## Trappole note

- **Ricette e ingredienti non stanno nel codice.** Si creano dall'app, in
  Strumenti. In `app.js` c'è solo `DEFAULT_RECIPES`, usato la prima volta che
  un account apre l'app. Modificarlo non cambia nulla per chi ha già dei dati.

- **I preset hanno due formati.** Quello vecchio salvava i valori per id di
  campo HTML (`'solina-kg'`), quello nuovo per id di ingrediente. `loadPresets()`
  converte al volo con la mappa `LEGACY_PRESET_FIELDS`; la conversione viene
  scritta su Firestore solo quando l'utente tocca un preset. Non rimuovere
  quella mappa.

- **La cache del service worker può servire codice vecchio.** Dopo aver
  modificato `app.js` o `styles.css`, alza `CACHE` in `sw.js` (`pizzalab-vNN`),
  altrimenti i dispositivi già installati continuano a usare la versione
  precedente. Al cambio di versione l'app si ricarica una volta da sola.

- **La configurazione Firebase va copiata, non ricordata.** Una `apiKey`
  sbagliata non produce un errore visibile: l'autenticazione semplicemente non
  risponde mai. Se tocchi quel blocco, prova davvero il percorso di accesso,
  non solo la modalità senza account.

- **Il service worker non tocca le richieste verso altri domini.** È voluto:
  intercettare Firebase rompe login e sincronizzazione in tempo reale.

- **Le regole di sicurezza di Firestore non sono in questo repo.** Si
  configurano dalla console Firebase e devono limitare ogni utente al proprio
  nodo `users/{uid}`. La chiave API nel codice è pubblica per progetto e non
  è un segreto: la protezione sono le regole.
