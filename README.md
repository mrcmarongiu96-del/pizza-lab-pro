# Pizza Lab Pro

App per il banco di una pizzeria: dosi scalabili, checklist, produzioni, lotti in
frigo, piano del servizio, magazzino ingredienti e lista acquisti.

**Online:** https://mrcmarongiu96-del.github.io/pizza-lab-pro/

HTML, CSS e JavaScript senza compilazione e senza dipendenze di runtime locali.
Firebase Auth e Firestore sono caricati dal CDN già utilizzato dal progetto.

## Avvio e verifiche

```bash
python3 -m http.server 8765
npm run check
npm test
```

Apri http://127.0.0.1:8765 e scegli **Usa senza account** per provare con dati
locali, separati dai dati Firebase. I test richiedono Node 22 o successivo e non
contattano servizi esterni. GitHub Actions esegue sintassi e regressioni.

GitHub Pages pubblica `main`, cartella radice. Il ramo di lavoro non cambia il
sito pubblico finché non viene integrato in `main`.

## Funzioni

- **Ricette:** proporzioni dirette/inverse, ingredienti in kg/g, checklist,
  preset e costi/calorie con segnalazione separata dei valori mancanti.
- **Salva produzione:** conserva dosi, idratazione, peso, prezzi del momento,
  note e legame al lotto. Produzione, lotto, movimento e scarico ingredienti
  vengono salvati insieme, con un identificativo riutilizzato in caso di retry.
- **Frigo:** lotti ordinati per fine finestra d'uso; date di produzione,
  ingresso in frigo e intervallo d'uso configurabili. Consumi rapidi, scarti,
  rettifiche e annullamento dei movimenti. Le palline aggiunte a un lotto
  ereditano la data di quel lotto: una nuova produzione deve essere un nuovo lotto.
- **Storico:** scheda con dosi originali e ripetizione, anche dopo modifica o
  eliminazione della ricetta. Le produzioni precedenti non hanno una scheda
  ingredienti ricostruibile: l'app non inventa i dati mancanti.
- **Piano:** obiettivo per impasto, data e ora del servizio; sottrae solo le
  palline attualmente disponibili e nella finestra d'uso a quell'ora. Non
  prevede consumi futuri. I lotti legacy senza date sono inclusi e segnalati.
- **Scorte:** monitoraggio facoltativo per ingrediente, carichi e rettifiche
  incrementali, scorta minima, scarico dalla produzione. Il salvataggio viene
  bloccato se un ingrediente monitorato è insufficiente. L'aggiunta manuale di
  un lotto non scarica ingredienti. La lista acquisti copre il piano selezionato
  e riporta gli ingredienti monitorati alla scorta minima.
- **Backup v2:** ricette, preset, prezzi, produzioni, lotti, tutti i movimenti,
  magazzino e piani. Importa anche v1, validando l'intero file prima di scrivere.

## Struttura

| File | Responsabilità |
|---|---|
| `domain.js` | Calcoli, validazione, pianificazione, movimenti e dosi/costi puri |
| `app.js` | Store, UI originale, storico, grafici, accesso, avvio |
| `workflows.js` | Piano, magazzino, lotti, annullamenti, schede produzione |
| `index.html`, `styles.css` | Interfaccia e temi esistenti |
| `sw.js` | Cache versionata dell'intera app |
| `tests/*.test.cjs` | Regressioni pure e Store con simulatori isolati |

## Compatibilità dei dati

Le collezioni esistenti rimangono nelle stesse posizioni:

```
users/{uid}/history/{id}
users/{uid}/batches/{id}
users/{uid}/frigoLog/{id}
users/{uid}/data/recipes       { list: [Ricetta, ...] }
users/{uid}/data/presets       { recipeId: [Preset, ...] }
users/{uid}/data/prices        { items: { ingredientId: {cal?, prezzo?} } }
users/{uid}/data/inventory     { items: { ingredientId: {name, tracked, kg, minKg} } }
users/{uid}/data/plans         { YYYY-MM-DD: {at, targets: {recipeId: palline}} }
users/{uid}/data/_revision     { value: numero }
```

I documenti di produzione mantengono il vecchio `id` numerico. Le nuove
produzioni aggiungono `batchId`, `snapshot` e `inventoryUsed`. Le quantità di
una produzione collegata al lotto sono immutabili: le rettifiche si registrano
nel Frigo; si possono modificare le note. Eliminare una scheda storico non
annulla le palline o restituisce ingredienti già impastati.

I nuovi lotti salvano `recipeId`, `historyId` se presente, `fridgeAt`, `readyAt`
e `useBy`, oltre ai campi precedenti. Le palline mantengono gli stati
`in_frigo`/`consumata` e aggiungono `scartata`/`rettificata`, `operationId` e
`movementKind`. Il consumo è tracciato dall'evento, non dedotto dalla produzione.
I log nuovi hanno `schemaVersion: 2`; quelli annullati hanno `undoneAt`.
Per i dati vecchi si usano le palline consumate con `consumedAt`, evitando il
doppio conteggio con i log legacy, che potevano essere parziali.

Le ricette hanno un id stabile. Alla rinomina conservano `aliases` con i nomi
precedenti per riconoscere i lotti vecchi senza `recipeId`. I nomi ambigui non
vengono associati automaticamente. I preset v1 per campo HTML continuano a
essere letti attraverso `LEGACY_PRESET_FIELDS`.

La vecchia migrazione automatica dal nodo condiviso è stata rimossa: non si
copia lo stesso archivio su ogni account. Per dati ancora nel vecchio archivio
usare un export/import esplicito.

## Salvataggi, sincronizzazione e offline

Ogni scrittura passa da `Store.atomic()` o `Store.updateDoc()`:

- **Cloud:** transazioni Firestore su documenti correnti. Le modifiche a lotti,
  ricette, prezzi e preset leggono i valori aggiornati, anziché sovrascrivere
  un'intera copia locale obsoleta. `_revision` coordina ripristini/cancellazioni
  con gli altri dispositivi. Non scrivere direttamente con `.set()` fuori da Store.
- **Senza account:** un unico documento JSON in `pizzalab_local_state_v2`, scritto
  prima di aggiornare la memoria. Le vecchie chiavi `pizzalab_local_*` sono lette
  al primo uso e conservate. Web Locks coordina le schede quando disponibile;
  l'evento `storage` aggiorna le altre schede.
- **Offline con account:** calcoli e consultazione continuano; le transazioni
  richiedono rete e non vengono presentate come salvataggi riusciti offline.
  Se l'SDK non si carica si legge lo specchio dell'ultimo account in sola lettura.
- **Specchio:** `pizzalab_mirror_v2_{uid}_{nome}`. La modalità locale non lo
  scrive. I vecchi specchi non attribuibili con certezza a un account non
  vengono riutilizzati: serve un primo caricamento online della nuova versione.

Le regole Firestore sono gestite nella console Firebase, fuori dal repository.
Devono consentire solo a `request.auth.uid == uid` l'accesso ai documenti del
proprio nodo, comprese le nuove voci di `data`. Non sono state modificate né
verificate contro i dati reali da questi test. La configurazione Firebase nel
client è pubblica; la protezione effettiva è nelle regole.

## Ripristino e limiti espliciti

Prima del ripristino l'app scarica una copia completa dei dati attuali. In locale
conserva anche `pizzalab_restore_recovery`, poi sostituisce l'archivio con un'unica
scrittura. In cloud esegue una transazione indivisibile, verificando che nessun
altro dispositivo abbia modificato l'archivio durante la lettura.

Il ripristino cloud accetta fino a **449 documenti distinti coinvolti**, più il
documento di coordinamento, e un payload preventivo di 7 MB. Oltre questi limiti
si interrompe **senza cancellare nulla**; l'export completo resta disponibile.
Non si effettua un ripristino spezzato in scritture potenzialmente parziali.
Il calcolo e i lotti sono limitati a 3.000 palline ciascuno.

## Aggiornamenti PWA

Quando cambi il codice incrementa `CACHE` in `sw.js` e la query versione nei
riferimenti di `index.html`. L'intero shell deve essere scaricato prima che la
nuova cache sia installata. La nuova versione attende il pulsante **Aggiorna**,
per evitare reload durante un impasto; chiudere tutte le schede permette anche
l'attivazione naturale. Non cancellare cache appartenenti ad altre app sullo
stesso dominio GitHub Pages.

## Validazione

`npm test` copre proporzioni/unità, input invalidi, identità/alias delle ricette,
maturazione, costi incompleti, scorte, validazione backup, salvataggi atomici e
idempotenti, errore di spazio locale, specchi separati per account, scritture
concorrenti simulate, consumi reali e annullamenti.

Le prove browser isolate usano la modalità locale con Firebase bloccato e
verificano calcolo, produzione, scarto, annullamento, piano, magazzino, schede,
navigazione mobile e persistenza al reload. Non sostituiscono un collaudo con
account Firebase reale e relative regole di produzione.

Per ripetere la prova browser (con un server locale già avviato):

```bash
npm ci
npx playwright install chromium
npm run test:browser
```

Il test include l'avvio della PWA offline. Per usare un Chrome già installato,
impostare `PLAYWRIGHT_CHROMIUM_EXECUTABLE` al percorso dell'eseguibile.
