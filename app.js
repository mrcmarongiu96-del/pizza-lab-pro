/* ═══════════════════════════════════════════════════════════════════════
   Pizza Lab Pro — logica applicativa.

   Indice:
     1  Utilità
     2  Temi
     3  Firebase e livello dati (cloud / locale / offline)
     4  Ricette configurabili
     5  Calcolo dosi (diretto e inverso)
     6  Checklist ingredienti
     7  Prezzi e calorie
     8  Salvataggio e storico
     9  Grafici
    10  Frigo
    11  Strumenti (temperatura, preset, prezzi, backup, tema, account)
    12  Condivisione immagine
    13  Navigazione e avvio

   La forma dei documenti salvati, le chiavi di localStorage e le trappole
   note sono descritte nel README: leggilo prima di cambiare il modello dati,
   perché in produzione ci sono dati con la forma attuale.
   ═══════════════════════════════════════════════════════════════════════ */
'use strict';

/* ── 1. UTILITÀ ───────────────────────────────────────────────────── */

const $ = (id) => document.getElementById(id);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function slug(s) {
    return String(s || '').toLowerCase().trim()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dateStr(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtDate(ds) {
    const t = todayStr();
    const y = new Date(); y.setDate(y.getDate() - 1);
    if (ds === t) return 'Oggi';
    if (ds === dateStr(y)) return 'Ieri';
    const [yr, m, d] = ds.split('-');
    return `${d}/${m}/${yr}`;
}
function fmtDT(iso) {
    try { return new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return iso; }
}
function fmtQty(val, unit) {
    return unit === 'kg' ? (Math.round(val * 100) / 100).toFixed(2) : String(Math.round(val));
}
function num(v, fallback) {
    const n = parseFloat(v);
    return isNaN(n) ? (fallback === undefined ? 0 : fallback) : n;
}
function buzz(ms) { if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) {} } }
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function lsJSON(k, fallback) {
    try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? fallback : v; }
    catch (e) { return fallback; }
}

/** Notifica in basso; se `action` è presente mostra un bottone (es. Annulla). */
function toast(message, action) {
    const wrap = $('toast-wrap');
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `<span class="toast-text">${esc(message)}</span>`;
    if (action) {
        const b = document.createElement('button');
        b.textContent = action.label;
        b.onclick = () => { el.remove(); action.run(); };
        el.appendChild(b);
    }
    wrap.appendChild(el);
    setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 300); },
        action ? 7000 : 3200);
}

function openModal(html, id) {
    closeModal(id);
    const m = document.createElement('div');
    m.className = 'modal';
    m.id = id;
    m.innerHTML = `<div class="modal-card">${html}</div>`;
    m.addEventListener('click', (e) => { if (e.target === m) closeModal(id); });
    document.body.appendChild(m);
    return m;
}
function closeModal(id) { const m = $(id); if (m) m.remove(); }

/* ── 2. TEMI ──────────────────────────────────────────────────────── */

const THEME_KEY = 'pizzalab_theme';
const THEMES = {
    punk:    { name: 'Punk',    desc: 'Scuro, neon, sfumature viola',      color: '#6366f1' },
    minimal: { name: 'Minimal', desc: 'Chiaro, editoriale, terracotta',    color: '#f6f3ee' },
    forno:   { name: 'Forno',   desc: 'Scuro e caldo, numeri grandi',      color: '#14100e' }
};

function currentTheme() {
    const t = document.documentElement.getAttribute('data-theme');
    return THEMES[t] ? t : 'punk';
}
function applyTheme(t, save) {
    if (!THEMES[t]) t = 'punk';
    document.documentElement.setAttribute('data-theme', t);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', THEMES[t].color);
    if (save) lsSet(THEME_KEY, t);
    renderThemePicker();
    if (!$('section-storico').classList.contains('hidden')) renderCharts();
    if (!$('section-frigo').classList.contains('hidden')) renderFrigo();
}
function renderThemePicker() {
    const el = $('theme-picker');
    if (!el) return;
    const cur = currentTheme();
    el.innerHTML = Object.keys(THEMES).map((k) => `
        <div class="theme-opt${k === cur ? ' active' : ''}" onclick="applyTheme('${k}', true)">
            <div class="theme-prev ${k}"></div>
            <div class="theme-name">${THEMES[k].name}${k === cur ? ' ✓' : ''}</div>
            <div class="theme-desc">${THEMES[k].desc}</div>
        </div>`).join('');
}

/** Tinte delle serie nei grafici, lette dal tema attivo. */
function seriesColor(i, soft) {
    const n = (i % 6) + 1;
    const v = getComputedStyle(document.documentElement).getPropertyValue(`--c${n}${soft ? '-soft' : ''}`);
    return (v || '#888').trim();
}

/* ── 3. FIREBASE E LIVELLO DATI ───────────────────────────────────── */

const firebaseConfig = {
    apiKey: "AIzaSyDDnSYqnTO1kwOdImIU8LoEFhyTxx25530",
    authDomain: "pizza-lab-pro.firebaseapp.com",
    projectId: "pizza-lab-pro",
    storageBucket: "pizza-lab-pro.firebasestorage.app",
    messagingSenderId: "99950673376",
    appId: "1:99950673376:web:2b9976b5a5e918c828ff85"
};

let FB = null; // { db, auth } oppure null se l'SDK non è disponibile (offline)
try {
    if (window.firebase && firebase.initializeApp) {
        firebase.initializeApp(firebaseConfig);
        FB = { db: firebase.firestore(), auth: firebase.auth() };
        FB.db.enablePersistence().catch(() => {});
    }
} catch (e) {
    console.warn('Firebase non disponibile:', e);
    FB = null;
}

/* Collezioni con molti documenti (una scrittura per elemento) e documenti
   singoli che contengono un oggetto intero. Su Firestore diventano
   users/{uid}/{collezione}/{id} e users/{uid}/data/{documento}. */
const COLLECTIONS = ['history', 'batches'];
const DOCS = ['recipes', 'presets', 'prices'];
const MIRROR_PREFIX = 'pizzalab_mirror_';

/**
 * Livello dati con tre modalità:
 *   cloud   → Firestore, con persistenza offline dell'SDK
 *   local   → solo questo dispositivo (uso senza account)
 *   offline → SDK non caricato: si leggono gli ultimi dati salvati, senza scrivere
 */
const Store = {
    mode: 'local',
    uid: null,
    listeners: { history: [], batches: [] },
    cache: { history: [], batches: [] },
    docCache: {},
    unsubs: [],

    get writable() { return this.mode !== 'offline'; },

    userDoc() { return FB.db.collection('users').doc(this.uid); },
    col(name) { return this.userDoc().collection(name); },

    mirrorKey(name) { return MIRROR_PREFIX + name; },
    mirror(name, data) { lsSet(this.mirrorKey(name), JSON.stringify(data)); },
    readMirror(name, fallback) { return lsJSON(this.mirrorKey(name), fallback); },

    localKey(name) { return 'pizzalab_local_' + name; },

    /* — avvio delle modalità — */
    startLocal() {
        this.stop();
        this.mode = 'local';
        this.uid = 'local';
        COLLECTIONS.forEach((c) => {
            this.cache[c] = lsJSON(this.localKey(c), []);
            this.emit(c);
        });
        DOCS.forEach((d) => { this.docCache[d] = lsJSON(this.localKey(d), null); });
    },

    startOffline() {
        this.stop();
        this.mode = 'offline';
        this.uid = null;
        COLLECTIONS.forEach((c) => { this.cache[c] = this.readMirror(c, []); this.emit(c); });
        DOCS.forEach((d) => { this.docCache[d] = this.readMirror(d, null); });
    },

    async startCloud(user) {
        this.stop();
        this.mode = 'cloud';
        this.uid = user.uid;
        lsSet('pizzalab_last_uid', user.uid);
        for (const d of DOCS) {
            try {
                const snap = await this.userDoc().collection('data').doc(d).get();
                this.docCache[d] = snap.exists ? snap.data() : null;
                this.mirror(d, this.docCache[d]);
            } catch (e) {
                this.docCache[d] = this.readMirror(d, null);
            }
        }
        COLLECTIONS.forEach((name) => {
            const unsub = this.col(name).onSnapshot((snap) => {
                this.cache[name] = snap.docs.map((d) => d.data());
                this.mirror(name, this.cache[name]);
                setSyncStatus('online');
                this.emit(name);
            }, (err) => {
                console.warn('snapshot', name, err);
                setSyncStatus('offline');
            });
            this.unsubs.push(unsub);
        });
    },

    stop() {
        this.unsubs.forEach((u) => { try { u(); } catch (e) {} });
        this.unsubs = [];
        this.cache = { history: [], batches: [] };
        this.docCache = {};
    },

    /* — lettura — */
    list(name) { return this.cache[name] || []; },
    watch(name, cb) { this.listeners[name].push(cb); cb(this.list(name)); },
    emit(name) { (this.listeners[name] || []).forEach((cb) => cb(this.list(name))); },

    getDoc(name) { return this.docCache[name] || null; },

    /* — scrittura — */
    async setDoc(name, data) {
        if (!this.writable) throw new Error('offline');
        this.docCache[name] = data;
        this.mirror(name, data);
        if (this.mode === 'local') { lsSet(this.localKey(name), JSON.stringify(data)); return; }
        await this.userDoc().collection('data').doc(name).set(data);
    },

    async setItem(name, id, data) {
        if (!this.writable) throw new Error('offline');
        if (this.mode === 'local') {
            const arr = this.cache[name].filter((x) => String(x.id) !== String(id));
            arr.push(data);
            this.cache[name] = arr;
            lsSet(this.localKey(name), JSON.stringify(arr));
            this.emit(name);
            return;
        }
        await this.col(name).doc(String(id)).set(data);
    },

    async deleteItem(name, id) {
        if (!this.writable) throw new Error('offline');
        if (this.mode === 'local') {
            this.cache[name] = this.cache[name].filter((x) => String(x.id) !== String(id));
            lsSet(this.localKey(name), JSON.stringify(this.cache[name]));
            this.emit(name);
            return;
        }
        await this.col(name).doc(String(id)).delete();
    },

    async clearCollection(name) {
        if (!this.writable) throw new Error('offline');
        if (this.mode === 'local') {
            this.cache[name] = [];
            lsSet(this.localKey(name), '[]');
            this.emit(name);
            return;
        }
        const snap = await this.col(name).get();
        const batch = FB.db.batch();
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
    },

    async addLog(entry) {
        if (!this.writable) return;
        if (this.mode === 'local') {
            const arr = lsJSON(this.localKey('frigoLog'), []);
            arr.unshift(entry);
            lsSet(this.localKey('frigoLog'), JSON.stringify(arr.slice(0, 200)));
            return;
        }
        try { await this.col('frigoLog').add(entry); } catch (e) { console.warn('log', e); }
    },

    async getLog(limit) {
        if (this.mode === 'local') return lsJSON(this.localKey('frigoLog'), []).slice(0, limit);
        if (this.mode === 'offline') return [];
        const snap = await this.col('frigoLog').orderBy('at', 'desc').limit(limit).get();
        return snap.docs.map((d) => d.data());
    }
};

/** Blocca l'azione e avvisa se siamo in sola lettura. */
function requireWritable() {
    if (Store.writable) return true;
    toast('Sei offline senza account: i dati mostrati sono l\'ultima copia salvata e non si possono modificare.');
    return false;
}

function setSyncStatus(state) {
    const dot = $('sync-dot');
    const lbl = $('sync-label');
    if (!dot || !lbl) return;
    dot.className = 'sync-dot ' + state;
    lbl.textContent = state === 'online' ? 'sincronizzato'
        : state === 'offline' ? 'offline'
        : state === 'local' ? 'solo locale'
        : 'connessione...';
}

/* ── 4. RICETTE CONFIGURABILI ─────────────────────────────────────── */

/* Impasti creati la prima volta che un account apre l'app. Da lì in poi le
   ricette vivono nei dati dell'utente e si modificano da Strumenti: cambiare
   questa costante non ha effetto su chi ha già usato l'app. */
const DEFAULT_RECIPES = [
    {
        id: 'solina', name: 'Solina', icon: '🌾', ballWeight: 290,
        ingredients: [
            { id: 'solina',  name: 'Solina',  icon: '🌾', unit: 'kg', qty: 3.5, flour: true },
            { id: 'caputo',  name: 'Caputo',  icon: '🌾', unit: 'kg', qty: 3.6, flour: true },
            { id: 'acqua',   name: 'Acqua',   icon: '💧', unit: 'kg', qty: 4.5, water: true },
            { id: 'sale',    name: 'Sale',    icon: '🧂', unit: 'g',  qty: 260 },
            { id: 'lievito', name: 'Lievito', icon: '🍞', unit: 'g',  qty: 50 }
        ]
    },
    {
        id: 'farro', name: 'Farro', icon: '🌿', ballWeight: 290,
        ingredients: [
            { id: 'farro',   name: 'Farro',   icon: '🌿', unit: 'kg', qty: 1.5, flour: true },
            { id: 'solina',  name: 'Solina',  icon: '🌾', unit: 'kg', qty: 1.9, flour: true },
            { id: 'caputo',  name: 'Caputo',  icon: '🌾', unit: 'kg', qty: 3.4, flour: true },
            { id: 'acqua',   name: 'Acqua',   icon: '💧', unit: 'kg', qty: 4.5, water: true },
            { id: 'sale',    name: 'Sale',    icon: '🧂', unit: 'g',  qty: 260 },
            { id: 'lievito', name: 'Lievito', icon: '🍞', unit: 'g',  qty: 50 }
        ]
    },
    {
        id: 'romano', name: 'Romano', icon: '🍕', ballWeight: 190,
        ingredients: [
            { id: 'farina-blu', name: 'Farina Blu', icon: '🍕', unit: 'kg', qty: 18,  flour: true },
            { id: 'acqua',      name: 'Acqua',      icon: '💧', unit: 'kg', qty: 9.4, water: true },
            { id: 'sale',       name: 'Sale',       icon: '🧂', unit: 'g',  qty: 550 },
            { id: 'zucchero',   name: 'Zucchero',   icon: '🍬', unit: 'g',  qty: 200 },
            { id: 'lievito',    name: 'Lievito',    icon: '🍞', unit: 'g',  qty: 40 },
            { id: 'olio',       name: 'Olio',       icon: '🫒', unit: 'kg', qty: 1 }
        ]
    }
];

/* Campi dei preset salvati dalla versione precedente, quando i valori erano
   indicizzati per id del campo HTML invece che per id dell'ingrediente.
   loadPresets() li converte al volo: non rimuovere questa mappa, ci sono
   ancora preset salvati nel vecchio formato. */
const LEGACY_PRESET_FIELDS = {
    solina: { 'solina-kg': 'solina', 'caputo-kg': 'caputo', 'acqua-kg': 'acqua', 'sale-g': 'sale', 'lievito-g': 'lievito' },
    farro:  { 'farro-kg': 'farro', 'solina-farro-kg': 'solina', 'caputo-farro-kg': 'caputo', 'acqua-farro-kg': 'acqua', 'sale-farro-g': 'sale', 'lievito-farro-g': 'lievito' },
    romano: { 'farina-blu-kg': 'farina-blu', 'acqua-romano-kg': 'acqua', 'sale-romano-g': 'sale', 'zucchero-g': 'zucchero', 'lievito-romano-g': 'lievito', 'olio-oliva-kg': 'olio' }
};

let recipes = [];
let presets = {};
let prices = {};
let currentRecipeId = null;

function cloneDefaults() { return JSON.parse(JSON.stringify(DEFAULT_RECIPES)); }

function getRecipe(id) { return recipes.find((r) => r.id === id) || null; }
function recipeByName(name) {
    const n = String(name || '').trim().toLowerCase();
    return recipes.find((r) => r.name.trim().toLowerCase() === n) || null;
}
function recipeIndex(id) { return recipes.findIndex((r) => r.id === id); }

async function loadRecipes() {
    const doc = Store.getDoc('recipes');
    if (doc && Array.isArray(doc.list) && doc.list.length) {
        recipes = doc.list;
    } else {
        recipes = cloneDefaults();
        if (Store.writable) { try { await Store.setDoc('recipes', { list: recipes }); } catch (e) {} }
    }
    if (!getRecipe(currentRecipeId)) currentRecipeId = recipes.length ? recipes[0].id : null;
}

async function persistRecipes() {
    await Store.setDoc('recipes', { list: recipes });
}

function loadPresets() {
    const doc = Store.getDoc('presets') || {};
    // Conversione dal formato precedente (valori per id di campo HTML)
    const converted = {};
    Object.keys(doc).forEach((key) => {
        const arr = doc[key];
        if (!Array.isArray(arr)) return;
        converted[key] = arr.map((p) => {
            if (p && p.qty) return p;
            const map = LEGACY_PRESET_FIELDS[key] || {};
            const qty = {};
            Object.keys(p && p.vals ? p.vals : {}).forEach((fid) => {
                const ing = map[fid];
                if (ing) qty[ing] = num(p.vals[fid]);
            });
            return { name: p.name, qty: qty };
        });
    });
    presets = converted;
}

function loadPrices() {
    const doc = Store.getDoc('prices');
    if (doc && doc.items) { prices = doc.items; return; }
    // Recupero dei prezzi salvati in locale dalla versione precedente
    const legacy = lsJSON('pizzalab_costi', null);
    prices = legacy || {};
}

/** Tutti gli ingredienti usati dalle ricette, senza duplicati. */
function allIngredients() {
    const map = {};
    recipes.forEach((r) => r.ingredients.forEach((i) => {
        if (!map[i.id]) map[i.id] = { id: i.id, name: i.name, icon: i.icon };
    }));
    return Object.values(map).sort((a, b) => a.name.localeCompare(b.name));
}

/* — Editor ricette — */

let editorState = null;

function openRecipeEditor(id) {
    if (!requireWritable()) return;
    const existing = id ? getRecipe(id) : null;
    editorState = existing
        ? JSON.parse(JSON.stringify(existing))
        : { id: '', name: '', icon: '🍕', ballWeight: 250, ingredients: [{ id: '', name: '', icon: '🌾', unit: 'kg', qty: 1, flour: true }] };
    editorState._isNew = !existing;
    renderRecipeEditor();
}

function renderRecipeEditor() {
    const s = editorState;
    const rows = s.ingredients.map((ing, i) => `
        <div class="ing-row">
            <input class="input" value="${esc(ing.icon || '')}" maxlength="4" oninput="editorSet(${i},'icon',this.value)" aria-label="Icona">
            <input class="input" value="${esc(ing.name || '')}" placeholder="Ingrediente" oninput="editorSet(${i},'name',this.value)" aria-label="Nome ingrediente">
            <input class="input" type="number" step="0.01" value="${ing.qty}" oninput="editorSet(${i},'qty',this.value)" aria-label="Quantità">
            <select class="select" style="padding:9px 8px;font-size:0.84rem" onchange="editorSet(${i},'unit',this.value)" aria-label="Unità">
                <option value="kg"${ing.unit === 'kg' ? ' selected' : ''}>kg</option>
                <option value="g"${ing.unit === 'g' ? ' selected' : ''}>g</option>
            </select>
            <button class="btn btn-icon" onclick="editorRemoveIng(${i})" title="Togli ingrediente">✕</button>
        </div>
        <div class="ing-flags">
            <label><input type="checkbox" ${ing.flour ? 'checked' : ''} onchange="editorSet(${i},'flour',this.checked)"> è farina</label>
            <label><input type="checkbox" ${ing.water ? 'checked' : ''} onchange="editorSet(${i},'water',this.checked)"> è acqua</label>
        </div>`).join('');

    const html = `
        <h3>${s._isNew ? 'Nuovo impasto' : 'Modifica impasto'}</h3>
        <div class="field-row">
            <div class="field">
                <label class="field-label">Nome</label>
                <input class="input" id="ed-name" value="${esc(s.name)}" placeholder="Es. Integrale" oninput="editorState.name=this.value">
            </div>
            <div class="field">
                <label class="field-label">Icona</label>
                <input class="input" id="ed-icon" value="${esc(s.icon)}" maxlength="4" oninput="editorState.icon=this.value">
            </div>
        </div>
        <div class="field">
            <label class="field-label">Peso della pallina (g)</label>
            <input class="input" type="number" id="ed-bw" value="${s.ballWeight}" min="1" oninput="editorState.ballWeight=parseFloat(this.value)||0">
        </div>
        <label class="field-label" style="margin-top:6px">Ingredienti e dosi di riferimento</label>
        <div class="ing-head"><span>Icona</span><span>Nome</span><span>Dose</span><span>Unità</span><span></span></div>
        <div id="ed-ings">${rows}</div>
        <button class="btn btn-outline" style="margin-top:6px" onclick="editorAddIng()">＋ Aggiungi ingrediente</button>
        <p class="card-note" style="margin-top:14px">Le dosi di riferimento sono la base della proporzione: l'app le riscala sul numero di palline che chiedi. Segna quali ingredienti sono farine e quale è l'acqua per far calcolare l'idratazione.</p>
        <div class="modal-actions">
            ${s._isNew ? '' : `<button class="btn btn-danger" onclick="deleteRecipe('${esc(s.id)}')">Elimina impasto</button>`}
            <button class="btn btn-outline" onclick="closeModal('modal-recipe')">Annulla</button>
            <button class="btn btn-dark" style="width:auto;padding:10px 20px;margin:0" onclick="saveRecipeEditor()">Salva</button>
        </div>`;
    openModal(html, 'modal-recipe');
}

function editorSet(i, key, value) {
    const ing = editorState.ingredients[i];
    if (key === 'qty') ing.qty = num(value);
    else if (key === 'flour' || key === 'water') ing[key] = !!value;
    else ing[key] = value;
}
function editorAddIng() {
    editorState.ingredients.push({ id: '', name: '', icon: '🥄', unit: 'g', qty: 0 });
    renderRecipeEditor();
}
function editorRemoveIng(i) {
    editorState.ingredients.splice(i, 1);
    if (!editorState.ingredients.length) editorState.ingredients.push({ id: '', name: '', icon: '🥄', unit: 'g', qty: 0 });
    renderRecipeEditor();
}

async function saveRecipeEditor() {
    const s = editorState;
    if (!s.name.trim()) { alert('Dai un nome all\'impasto'); return; }
    if (!(s.ballWeight > 0)) { alert('Il peso della pallina deve essere maggiore di zero'); return; }
    const ings = s.ingredients.filter((i) => i.name.trim());
    if (!ings.length) { alert('Aggiungi almeno un ingrediente'); return; }

    const used = {};
    ings.forEach((i) => {
        let base = i.id && i.id.trim() ? i.id : slug(i.name);
        let id = base, n = 2;
        while (used[id]) id = base + '-' + n++;
        used[id] = true;
        i.id = id;
        i.name = i.name.trim();
        i.qty = num(i.qty);
        i.unit = i.unit === 'g' ? 'g' : 'kg';
    });

    const recipe = {
        id: s.id || (function () {
            let base = slug(s.name), id = base, n = 2;
            while (getRecipe(id)) id = base + '-' + n++;
            return id;
        })(),
        name: s.name.trim(),
        icon: s.icon.trim() || '🍕',
        ballWeight: num(s.ballWeight),
        ingredients: ings
    };

    const idx = recipeIndex(recipe.id);
    if (idx >= 0) recipes[idx] = recipe; else recipes.push(recipe);

    try {
        await persistRecipes();
        closeModal('modal-recipe');
        currentRecipeId = recipe.id;
        renderRecipeTabs();
        renderRecipeForm();
        renderRecipeList();
        renderPriceEditor();
        toast(idx >= 0 ? 'Impasto aggiornato' : 'Impasto creato');
    } catch (e) {
        alert('Errore nel salvataggio: ' + e.message);
    }
}

async function deleteRecipe(id) {
    const r = getRecipe(id);
    if (!r) return;
    if (recipes.length <= 1) { alert('Deve restare almeno un impasto.'); return; }
    if (!confirm(`Eliminare l'impasto "${r.name}"?\nGli impasti già registrati nello storico restano.`)) return;
    recipes = recipes.filter((x) => x.id !== id);
    delete presets[id];
    try {
        await persistRecipes();
        await Store.setDoc('presets', presets);
    } catch (e) {}
    if (currentRecipeId === id) currentRecipeId = recipes[0].id;
    closeModal('modal-recipe');
    renderRecipeTabs();
    renderRecipeForm();
    renderRecipeList();
    renderPriceEditor();
    toast('Impasto eliminato');
}

function renderRecipeList() {
    const el = $('recipe-list');
    if (!el) return;
    el.innerHTML = recipes.map((r, i) => `
        <div class="recipe-row" onclick="openRecipeEditor('${esc(r.id)}')">
            <span class="recipe-swatch" style="background:${seriesColor(i)}"></span>
            <span class="recipe-row-icon">${esc(r.icon)}</span>
            <div class="recipe-row-main">
                <div class="recipe-row-name">${esc(r.name)}</div>
                <div class="recipe-row-meta">${r.ingredients.length} ingredienti · pallina ${r.ballWeight}g</div>
            </div>
            <span class="cost-strip-arrow">✎</span>
        </div>`).join('');
}

/* ── 5. CALCOLO DOSI ──────────────────────────────────────────────── */

let calcMode = 'balls'; // 'balls' = quante palline voglio, 'stock' = quanto ingrediente ho
let lastCalc = null;

function renderRecipeTabs() {
    const el = $('recipe-tabs');
    el.className = 'segmented' + (recipes.length > 3 ? ' scroll' : '');
    el.innerHTML = recipes.map((r) => `
        <button class="segment${r.id === currentRecipeId ? ' active' : ''}" onclick="switchRecipe('${esc(r.id)}')">
            <span class="seg-icon">${esc(r.icon)}</span>${esc(r.name)}
        </button>`).join('');
}

function switchRecipe(id) {
    currentRecipeId = id;
    clearResults();
    renderRecipeTabs();
    renderRecipeForm();
}

function renderRecipeForm() {
    const r = getRecipe(currentRecipeId);
    const el = $('recipe-form');
    if (!r) { el.innerHTML = '<div class="empty"><div class="empty-icon">🍕</div><p>Nessun impasto. Creane uno da Strumenti.</p></div>'; return; }

    const fields = r.ingredients.map((ing) => `
        <div class="field">
            <label class="field-label" for="ing-${esc(ing.id)}">${esc(ing.icon)} ${esc(ing.name)} (${ing.unit})</label>
            <input class="input" type="number" step="${ing.unit === 'kg' ? '0.1' : '1'}" id="ing-${esc(ing.id)}" value="${ing.qty}">
        </div>`).join('');

    const stockOptions = ['<option value="__flour__">Farina totale</option>']
        .concat(r.ingredients.map((i) => `<option value="${esc(i.id)}">${esc(i.icon)} ${esc(i.name)}</option>`)).join('');

    el.innerHTML = `
        <div id="preset-bar" class="chip-bar no-print"></div>
        <div class="field-row">${fields}</div>

        <div class="target-field">
            <div class="segmented no-print" style="margin-bottom:14px">
                <button class="segment${calcMode === 'balls' ? ' active' : ''}" onclick="setCalcMode('balls')">🎯 Quante palline</button>
                <button class="segment${calcMode === 'stock' ? ' active' : ''}" onclick="setCalcMode('stock')">📦 Quanto ne ho</button>
            </div>
            ${calcMode === 'balls' ? `
                <label class="target-label" for="target-balls">Obiettivo: palline da ${r.ballWeight}g</label>
                <input class="input big target" type="number" id="target-balls" placeholder="Es. 55" inputmode="numeric">
            ` : `
                <label class="target-label" for="stock-ing">Ingrediente disponibile</label>
                <select class="select" id="stock-ing" style="margin-bottom:10px">${stockOptions}</select>
                <input class="input big target" type="number" id="stock-qty" placeholder="Es. 10" step="0.1" inputmode="decimal">
                <p class="card-note" style="text-align:center;margin:10px 0 0">Scrivi quanto ne hai e l'app calcola quante palline ne escono.</p>
            `}
        </div>

        <div class="btn-row no-print" style="margin-top:14px">
            <button class="btn btn-outline" onclick="savePreset()">💾 Salva preset</button>
            <button class="btn btn-outline" onclick="resetRecipeDefaults()">↺ Dosi base</button>
        </div>
        <button class="btn btn-primary no-print" onclick="calculate()">Calcola ricetta</button>`;

    renderPresetBar();
}

function setCalcMode(mode) {
    calcMode = mode;
    clearResults();
    renderRecipeForm();
}

function resetRecipeDefaults() {
    const r = getRecipe(currentRecipeId);
    if (!r) return;
    r.ingredients.forEach((ing) => { const f = $('ing-' + ing.id); if (f) f.value = ing.qty; });
    toast('Dosi riportate ai valori dell\'impasto');
}

function readFormQuantities() {
    const r = getRecipe(currentRecipeId);
    return r.ingredients.map((ing) => {
        const f = $('ing-' + ing.id);
        return Object.assign({}, ing, { qty: f ? num(f.value) : ing.qty });
    });
}

function clearResults() {
    $('results').classList.add('hidden');
    $('results').innerHTML = '';
    $('save-panel').classList.add('hidden');
    lastCalc = null;
}

function calculate() {
    const r = getRecipe(currentRecipeId);
    if (!r) return;
    const ings = readFormQuantities();

    const totalKg = ings.reduce((s, i) => s + (i.unit === 'kg' ? i.qty : i.qty / 1000), 0);
    if (!(totalKg > 0)) { alert('Inserisci almeno una dose maggiore di zero.'); return; }

    let balls;
    if (calcMode === 'balls') {
        balls = Math.round(num($('target-balls').value));
        if (!(balls > 0)) { alert('Inserisci un numero di palline valido!'); return; }
    } else {
        const which = $('stock-ing').value;
        const have = num($('stock-qty').value);
        if (!(have > 0)) { alert('Inserisci la quantità che hai a disposizione.'); return; }
        let baseAmount, label;
        if (which === '__flour__') {
            baseAmount = ings.filter((i) => i.flour).reduce((s, i) => s + (i.unit === 'kg' ? i.qty : i.qty / 1000), 0);
            label = 'farina totale';
        } else {
            const ing = ings.find((i) => i.id === which);
            if (!ing) return;
            baseAmount = ing.unit === 'kg' ? ing.qty : ing.qty / 1000;
            label = ing.name;
        }
        if (!(baseAmount > 0)) { alert(`La dose di ${label} è zero: non posso calcolare la proporzione.`); return; }
        // Nella modalità inversa la quantità inserita è in kg se l'ingrediente è in kg, altrimenti in g
        const haveKg = (which !== '__flour__' && ings.find((i) => i.id === which).unit === 'g') ? have / 1000 : have;
        const factor = haveKg / baseAmount;
        balls = Math.floor((totalKg * factor * 1000) / r.ballWeight);
        if (balls <= 0) { alert(`Con questa quantità non esce nemmeno una pallina da ${r.ballWeight}g.`); return; }
    }

    const targetKg = (balls * r.ballWeight) / 1000;
    const factor = targetKg / totalKg;

    const scaled = ings.map((i) => Object.assign({}, i, { scaled: i.qty * factor }));
    const flourKg = scaled.filter((i) => i.flour).reduce((s, i) => s + (i.unit === 'kg' ? i.scaled : i.scaled / 1000), 0);
    const waterKg = scaled.filter((i) => i.water).reduce((s, i) => s + (i.unit === 'kg' ? i.scaled : i.scaled / 1000), 0);
    const hydration = flourKg > 0 && waterKg > 0 ? (waterKg / flourKg) * 100 : null;

    lastCalc = {
        recipeId: r.id, type: r.name, icon: r.icon, ballWeight: r.ballWeight,
        palline: balls, totalKg: targetKg, hydration: hydration, ingredients: scaled
    };

    renderResults();
    $('save-panel').classList.remove('hidden');
    $('save-date').value = todayStr();
    $('save-note').value = '';
    syncSaveCassetti();
    $('btn-save').textContent = 'Salva impasto';
    $('btn-save').disabled = false;
    setTimeout(() => $('results').scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
}

function renderResults() {
    const c = lastCalc;
    if (!c) return;
    checkSig = c.type + '|' + c.palline + '|' + c.ingredients.map((i) => i.id + '=' + i.scaled.toFixed(3)).join(',');

    let html = '<div class="results-grid">';

    if (calcMode === 'stock') {
        html += `<div class="res-card full hydration"><div class="res-icon">📦</div><div>
            <div class="res-label">Con quello che hai</div>
            <div class="res-value">${c.palline} <span class="res-unit">palline da ${c.ballWeight}g</span></div>
        </div></div>`;
    }
    if (c.hydration != null) {
        html += `<div class="res-card full hydration"><div class="res-icon">💧</div><div>
            <div class="res-label">Idratazione</div>
            <div class="res-value">${c.hydration.toFixed(1)}<span class="res-unit">%</span></div>
        </div></div>`;
    }

    html += `<div class="check-bar no-print" id="check-bar">
        <div class="check-main">
            <div class="check-txt" id="check-txt">Checklist impasto · 0/${c.ingredients.length} inseriti</div>
            <div class="check-track"><div class="check-fill" id="check-fill"></div></div>
            <div class="check-hint">Tocca un ingrediente quando l'hai pesato e messo nell'impasto.</div>
        </div>
        <button class="check-reset" onclick="resetChecklist()">↺ Reset</button>
    </div>`;

    c.ingredients.forEach((i) => {
        html += `<div class="res-card checkable" data-ing="${esc(i.id)}" onclick="toggleIngredient(this)">
            <div class="check-box">✓</div>
            <div class="res-icon">${esc(i.icon)}</div>
            <div class="res-label">${esc(i.name)}</div>
            <div class="res-value">${fmtQty(i.scaled, i.unit)} <span class="res-unit">${i.unit}</span></div>
        </div>`;
    });

    html += `<div class="res-card full total">
        <div class="res-label">Peso totale impasto</div>
        <div class="res-value">${Math.round(c.totalKg * 1000)} <span class="res-unit">g · ${c.palline} palline</span></div>
    </div>`;

    html += costStripHTML();
    html += '</div>';

    const el = $('results');
    el.innerHTML = html;
    el.classList.remove('hidden');
    restoreChecklist();
}

/* ── 6. CHECKLIST INGREDIENTI ─────────────────────────────────────── */

const CHECK_KEY = 'pizzalab_checklist';
let checkSig = '';

function checkCards() { return $$('#results .res-card.checkable'); }

function toggleIngredient(card) {
    card.classList.toggle('checked');
    buzz(card.classList.contains('checked') ? 30 : 12);
    updateChecklist();
}
function resetChecklist() {
    checkCards().forEach((c) => c.classList.remove('checked'));
    updateChecklist();
}
function updateChecklist() {
    const bar = $('check-bar');
    if (!bar) return;
    const cards = checkCards();
    const done = cards.filter((c) => c.classList.contains('checked'));
    const n = cards.length, d = done.length;
    $('check-fill').style.width = (n ? (d / n) * 100 : 0) + '%';
    const txt = $('check-txt');
    if (n > 0 && d === n) { bar.classList.add('done'); txt.textContent = `✅ Tutti gli ingredienti inseriti (${n}/${n})`; }
    else { bar.classList.remove('done'); txt.textContent = `Checklist impasto · ${d}/${n} inseriti`; }
    lsSet(CHECK_KEY, JSON.stringify({ sig: checkSig, checked: done.map((c) => c.dataset.ing) }));
}
function restoreChecklist() {
    const saved = lsJSON(CHECK_KEY, null);
    if (saved && saved.sig === checkSig && Array.isArray(saved.checked)) {
        saved.checked.forEach((id) => {
            const c = checkCards().find((x) => x.dataset.ing === id);
            if (c) c.classList.add('checked');
        });
    }
    updateChecklist();
}

/* ── 7. PREZZI E CALORIE ──────────────────────────────────────────── */

let costOpen = false;

function computeCost() {
    if (!lastCalc) return null;
    let kcal = 0, cost = 0, missing = 0;
    const rows = lastCalc.ingredients.map((i) => {
        const p = prices[i.id] || {};
        const grams = i.unit === 'kg' ? i.scaled * 1000 : i.scaled;
        const hasData = (p.cal || 0) > 0 || (p.prezzo || 0) > 0;
        if (!hasData) missing++;
        const k = ((p.cal || 0) / 100) * grams;
        const c = ((p.prezzo || 0) / 1000) * grams;
        kcal += k; cost += c;
        return { name: i.name, icon: i.icon, qty: fmtQty(i.scaled, i.unit), unit: i.unit, kcal: k, cost: c, hasData };
    });
    const balls = lastCalc.palline || 1;
    return { rows, kcal, cost, missing, perBallKcal: kcal / balls, perBallCost: cost / balls };
}

function costStripHTML() {
    const c = computeCost();
    if (!c) return '';
    if (c.cost === 0 && c.kcal === 0) {
        return `<div class="cost-strip" onclick="showSection('strumenti')">
            <div class="cost-strip-main">
                <div class="cost-strip-label">Costo e calorie</div>
                <div class="cost-strip-val" style="font-size:0.85rem;font-weight:500;color:var(--muted)">Imposta prezzi e kcal in Strumenti →</div>
            </div>
        </div>`;
    }
    const detail = costOpen ? costDetailHTML(c) : '';
    return `<div class="cost-strip${costOpen ? ' open' : ''}" onclick="toggleCostDetail()">
        <div class="cost-strip-main">
            <div class="cost-strip-label">Per pallina · ${lastCalc.ballWeight}g</div>
            <div class="cost-strip-val">€${c.perBallCost.toFixed(2)}<span class="sep">·</span>${Math.round(c.perBallKcal)} kcal</div>
        </div>
        <span class="cost-strip-arrow">▾</span>
    </div>${detail}`;
}

function costDetailHTML(c) {
    const rows = c.rows.map((r) => `<div class="cost-row">
        <span>${esc(r.icon)} ${esc(r.name)} <span style="color:var(--faint)">${r.qty}${r.unit}</span></span>
        <span>${r.hasData ? `${Math.round(r.kcal)} kcal · €${r.cost.toFixed(2)}` : '<span style="color:var(--faint)">dati mancanti</span>'}</span>
    </div>`).join('');
    return `<div class="cost-detail">${rows}
        <div class="cost-row sum"><span>Totale impasto</span><span>${Math.round(c.kcal)} kcal · €${c.cost.toFixed(2)}</span></div>
        ${c.missing ? `<div class="cost-missing">${c.missing} ingredient${c.missing === 1 ? 'e' : 'i'} senza prezzo o calorie. Completali in Strumenti per un totale esatto.</div>` : ''}
    </div>`;
}

function toggleCostDetail() {
    costOpen = !costOpen;
    renderResults();
}

function renderPriceEditor() {
    const el = $('price-editor');
    if (!el) return;
    const ings = allIngredients();
    if (!ings.length) { el.innerHTML = '<p class="card-note">Nessun ingrediente: crea prima un impasto.</p>'; return; }
    el.innerHTML = ings.map((i) => {
        const p = prices[i.id] || {};
        return `<div class="price-row">
            <span class="price-label">${esc(i.icon)} ${esc(i.name)}</span>
            <div class="price-fields">
                <input class="input sm" type="number" placeholder="kcal/100g" value="${p.cal != null && p.cal !== 0 ? p.cal : ''}" oninput="setPrice('${esc(i.id)}','cal',this.value)">
                <input class="input sm" type="number" step="0.01" placeholder="€/kg" value="${p.prezzo != null && p.prezzo !== 0 ? p.prezzo : ''}" oninput="setPrice('${esc(i.id)}','prezzo',this.value)">
            </div>
        </div>`;
    }).join('');
}

let priceSaveTimer = null;
function setPrice(id, key, value) {
    if (!prices[id]) prices[id] = {};
    prices[id][key] = num(value);
    clearTimeout(priceSaveTimer);
    priceSaveTimer = setTimeout(async () => {
        try { await Store.setDoc('prices', { items: prices }); } catch (e) {}
    }, 600);
}

/* ── 8. SALVATAGGIO E STORICO ─────────────────────────────────────── */

let historyCache = [];
let historyQuery = '';
let editingEntryId = null;

/** Precompila "palline in frigo" con quelle già presenti per questo impasto. */
function syncSaveCassetti() {
    const el = $('save-cassetti');
    if (!el || !lastCalc) return;
    if (document.activeElement === el) return;
    el.value = String(countInFrigoByType(lastCalc.type));
}

async function confirmSave() {
    if (!lastCalc || !requireWritable()) return;
    const btn = $('btn-save');
    const now = new Date();
    const declared = Math.max(0, Math.round(num($('save-cassetti').value)));
    const entry = {
        id: now.getTime(),
        date: $('save-date').value || todayStr(),
        time: now.toTimeString().slice(0, 5),
        type: lastCalc.type,
        recipeId: lastCalc.recipeId,
        palline: lastCalc.palline,
        ballWeight: lastCalc.ballWeight,
        cassetti: declared,
        note: $('save-note').value.trim()
    };

    btn.textContent = 'Salvataggio...'; btn.disabled = true;
    try {
        await Store.setItem('history', entry.id, entry);
        // Allinea il frigo: se dichiari meno palline di quelle registrate, consuma le più vecchie
        const actual = countInFrigoByType(entry.type);
        if (declared < actual) {
            await consumeOldestByType(entry.type, actual - declared, `allineamento: dichiarate ${declared}, presenti ${actual}`);
        }
        await createBatchFromCalc(entry);
        btn.textContent = '✅ Salvato!';
        toast('Impasto salvato nello storico e nel frigo');
    } catch (e) {
        btn.textContent = '❌ Errore — riprova';
        btn.disabled = false;
        console.warn(e);
    }
}

function matchesQuery(e, q) {
    if (!q) return true;
    return [e.type, e.note, e.date, fmtDate(e.date), String(e.palline)]
        .filter(Boolean).join(' ').toLowerCase().includes(q);
}

function renderStorico() {
    const list = $('storico-list');
    const q = historyQuery.trim().toLowerCase();
    const h = historyCache.filter((e) => matchesQuery(e, q));

    if (!h.length) {
        list.innerHTML = `<div class="empty"><div class="empty-icon">${q ? '🔍' : '🍕'}</div>
            <p>${q ? 'Nessun impasto trovato.' : 'Nessun impasto registrato.'}</p>
            <p class="sub">${q ? 'Prova con un altro termine.' : 'Calcola una ricetta e premi Salva.'}</p></div>`;
        return;
    }

    const grouped = {};
    h.forEach((e) => { (grouped[e.date] = grouped[e.date] || []).push(e); });
    const dates = Object.keys(grouped).sort().reverse();

    list.innerHTML = dates.map((date) => {
        const items = grouped[date].slice().sort((a, b) => b.id - a.id);
        const total = items.reduce((s, i) => s + (i.palline || 0), 0);
        const entries = items.map((e) => {
            const r = recipeByName(e.type);
            const icon = r ? r.icon : '🍞';
            if (editingEntryId === e.id) return entryEditHTML(e, icon);
            return `<div class="entry">
                <div class="entry-main">
                    <div class="entry-left">
                        <span class="entry-icon">${esc(icon)}</span>
                        <div>
                            <div class="entry-type">${esc(e.type)}</div>
                            <div class="entry-time">${esc(e.time || '')}</div>
                        </div>
                    </div>
                    <div class="entry-right">
                        <div>
                            <div class="entry-count">${e.palline}</div>
                            <div class="entry-weight">palline ${e.ballWeight}g</div>
                        </div>
                        <div class="entry-actions">
                            <button class="btn btn-icon" title="Modifica" onclick="startEditEntry(${e.id})">✎</button>
                            <button class="btn btn-icon" title="Elimina" onclick="askDeleteEntry(${e.id})">✕</button>
                        </div>
                    </div>
                </div>
                ${e.cassetti ? `<div class="entry-note">🧊 ${e.cassetti} pallin${e.cassetti === 1 ? 'a' : 'e'} in frigo</div>` : ''}
                ${e.note ? `<div class="entry-note italic">📝 ${esc(e.note)}</div>` : ''}
            </div>`;
        }).join('');
        return `<div class="day-block">
            <div class="day-head"><span class="day-label">${fmtDate(date)}</span><span class="day-total">Tot: ${total} palline</span></div>
            ${entries}
        </div>`;
    }).join('');
}

function entryEditHTML(e, icon) {
    return `<div class="entry">
        <div class="entry-main">
            <div class="entry-left"><span class="entry-icon">${esc(icon)}</span><div class="entry-type">${esc(e.type)}</div></div>
        </div>
        <div class="entry-edit">
            <div class="field-row">
                <div class="field"><label class="field-label">Data</label><input class="input sm" type="date" id="edit-date" value="${esc(e.date)}"></div>
                <div class="field"><label class="field-label">Palline</label><input class="input sm" type="number" id="edit-palline" value="${e.palline}"></div>
            </div>
            <div class="field-row">
                <div class="field"><label class="field-label">In frigo</label><input class="input sm" type="number" id="edit-cassetti" value="${e.cassetti || 0}"></div>
                <div class="field"><label class="field-label">Peso pallina</label><input class="input sm" type="number" id="edit-bw" value="${e.ballWeight}"></div>
            </div>
            <div class="field"><label class="field-label">Nota</label><input class="input sm" id="edit-note" value="${esc(e.note || '')}"></div>
            <div class="btn-row">
                <button class="btn btn-outline" onclick="cancelEditEntry()">Annulla</button>
                <button class="btn btn-dark" style="margin:0;padding:11px" onclick="saveEditEntry(${e.id})">Salva</button>
            </div>
        </div>
    </div>`;
}

function startEditEntry(id) { if (!requireWritable()) return; editingEntryId = id; renderStorico(); }
function cancelEditEntry() { editingEntryId = null; renderStorico(); }

async function saveEditEntry(id) {
    const e = historyCache.find((x) => x.id === id);
    if (!e) return;
    const updated = Object.assign({}, e, {
        date: $('edit-date').value || e.date,
        palline: Math.max(0, Math.round(num($('edit-palline').value))),
        cassetti: Math.max(0, Math.round(num($('edit-cassetti').value))),
        ballWeight: Math.max(1, Math.round(num($('edit-bw').value))),
        note: $('edit-note').value.trim()
    });
    editingEntryId = null;
    try {
        await Store.setItem('history', id, updated);
        toast('Impasto aggiornato');
    } catch (err) { toast('Errore nel salvataggio'); }
    renderStorico();
}

async function askDeleteEntry(id) {
    if (!requireWritable()) return;
    const e = historyCache.find((x) => x.id === id);
    if (!e) return;
    try {
        await Store.deleteItem('history', id);
        toast(`${e.type}: ${e.palline} palline eliminate`, {
            label: 'Annulla',
            run: async () => {
                try { await Store.setItem('history', e.id, e); toast('Ripristinato'); }
                catch (err) { toast('Impossibile ripristinare'); }
            }
        });
    } catch (err) { toast('Errore nell\'eliminazione'); }
}

async function clearAllHistory() {
    if (!requireWritable()) return;
    if (!confirm('Cancellare tutto lo storico?\nIl frigo non viene toccato.')) return;
    try { await Store.clearCollection('history'); toast('Storico cancellato'); }
    catch (e) { toast('Errore: ' + e.message); }
}

function exportCSV() {
    const rows = [['Data', 'Ora', 'Tipo', 'Palline', 'Peso pallina', 'In frigo', 'Note']];
    historyCache.forEach((e) => rows.push([e.date, e.time, e.type, e.palline, e.ballWeight, e.cassetti || 0, e.note || '']));
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    downloadBlob(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }), 'pizza-lab-storico.csv');
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ── 9. GRAFICI ───────────────────────────────────────────────────── */

let chartMode = 'week';
let chartOffset = 0;
const MONTH_NAMES = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
const DAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];

/** Serie del grafico: una per ricetta, più eventuali tipi presenti solo nello storico. */
function chartSeries() {
    const series = recipes.map((r, i) => ({ key: r.name, label: r.name, color: seriesColor(i), soft: seriesColor(i, true) }));
    const known = new Set(series.map((s) => s.key.toLowerCase()));
    historyCache.forEach((e) => {
        const k = String(e.type || '').trim();
        if (k && !known.has(k.toLowerCase())) {
            known.add(k.toLowerCase());
            const i = series.length;
            series.push({ key: k, label: k, color: seriesColor(i), soft: seriesColor(i, true) });
        }
    });
    return series;
}

function getDayData(ds, series) {
    const r = { ds, byType: {}, newP: 0, frigoP: 0 };
    series.forEach((s) => { r.byType[s.key] = { neu: 0, frigo: 0 }; });
    historyCache.filter((e) => e.date === ds).forEach((e) => {
        const k = String(e.type || '').trim();
        if (!r.byType[k]) r.byType[k] = { neu: 0, frigo: 0 };
        r.byType[k].neu += e.palline || 0;
        r.byType[k].frigo += e.cassetti || 0;
        r.newP += e.palline || 0;
        r.frigoP += e.cassetti || 0;
    });
    r.total = r.newP + r.frigoP;
    return r;
}

function getConsumption(ds, series) {
    const prev = new Date(ds + 'T12:00:00');
    prev.setDate(prev.getDate() - 1);
    const today = getDayData(ds, series);
    const yest = getDayData(dateStr(prev), series);
    const byType = {};
    let total = 0;
    series.forEach((s) => {
        const t = today.byType[s.key] || { neu: 0, frigo: 0 };
        const y = yest.byType[s.key] || { neu: 0, frigo: 0 };
        const v = Math.max(0, t.neu + y.frigo - t.frigo);
        byType[s.key] = v;
        total += v;
    });
    return { ds, byType, total };
}

function stackHTML(segments) {
    return segments.filter((s) => s.val > 0)
        .map((s) => `<div style="flex:${s.val};background:${s.color}"></div>`).join('');
}

function periodDays() {
    const days = [];
    if (chartMode === 'week') {
        const base = new Date();
        base.setDate(base.getDate() + chartOffset * 7);
        const dow = (base.getDay() + 6) % 7; // lunedì = 0
        const monday = new Date(base);
        monday.setDate(base.getDate() - dow);
        for (let i = 0; i < 7; i++) {
            const d = new Date(monday);
            d.setDate(monday.getDate() + i);
            days.push({ ds: dateStr(d), label: DAY_LABELS[d.getDay()] });
        }
    } else if (chartMode === 'month') {
        const now = new Date();
        const base = new Date(now.getFullYear(), now.getMonth() + chartOffset, 1);
        const dim = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
        for (let i = 1; i <= dim; i++) {
            const d = new Date(base.getFullYear(), base.getMonth(), i);
            days.push({ ds: dateStr(d), label: i % 5 === 0 || i === 1 ? String(i) : '' });
        }
    }
    return days;
}

function periodTitle() {
    const now = new Date();
    if (chartMode === 'week') {
        const days = periodDays();
        const a = new Date(days[0].ds + 'T12:00:00');
        const b = new Date(days[6].ds + 'T12:00:00');
        const f = (d) => `${d.getDate()} ${MONTH_NAMES[d.getMonth()].slice(0, 3)}`;
        return `${f(a)} – ${f(b)} ${b.getFullYear()}`;
    }
    if (chartMode === 'month') {
        const base = new Date(now.getFullYear(), now.getMonth() + chartOffset, 1);
        return `${MONTH_NAMES[base.getMonth()]} ${base.getFullYear()}`;
    }
    return String(now.getFullYear() + chartOffset);
}

function setChartMode(mode, btn) {
    chartMode = mode; chartOffset = 0;
    $$('#chart-tabs .segment').forEach((t) => t.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderCharts();
}
function chartNavigate(dir) { chartOffset += dir; renderCharts(); }

function renderCharts() {
    const series = chartSeries();
    $('chart-nav-title').textContent = periodTitle();

    const legend = (soft) => series.map((s) =>
        `<span><span class="legend-dot" style="background:${s.color}"></span>${esc(s.label)}${soft ? ' nuove' : ''}</span>`).join('')
        + (soft ? series.map((s) => `<span><span class="legend-dot" style="background:${s.soft}"></span>${esc(s.label)} frigo</span>`).join('') : '');
    $('chart-legend').innerHTML = legend(true);
    $('cons-legend').innerHTML = legend(false);

    if (chartMode === 'year') { renderYear(series); return; }

    const days = periodDays();
    const data = days.map((d) => Object.assign(getDayData(d.ds, series), { label: d.label }));
    const max = Math.max.apply(null, data.map((d) => d.total).concat([1]));
    const tds = todayStr();

    $('main-chart').innerHTML = data.map((d) => {
        const pct = Math.max((d.total / max) * 100, d.total ? 4 : 1);
        const segs = series.map((s) => ({ val: (d.byType[s.key] || {}).neu || 0, color: s.color }))
            .concat(series.map((s) => ({ val: (d.byType[s.key] || {}).frigo || 0, color: s.soft })));
        const today = d.ds === tds;
        return `<div class="chart-col" title="${d.ds}"><div class="chart-cnt">${d.total || ''}</div>
            <div class="chart-stack" style="height:${pct}%">${stackHTML(segs)}</div>
            <div class="chart-day${today ? ' is-today' : ''}">${d.label}</div></div>`;
    }).join('');

    const cons = days.map((d) => Object.assign(getConsumption(d.ds, series), { label: d.label }));
    const cmax = Math.max.apply(null, cons.map((d) => d.total).concat([1]));
    $('cons-chart').innerHTML = cons.map((d) => {
        const pct = Math.max((d.total / cmax) * 100, d.total ? 4 : 1);
        const segs = series.map((s) => ({ val: d.byType[s.key] || 0, color: s.color }));
        const today = d.ds === tds;
        return `<div class="chart-col" title="${d.ds}"><div class="chart-cnt">${d.total || ''}</div>
            <div class="chart-stack" style="height:${pct}%">${stackHTML(segs)}</div>
            <div class="chart-day${today ? ' is-today' : ''}">${d.label}</div></div>`;
    }).join('');

    const totNew = data.reduce((s, d) => s + d.newP, 0);
    const totFrigo = data.reduce((s, d) => s + d.frigoP, 0);
    const active = data.filter((d) => d.total > 0).length;
    $('chart-stats').innerHTML = `
        <div class="stat"><div class="stat-val" style="color:${series[0] ? series[0].color : 'inherit'}">${totNew}</div><div class="stat-label">Palline nuove</div></div>
        <div class="stat"><div class="stat-val">${totFrigo}</div><div class="stat-label">Palline frigo</div></div>
        <div class="stat"><div class="stat-val">${active}</div><div class="stat-label">Giorni attivi</div></div>`;

    const consTot = {};
    series.forEach((s) => { consTot[s.key] = cons.reduce((a, d) => a + (d.byType[s.key] || 0), 0); });
    $('cons-stats').innerHTML = series.slice(0, 3).map((s) =>
        `<div class="stat"><div class="stat-val" style="color:${s.color}">${consTot[s.key]}</div><div class="stat-label">${esc(s.label)}</div></div>`).join('');
}

function renderYear(series) {
    const year = new Date().getFullYear() + chartOffset;
    const months = [];
    for (let m = 0; m < 12; m++) {
        const dim = new Date(year, m + 1, 0).getDate();
        const agg = { byType: {}, newP: 0, frigoP: 0 };
        series.forEach((s) => { agg.byType[s.key] = { neu: 0, frigo: 0 }; });
        for (let d = 1; d <= dim; d++) {
            const day = getDayData(dateStr(new Date(year, m, d)), series);
            series.forEach((s) => {
                agg.byType[s.key].neu += day.byType[s.key].neu;
                agg.byType[s.key].frigo += day.byType[s.key].frigo;
            });
            agg.newP += day.newP; agg.frigoP += day.frigoP;
        }
        agg.total = agg.newP + agg.frigoP;
        months.push(Object.assign(agg, { label: MONTH_NAMES[m].slice(0, 3), m }));
    }
    const max = Math.max.apply(null, months.map((m) => m.total).concat([1]));
    const cur = new Date();
    $('main-chart').innerHTML = months.map((mo) => {
        const pct = Math.max((mo.total / max) * 100, mo.total ? 4 : 1);
        const segs = series.map((s) => ({ val: mo.byType[s.key].neu, color: s.color }))
            .concat(series.map((s) => ({ val: mo.byType[s.key].frigo, color: s.soft })));
        const isCur = mo.m === cur.getMonth() && year === cur.getFullYear();
        return `<div class="chart-col" onclick="jumpToMonth(${year},${mo.m})"><div class="chart-cnt">${mo.total || ''}</div>
            <div class="chart-stack" style="height:${pct}%">${stackHTML(segs)}</div>
            <div class="chart-day${isCur ? ' is-today' : ''}">${mo.label}</div></div>`;
    }).join('');

    const consMonths = months.map((mo) => {
        const byType = {};
        let total = 0;
        series.forEach((s) => {
            const v = Math.max(0, mo.byType[s.key].neu);
            byType[s.key] = v; total += v;
        });
        return { byType, total, label: mo.label };
    });
    const cmax = Math.max.apply(null, consMonths.map((m) => m.total).concat([1]));
    $('cons-chart').innerHTML = consMonths.map((mo) => {
        const pct = Math.max((mo.total / cmax) * 100, mo.total ? 4 : 1);
        const segs = series.map((s) => ({ val: mo.byType[s.key], color: s.color }));
        return `<div class="chart-col"><div class="chart-cnt">${mo.total || ''}</div>
            <div class="chart-stack" style="height:${pct}%">${stackHTML(segs)}</div>
            <div class="chart-day">${mo.label}</div></div>`;
    }).join('');

    const totNew = months.reduce((s, m) => s + m.newP, 0);
    const totFrigo = months.reduce((s, m) => s + m.frigoP, 0);
    const active = months.filter((m) => m.total > 0).length;
    $('chart-stats').innerHTML = `
        <div class="stat"><div class="stat-val" style="color:${series[0] ? series[0].color : 'inherit'}">${totNew}</div><div class="stat-label">Palline nuove</div></div>
        <div class="stat"><div class="stat-val">${totFrigo}</div><div class="stat-label">Palline frigo</div></div>
        <div class="stat"><div class="stat-val">${active}</div><div class="stat-label">Mesi attivi</div></div>`;
    $('cons-stats').innerHTML = series.slice(0, 3).map((s, i) =>
        `<div class="stat"><div class="stat-val" style="color:${s.color}">${consMonths.reduce((a, m) => a + m.byType[s.key], 0)}</div><div class="stat-label">${esc(s.label)}</div></div>`).join('');
}

function jumpToMonth(year, m) {
    const now = new Date();
    chartMode = 'month';
    chartOffset = (year - now.getFullYear()) * 12 + (m - now.getMonth());
    $$('#chart-tabs .segment').forEach((t, i) => t.classList.toggle('active', i === 1));
    renderCharts();
}

/* ── 10. FRIGO ────────────────────────────────────────────────────── */

let batches = [];

function daysAgo(iso) {
    const n = new Date(); n.setHours(0, 0, 0, 0);
    const t = new Date(iso); t.setHours(0, 0, 0, 0);
    return Math.max(0, Math.round((n - t) / 86400000));
}
function ageLabel(iso) {
    const d = daysAgo(iso);
    return d === 0 ? 'Oggi' : d === 1 ? '1 giorno fa' : d + ' giorni fa';
}
function ageBucket(iso) {
    const d = daysAgo(iso);
    return d === 0 ? '0' : d === 1 ? '1' : d === 2 ? '2' : '3+';
}
function normType(t) { return String(t || '').trim().toLowerCase(); }

function countInFrigoByType(type) {
    const n = normType(type);
    let c = 0;
    batches.forEach((b) => {
        if (normType(b.type) !== n) return;
        (b.balls || []).forEach((ball) => { if (ball.status === 'in_frigo') c++; });
    });
    return c;
}

function batchColor(type) {
    const i = recipes.findIndex((r) => normType(r.name) === normType(type));
    return i >= 0 ? seriesColor(i) : 'var(--faint)';
}

async function createBatchFromCalc(entry) {
    const qty = parseInt(entry.palline, 10) || 0;
    if (qty <= 0) return;
    const now = new Date().toISOString();
    const balls = [];
    for (let i = 0; i < qty; i++) balls.push({ id: 'b' + uid(), createdAt: now, status: 'in_frigo' });
    const batch = {
        id: 'b' + uid(), createdAt: now, type: entry.type, ballWeight: entry.ballWeight || 0,
        note: entry.note || '', source: 'calcolo', balls: balls
    };
    await Store.setItem('batches', batch.id, batch);
    await Store.addLog({ at: now, kind: 'produzione', batchId: batch.id, qty: qty });
}

async function createManualBatch(type, qty, note) {
    const now = new Date().toISOString();
    const balls = [];
    for (let i = 0; i < qty; i++) balls.push({ id: 'b' + uid(), createdAt: now, status: 'in_frigo' });
    const batch = { id: 'b' + uid(), createdAt: now, type: type, ballWeight: 0, note: note || '', source: 'manuale', balls: balls };
    await Store.setItem('batches', batch.id, batch);
    await Store.addLog({ at: now, kind: 'aggiunta_manuale', batchId: batch.id, qty: qty, note: note || '' });
}

function findBatch(id) { return batches.find((b) => b.id === id); }

async function addBall(batchId) {
    if (!requireWritable()) return;
    const b = findBatch(batchId);
    if (!b) return;
    const now = new Date().toISOString();
    const ball = { id: 'b' + uid(), createdAt: now, status: 'in_frigo' };
    const updated = Object.assign({}, b, { balls: (b.balls || []).concat([ball]) });
    await Store.setItem('batches', batchId, updated);
    await Store.addLog({ at: now, kind: 'aggiunta_manuale', batchId: batchId, qty: 1 });
    buzz(15);
}

async function removeBall(batchId) {
    if (!requireWritable()) return;
    const b = findBatch(batchId);
    if (!b) return;
    const now = new Date().toISOString();
    let done = false;
    const balls = (b.balls || []).map((ball) => {
        if (!done && ball.status === 'in_frigo') { done = true; return Object.assign({}, ball, { status: 'consumata', consumedAt: now }); }
        return ball;
    });
    if (!done) return;
    await Store.setItem('batches', batchId, Object.assign({}, b, { balls }));
    await Store.addLog({ at: now, kind: 'consumo', batchId: batchId, qty: 1 });
    buzz(15);
}

async function consumeBall(batchId, ballId) {
    if (!requireWritable()) return;
    const b = findBatch(batchId);
    if (!b) return;
    const now = new Date().toISOString();
    const balls = (b.balls || []).map((ball) =>
        ball.id === ballId && ball.status === 'in_frigo' ? Object.assign({}, ball, { status: 'consumata', consumedAt: now }) : ball);
    await Store.setItem('batches', batchId, Object.assign({}, b, { balls }));
    await Store.addLog({ at: now, kind: 'consumo', batchId: batchId, qty: 1 });
}

async function consumeAll(batchId) {
    if (!requireWritable()) return;
    const b = findBatch(batchId);
    if (!b) return;
    const open = (b.balls || []).filter((x) => x.status === 'in_frigo');
    if (!open.length) return;
    if (!confirm(`Segnare come finite le ${open.length} palline rimanenti?`)) return;
    const now = new Date().toISOString();
    const balls = (b.balls || []).map((ball) =>
        ball.status === 'in_frigo' ? Object.assign({}, ball, { status: 'consumata', consumedAt: now }) : ball);
    await Store.setItem('batches', batchId, Object.assign({}, b, { balls }));
    await Store.addLog({ at: now, kind: 'consumo', batchId: batchId, qty: open.length });
}

async function deleteBatch(batchId) {
    if (!requireWritable()) return;
    const b = findBatch(batchId);
    if (!b) return;
    if (!confirm('Eliminare definitivamente questo batch?')) return;
    const open = (b.balls || []).filter((x) => x.status === 'in_frigo').length;
    await Store.addLog({ at: new Date().toISOString(), kind: 'rimozione_manuale', batchId: batchId, qty: open, note: 'batch eliminato' });
    await Store.deleteItem('batches', batchId);
    toast('Batch eliminato', {
        label: 'Annulla',
        run: async () => { try { await Store.setItem('batches', b.id, b); toast('Batch ripristinato'); } catch (e) {} }
    });
}

/** Consuma le palline più vecchie di un tipo: usata per allineare il frigo al salvataggio. */
async function consumeOldestByType(type, qty, note) {
    const n = normType(type);
    let remaining = qty;
    const sorted = batches.slice().sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    for (const b of sorted) {
        if (remaining <= 0) break;
        if (normType(b.type) !== n) continue;
        let changed = 0;
        const balls = (b.balls || []).map((ball) => {
            if (remaining > 0 && ball.status === 'in_frigo') {
                remaining--; changed++;
                return Object.assign({}, ball, { status: 'consumata', consumedAt: new Date().toISOString() });
            }
            return ball;
        });
        if (changed) {
            await Store.setItem('batches', b.id, Object.assign({}, b, { balls }));
            await Store.addLog({ at: new Date().toISOString(), kind: 'consumo', batchId: b.id, qty: changed, note: note || 'allineamento' });
        }
    }
    return qty - remaining;
}

function toggleBalls(id) {
    const el = $('balls-' + id);
    if (el) el.classList.toggle('hidden');
}

function renderFrigo() {
    const el = $('frigo-body');
    if (!el) return;

    let total = 0;
    const byAge = { '0': 0, '1': 0, '2': 0, '3+': 0 };
    batches.forEach((b) => (b.balls || []).forEach((ball) => {
        if (ball.status === 'in_frigo') { total++; byAge[ageBucket(ball.createdAt)]++; }
    }));

    const visible = batches.slice()
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
        .filter((b) => (b.balls || []).some((x) => x.status === 'in_frigo'));

    let html = `<div class="frigo-summary">
        <div class="frigo-total"><div class="frigo-total-num">${total}</div><div class="frigo-total-label">palline nel frigo</div></div>
        <div class="frigo-ages">
            <div class="frigo-age"><b>Oggi</b><span>${byAge['0']}</span></div>
            <div class="frigo-age"><b>1 gg</b><span>${byAge['1']}</span></div>
            <div class="frigo-age"><b>2 gg</b><span>${byAge['2']}</span></div>
            <div class="frigo-age"><b>3+ gg</b><span>${byAge['3+']}</span></div>
        </div>
    </div>`;

    if (!visible.length) {
        html += `<div class="empty"><div class="empty-icon">🧊</div>
            <p>Frigo vuoto.</p><p class="sub">Salva un calcolo oppure aggiungi un batch manuale.</p></div>`;
    } else {
        html += visible.map((b) => {
            const arr = b.balls || [];
            const inF = arr.filter((x) => x.status === 'in_frigo').length;
            const icon = daysAgo(b.createdAt) === 0 ? '🆕' : '🧊';
            const balls = arr.map((ball) => `<div class="ball${ball.status === 'consumata' ? ' done' : ''}">
                <span>${ball.status === 'consumata' ? '✅' : '🟢'}</span>
                <span class="ball-date">${fmtDT(ball.createdAt)}</span>
                ${ball.status === 'in_frigo' ? `<button class="ball-btn" onclick="consumeBall('${esc(b.id)}','${esc(ball.id)}')">Finita</button>` : ''}
            </div>`).join('');
            return `<div class="batch" style="--recipe-color:${batchColor(b.type)}">
                <div class="batch-head">
                    <div>
                        <div class="batch-type">${icon} ${esc(b.type)}${b.source === 'manuale' ? '<span class="tag">manuale</span>' : ''}</div>
                        <div class="batch-age">${ageLabel(b.createdAt)} · ${fmtDT(b.createdAt)}</div>
                    </div>
                    <div class="batch-count"><b>${inF}</b><span>/${arr.length}</span></div>
                </div>
                <div class="batch-ctrls">
                    <button class="btn minus" onclick="removeBall('${esc(b.id)}')">− 1</button>
                    <button class="btn plus" onclick="addBall('${esc(b.id)}')">+ 1</button>
                    <button class="btn all" onclick="consumeAll('${esc(b.id)}')">Finita</button>
                    <button class="btn" onclick="toggleBalls('${esc(b.id)}')">Dettagli</button>
                </div>
                <div class="balls hidden" id="balls-${esc(b.id)}">${balls}
                    <div style="text-align:right;margin-top:10px"><button class="ball-btn danger" onclick="deleteBatch('${esc(b.id)}')">Elimina batch</button></div>
                </div>
            </div>`;
        }).join('');
    }

    html += `<div class="btn-row" style="margin-top:16px">
        <button class="btn btn-dark" style="margin:0" onclick="openManualBatch()">＋ Batch manuale</button>
        <button class="btn btn-outline" onclick="openFrigoLog()">Log movimenti</button>
    </div>`;

    el.innerHTML = html;
}

function openManualBatch() {
    if (!requireWritable()) return;
    const opts = recipes.map((r) => `<option value="${esc(r.name)}">${esc(r.icon)} ${esc(r.name)}</option>`).join('');
    openModal(`<h3>Aggiungi batch manuale</h3>
        <div class="field"><label class="field-label">Tipo impasto</label><select class="select" id="man-type">${opts}<option value="__altro__">Altro…</option></select></div>
        <div class="field hidden" id="man-other-wrap"><label class="field-label">Nome impasto</label><input class="input" id="man-other"></div>
        <div class="field"><label class="field-label">Quantità palline</label><input class="input" type="number" id="man-qty" min="1" value="1" inputmode="numeric"></div>
        <div class="field"><label class="field-label">Nota (opzionale)</label><input class="input" id="man-note"></div>
        <div class="modal-actions">
            <button class="btn btn-outline" onclick="closeModal('modal-manual')">Annulla</button>
            <button class="btn btn-dark" style="width:auto;padding:10px 20px;margin:0" onclick="submitManualBatch()">Aggiungi</button>
        </div>`, 'modal-manual');
    $('man-type').onchange = function () { $('man-other-wrap').classList.toggle('hidden', this.value !== '__altro__'); };
}

async function submitManualBatch() {
    const sel = $('man-type').value;
    const type = sel === '__altro__' ? $('man-other').value.trim() : sel;
    const qty = parseInt($('man-qty').value, 10);
    const note = $('man-note').value.trim();
    if (!type) { alert('Indica il tipo di impasto'); return; }
    if (!qty || qty <= 0) { alert('Quantità non valida'); return; }
    closeModal('modal-manual');
    try { await createManualBatch(type, qty, note); toast(`${qty} palline aggiunte al frigo`); }
    catch (e) { toast('Errore: ' + e.message); }
}

async function openFrigoLog() {
    let entries = [];
    try { entries = await Store.getLog(50); } catch (e) {}
    const LABELS = { produzione: '🔵 Produzione', consumo: '🟠 Consumo', aggiunta_manuale: '🟢 Aggiunta', rimozione_manuale: '🔴 Rimozione', correzione: '⚙️ Correzione' };
    const rows = entries.length
        ? entries.map((e) => `<div class="log-entry">${LABELS[e.kind] || esc(e.kind)} · <b>${e.qty || e.count || 0}</b> palline · ${fmtDT(e.at)}${e.note ? ' · ' + esc(e.note) : ''}</div>`).join('')
        : '<p class="card-note">Nessun movimento registrato.</p>';
    openModal(`<h3>Log movimenti</h3><div style="max-height:55vh;overflow:auto">${rows}</div>
        <div class="modal-actions"><button class="btn btn-outline" onclick="closeModal('modal-log')">Chiudi</button></div>`, 'modal-log');
}

/* ── 11. STRUMENTI ────────────────────────────────────────────────── */

function calcTemp() {
    const ta = num($('temp-ambiente').value, 20);
    const tf = num($('temp-farina').value, 20);
    const tw = 72 - ta - tf;
    let cls = 'ok', icon = '✅', note = 'Temperatura ideale per un impasto a 24°C.';
    if (tw < 4) { cls = 'cold'; icon = '🧊'; note = 'Usa acqua ghiacciata.'; }
    else if (tw < 10) { cls = 'cold'; icon = '❄️'; note = 'Usa acqua fredda da frigo.'; }
    else if (tw > 35) { cls = 'warm'; icon = '⚠️'; note = 'Troppo alta: rischia di compromettere il lievito.'; }
    else if (tw > 25) { cls = 'warm'; icon = '🌡️'; note = 'Leggermente alta. Usa acqua più fresca.'; }
    $('temp-result').innerHTML = `<div class="temp-result ${cls}">
        <div class="temp-label">Temperatura acqua consigliata</div>
        <div class="temp-big">${icon} ${tw.toFixed(1)}°C</div>
        <div class="temp-note">${note}</div></div>`;
}

/* — Preset — */

function renderPresetBar() {
    const el = $('preset-bar');
    if (!el) return;
    const list = presets[currentRecipeId] || [];
    el.innerHTML = list.map((p, i) => `<span class="chip" onclick="applyPreset(${i})">
        ${esc(p.name)}<span class="chip-x" onclick="event.stopPropagation();deletePreset(${i})">✕</span></span>`).join('');
}

async function savePreset() {
    if (!requireWritable()) return;
    const name = prompt('Nome del preset:');
    if (!name || !name.trim()) return;
    const qty = {};
    readFormQuantities().forEach((i) => { qty[i.id] = i.qty; });
    if (!presets[currentRecipeId]) presets[currentRecipeId] = [];
    presets[currentRecipeId].push({ name: name.trim(), qty });
    try { await Store.setDoc('presets', presets); renderPresetBar(); renderAllPresets(); toast('Preset salvato'); }
    catch (e) { toast('Errore nel salvataggio'); }
}

function applyPreset(i) {
    const p = (presets[currentRecipeId] || [])[i];
    if (!p) return;
    Object.keys(p.qty).forEach((ingId) => {
        const f = $('ing-' + ingId);
        if (f) f.value = p.qty[ingId];
    });
    toast(`Preset "${p.name}" applicato`);
}

async function deletePreset(i) {
    if (!requireWritable()) return;
    const list = presets[currentRecipeId] || [];
    if (!list[i]) return;
    if (!confirm(`Eliminare il preset "${list[i].name}"?`)) return;
    list.splice(i, 1);
    try { await Store.setDoc('presets', presets); } catch (e) {}
    renderPresetBar(); renderAllPresets();
}

function renderAllPresets() {
    const el = $('all-presets');
    if (!el) return;
    const all = [];
    Object.keys(presets).forEach((rid) => {
        const r = getRecipe(rid);
        (presets[rid] || []).forEach((p, i) => all.push({ recipe: r ? r.name : rid, icon: r ? r.icon : '🍞', rid, i, name: p.name }));
    });
    if (!all.length) { el.innerHTML = '<p class="card-note" style="margin:0">Nessun preset. Vai su un impasto e premi "Salva preset".</p>'; return; }
    el.innerHTML = all.map((p) => `<div class="recipe-row">
        <span class="recipe-row-icon">${esc(p.icon)}</span>
        <div class="recipe-row-main"><div class="recipe-row-name">${esc(p.name)}</div><div class="recipe-row-meta">${esc(p.recipe)}</div></div>
        <button class="btn btn-icon" onclick="deletePresetFrom('${esc(p.rid)}',${p.i})">✕</button>
    </div>`).join('');
}

async function deletePresetFrom(rid, i) {
    if (!requireWritable()) return;
    const list = presets[rid] || [];
    if (!list[i]) return;
    if (!confirm(`Eliminare il preset "${list[i].name}"?`)) return;
    list.splice(i, 1);
    try { await Store.setDoc('presets', presets); } catch (e) {}
    renderAllPresets(); renderPresetBar();
}

/* — Backup — */

async function exportBackup() {
    let log = [];
    try { log = await Store.getLog(200); } catch (e) {}
    const data = {
        app: 'pizza-lab-pro', version: 1, exportedAt: new Date().toISOString(),
        recipes, presets, prices, history: historyCache, batches, frigoLog: log
    };
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
        `pizza-lab-backup-${todayStr()}.json`);
    toast('Backup scaricato');
}

function pickBackupFile() {
    if (!requireWritable()) return;
    $('backup-file').click();
}

async function importBackup(input) {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); }
    catch (e) { alert('File non valido.'); return; }
    if (!data || data.app !== 'pizza-lab-pro') {
        if (!confirm('Questo file non sembra un backup di Pizza Lab. Provo lo stesso?')) return;
    }
    const counts = [
        data.history ? `${data.history.length} impasti` : null,
        data.batches ? `${data.batches.length} batch in frigo` : null,
        data.recipes ? `${data.recipes.length} ricette` : null
    ].filter(Boolean).join(', ');
    if (!confirm(`Ripristinare il backup?\n\nContiene: ${counts}.\n\nI dati attuali di storico e frigo verranno sostituiti.`)) return;

    try {
        if (Array.isArray(data.recipes) && data.recipes.length) { recipes = data.recipes; await persistRecipes(); }
        if (data.presets) { presets = data.presets; await Store.setDoc('presets', presets); }
        if (data.prices) { prices = data.prices; await Store.setDoc('prices', { items: prices }); }
        if (Array.isArray(data.history)) {
            await Store.clearCollection('history');
            for (const e of data.history) await Store.setItem('history', e.id, e);
        }
        if (Array.isArray(data.batches)) {
            await Store.clearCollection('batches');
            for (const b of data.batches) await Store.setItem('batches', b.id, b);
        }
        currentRecipeId = recipes[0] ? recipes[0].id : null;
        renderRecipeTabs(); renderRecipeForm(); renderRecipeList(); renderPriceEditor(); renderAllPresets();
        toast('Backup ripristinato');
    } catch (e) {
        alert('Errore nel ripristino: ' + e.message);
    }
}

/* ── 12. CONDIVISIONE IMMAGINE ────────────────────────────────────── */

const SHARE_PALETTE = {
    punk:    { bg: '#0f172a', card: '#1b2437', ink: '#ffffff', muted: '#94a3b8', accent: '#a855f7', line: '#2a3348' },
    minimal: { bg: '#f6f3ee', card: '#ffffff', ink: '#1c1917', muted: '#8b8479', accent: '#d9532f', line: '#e9e4dc' },
    forno:   { bg: '#14100e', card: '#1f1a17', ink: '#f5ead8', muted: '#b3a390', accent: '#f5a524', line: '#362d28' }
};

function buildShareCanvas() {
    const c = lastCalc;
    const p = SHARE_PALETTE[currentTheme()] || SHARE_PALETTE.punk;
    const W = 1080;
    const rowH = 92;
    const H = 420 + c.ingredients.length * rowH + 190;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const x = cv.getContext('2d');

    const body = "'Inter', 'Poppins', -apple-system, sans-serif";
    const disp = currentTheme() === 'minimal' ? "'Fraunces', Georgia, serif"
        : currentTheme() === 'forno' ? "'Space Grotesk', 'Inter', sans-serif" : "'Poppins', sans-serif";

    x.fillStyle = p.bg; x.fillRect(0, 0, W, H);

    // Intestazione
    x.fillStyle = p.accent;
    x.font = `700 30px ${body}`;
    x.fillText('PIZZA LAB PRO', 64, 92);
    x.fillStyle = p.ink;
    x.font = `700 76px ${disp}`;
    x.fillText(`${c.icon} ${c.type}`, 64, 182);
    x.fillStyle = p.muted;
    x.font = `400 34px ${body}`;
    const sub = `${c.palline} palline da ${c.ballWeight}g` + (c.hydration != null ? `  ·  idratazione ${c.hydration.toFixed(1)}%` : '');
    x.fillText(sub, 64, 234);

    // Riga divisoria
    x.strokeStyle = p.line; x.lineWidth = 2;
    x.beginPath(); x.moveTo(64, 286); x.lineTo(W - 64, 286); x.stroke();

    // Ingredienti
    let y = 286;
    x.font = `600 28px ${body}`;
    x.fillStyle = p.muted;
    x.fillText('INGREDIENTI', 64, y + 54);
    y += 96;

    c.ingredients.forEach((ing) => {
        x.fillStyle = p.card;
        roundRect(x, 64, y, W - 128, rowH - 16, 20);
        x.fill();
        x.fillStyle = p.ink;
        x.font = `500 36px ${body}`;
        x.fillText(`${ing.icon} ${ing.name}`, 100, y + 50);
        x.font = `700 40px ${disp}`;
        x.textAlign = 'right';
        x.fillText(`${fmtQty(ing.scaled, ing.unit)} ${ing.unit}`, W - 100, y + 50);
        x.textAlign = 'left';
        y += rowH;
    });

    // Totale
    y += 24;
    x.fillStyle = p.accent;
    roundRect(x, 64, y, W - 128, 108, 24);
    x.fill();
    x.fillStyle = currentTheme() === 'forno' ? '#1a1109' : '#ffffff';
    x.font = `600 30px ${body}`;
    x.fillText('PESO TOTALE', 100, y + 44);
    x.font = `700 50px ${disp}`;
    x.textAlign = 'right';
    x.fillText(`${Math.round(c.totalKg * 1000)} g`, W - 100, y + 74);
    x.textAlign = 'left';

    x.fillStyle = p.muted;
    x.font = `400 26px ${body}`;
    x.fillText(fmtDate(todayStr()) + ' · Pizza Lab Pro', 64, H - 44);

    return cv;
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

async function shareRecipe() {
    if (!lastCalc) { alert('Calcola prima una ricetta!'); return; }
    try { await document.fonts.ready; } catch (e) {}
    const canvas = buildShareCanvas();
    canvas.toBlob(async (blob) => {
        if (!blob) return;
        const file = new File([blob], `pizza-lab-${slug(lastCalc.type)}.png`, { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({ files: [file], title: `${lastCalc.type} · ${lastCalc.palline} palline` });
                return;
            } catch (e) {
                if (e && e.name === 'AbortError') return;
            }
        }
        downloadBlob(blob, file.name);
        toast('Immagine scaricata');
    }, 'image/png');
}

function printRecipe() {
    if (!lastCalc) { alert('Calcola prima una ricetta!'); return; }
    window.print();
}

/* ── 13. NAVIGAZIONE E AVVIO ──────────────────────────────────────── */

const SECTIONS = ['ricette', 'storico', 'frigo', 'strumenti'];

function showSection(name) {
    SECTIONS.forEach((s) => $('section-' + s).classList.toggle('hidden', s !== name));
    $$('.nav-item').forEach((el) => el.classList.toggle('active', el.dataset.section === name));
    window.scrollTo({ top: 0, behavior: 'auto' });
    if (name === 'storico') renderCharts();
    if (name === 'frigo') renderFrigo();
    if (name === 'strumenti') { calcTemp(); renderAllPresets(); renderThemePicker(); renderRecipeList(); renderPriceEditor(); }
}

/* — Autenticazione — */

function isIOSStandalone() { return window.navigator.standalone === true; }

function showLoginCard() {
    $('login-normal').classList.toggle('hidden', isIOSStandalone());
    $('login-ios').classList.toggle('hidden', !isIOSStandalone());
    $('login-lead').textContent = 'Accedi per ritrovare i tuoi impasti su tutti i dispositivi.';
    $('login-actions').classList.remove('hidden');
    $('overlay').classList.remove('hidden');
}

function toggleEmailForm() { $('login-form').classList.toggle('hidden'); }

function signInWithEmail() {
    const email = $('email-input').value.trim();
    const password = $('password-input').value;
    const err = $('login-err'), ok = $('login-ok');
    err.classList.add('hidden'); ok.classList.add('hidden');
    if (!email || !password) { err.textContent = 'Inserisci email e password'; err.classList.remove('hidden'); return; }
    FB.auth.signInWithEmailAndPassword(email, password).catch((e) => {
        err.textContent = ['auth/user-not-found', 'auth/wrong-password', 'auth/invalid-credential'].includes(e.code)
            ? 'Email o password errati' : e.message;
        err.classList.remove('hidden');
    });
}

function resetEmailPassword() {
    const email = $('email-input').value.trim();
    const err = $('login-err'), ok = $('login-ok');
    err.classList.add('hidden'); ok.classList.add('hidden');
    if (!email) { err.textContent = 'Inserisci prima la tua email'; err.classList.remove('hidden'); return; }
    FB.auth.sendPasswordResetEmail(email).then(() => {
        ok.textContent = 'Email inviata! Imposta la password, poi torna qui ad accedere.';
        ok.classList.remove('hidden');
    }).catch((e) => { err.textContent = e.message; err.classList.remove('hidden'); });
}

function loginError(message) {
    const err = $('login-err');
    err.textContent = message;
    err.classList.remove('hidden');
}

function signInWithGoogle() {
    const btn = $('btn-google');
    btn.textContent = 'Accesso in corso...'; btn.disabled = true;
    $('login-err').classList.add('hidden');
    const provider = new firebase.auth.GoogleAuthProvider();
    FB.auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});
    FB.auth.signInWithPopup(provider).catch((err) => {
        btn.innerHTML = googleBtnHTML(); btn.disabled = false;
        if (!err || !err.code) return;
        if (['auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(err.code)) return;
        if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/web-storage-unsupported'].includes(err.code)) {
            FB.auth.signInWithRedirect(provider).catch((e) => loginError('Accesso non riuscito: ' + e.message));
            return;
        }
        loginError('Accesso non riuscito: ' + err.message);
    });
}

function googleBtnHTML() {
    return `<svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg> Accedi con Google`;
}

function signOutUser() {
    if (!confirm('Vuoi uscire dall\'account?')) return;
    Store.stop();
    FB.auth.signOut();
}

/** Copia i dati salvati dalla vecchia versione a codice condiviso. */
async function migrateOldData(uid) {
    const OLD_CODE = 'macmiller96';
    const key = 'pizzalab_migrated_' + uid;
    if (lsGet(key)) return;
    try {
        const oldHistory = await FB.db.collection('users').doc(OLD_CODE).collection('history').get();
        if (!oldHistory.empty) {
            const batch = FB.db.batch();
            oldHistory.forEach((d) => batch.set(FB.db.collection('users').doc(uid).collection('history').doc(d.id), d.data()));
            await batch.commit();
        }
        const oldPresets = await FB.db.collection('users').doc(OLD_CODE).collection('data').doc('presets').get();
        if (oldPresets.exists) await FB.db.collection('users').doc(uid).collection('data').doc('presets').set(oldPresets.data());
        lsSet(key, '1');
    } catch (e) { console.warn('Migrazione saltata:', e); }
}

/* — Bootstrap — */

let listenersWired = false;
function wireDataListeners() {
    if (listenersWired) { Store.emit('history'); Store.emit('batches'); return; }
    listenersWired = true;
    Store.watch('history', (list) => {
        historyCache = list.slice().sort((a, b) => a.id - b.id);
        if (!$('section-storico').classList.contains('hidden')) { renderCharts(); renderStorico(); }
        else renderStorico();
    });
    Store.watch('batches', (list) => {
        batches = list;
        if (!$('section-frigo').classList.contains('hidden')) renderFrigo();
        syncSaveCassetti();
    });
}

async function bootData() {
    await loadRecipes();
    loadPresets();
    loadPrices();
    // Prezzi salvati in locale dalla versione precedente: li porto una volta sola sull'account
    if (!Store.getDoc('prices') && Object.keys(prices).length && Store.writable) {
        try { await Store.setDoc('prices', { items: prices }); } catch (e) {}
    }
    renderRecipeTabs();
    renderRecipeForm();
    renderStorico();
    calcTemp();
}

async function startLocalMode(reason) {
    $('overlay').classList.add('hidden');
    Store.startLocal();
    setSyncStatus('local');
    $('account-box').innerHTML = `<p class="card-note" style="margin:0 0 12px">${esc(reason)}</p>
        ${FB ? '<button class="btn btn-outline" onclick="location.reload()">Accedi con un account</button>' : ''}`;
    await bootData();
    wireDataListeners();
}

async function startOfflineMode() {
    $('overlay').classList.add('hidden');
    Store.startOffline();
    setSyncStatus('offline');
    $('offline-banner').classList.remove('hidden');
    $('account-box').innerHTML = `<p class="card-note" style="margin:0">Non è stato possibile contattare il server. Vedi l'ultima copia salvata su questo dispositivo; le modifiche sono disattivate finché non torni online.</p>`;
    await bootData();
    wireDataListeners();
}

async function startCloudMode(user) {
    $('overlay').classList.add('hidden');
    setSyncStatus('loading');
    $('account-box').innerHTML = `
        <div class="account-row">
            ${user.photoURL ? `<img class="avatar" src="${esc(user.photoURL)}" alt="">` : ''}
            <div>
                <div class="account-name">${esc(user.displayName || 'Account')}</div>
                <div class="account-mail">${esc(user.email || '')}</div>
            </div>
        </div>
        <button class="btn btn-danger" onclick="signOutUser()">Esci dall'account</button>`;
    await migrateOldData(user.uid);
    await Store.startCloud(user);
    await bootData();
    wireDataListeners();
}

function enterDemoMode() {
    startLocalMode('Stai usando l\'app senza account: i dati restano su questo dispositivo e non vengono sincronizzati.');
}

function boot() {
    // Tema il prima possibile per non far lampeggiare i colori sbagliati
    applyTheme(lsGet(THEME_KEY) || 'punk', false);
    $('btn-google').innerHTML = googleBtnHTML();

    $$('.nav-item').forEach((el) => { el.onclick = () => showSection(el.dataset.section); });
    $('history-search').oninput = function () { historyQuery = this.value; renderStorico(); };

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(() => {});
        // Quando una versione nuova prende il controllo ricarico una volta sola,
        // così l'aggiornamento arriva senza chiedere un refresh forzato
        let reloading = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (reloading) return;
            reloading = true;
            location.reload();
        });
    }

    if (!FB) {
        // L'SDK non si è caricato: probabilmente siamo offline
        if (lsGet('pizzalab_last_uid')) startOfflineMode();
        else startLocalMode('Nessuna connessione al server. Stai usando l\'app in locale su questo dispositivo.');
        return;
    }

    let authResolved = false;
    FB.auth.onAuthStateChanged((user) => {
        authResolved = true;
        if (user) startCloudMode(user);
        else { Store.stop(); showLoginCard(); }
    }, (err) => {
        authResolved = true;
        showLoginCard();
        loginError('Il server di accesso non risponde: ' + (err && err.message ? err.message : 'errore sconosciuto'));
    });

    // Se l'autenticazione non risponde entro pochi secondi mostro comunque i pulsanti:
    // meglio una schermata usabile che un "Caricamento" infinito
    setTimeout(() => {
        if (authResolved) return;
        showLoginCard();
        loginError('Il server di accesso non risponde. Controlla la connessione e riprova, oppure usa l\'app senza account.');
    }, 7000);

    FB.auth.getRedirectResult().catch((err) => {
        if (err && err.code) {
            console.warn('Redirect login:', err.code);
            showLoginCard();
            loginError('Accesso non riuscito: ' + err.message);
        }
    });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
