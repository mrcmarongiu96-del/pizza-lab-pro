/* Pure calculations and validation, shared by the app and regression tests. */
'use strict';
const Lab = (() => {
    const MAX_BALLS = 3000;
    const copy = (x) => JSON.parse(JSON.stringify(x));
    function number(v, label, min = 0, max = 1000000, integer = false) {
        const n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'));
        if (v === '' || v == null || !Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
            throw new Error(`${label}: inserisci ${integer ? 'un intero' : 'un numero'} tra ${min} e ${max}.`);
        }
        return n;
    }
    function date(v, label = 'Data') {
        if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v) throw new Error(`${label} non valida.`);
        return v;
    }
    function iso(v, label = 'Data e ora') {
        if (typeof v !== 'string' || !Number.isFinite(Date.parse(v))) throw new Error(`${label} non valida.`);
        return v;
    }
    function id(v) { if (typeof v !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(v) || ['__proto__', 'constructor', 'prototype'].includes(v)) throw new Error('Identificativo non valido.'); return v; }
    function text(v, label, max = 2000) { if (typeof v !== 'string' || v.length > max) throw new Error(`${label} non valido.`); return v; }
    const kg = (i, key = 'qty') => i.unit === 'g' ? i[key] / 1000 : i[key];
    function recipe(r) {
        id(r.id); text(r.name, 'Nome', 100); if (!r.name.trim()) throw new Error('Nome ricetta mancante.');
        if (r.aliases) { if (!Array.isArray(r.aliases)) throw new Error('Alias non validi.'); r.aliases.forEach(name => text(name, 'Nome precedente', 100)); }
        text(r.icon || '', 'Icona', 20); number(r.ballWeight, 'Peso pallina', 1, 5000);
        if (!Array.isArray(r.ingredients) || !r.ingredients.length || r.ingredients.length > 100) throw new Error('Ingredienti non validi.');
        const ids = new Set();
        for (const i of r.ingredients) {
            id(i.id); if (ids.has(i.id)) throw new Error('Ingredienti duplicati.'); ids.add(i.id);
            text(i.name, 'Ingrediente', 100); text(i.icon || '', 'Icona', 20);
            if (!['kg', 'g'].includes(i.unit)) throw new Error('Unità non valida.');
            number(i.qty, 'Dose', 0, 100000);
        }
        if (!(r.ingredients.reduce((s, i) => s + kg(i), 0) > 0)) throw new Error('Inserisci almeno una dose positiva.');
        return r;
    }
    function scale(r, ingredients, balls) {
        recipe({ ...r, ingredients }); number(balls, 'Palline', 1, MAX_BALLS, true);
        const total = ingredients.reduce((s, i) => s + kg(i), 0);
        const factor = balls * r.ballWeight / 1000 / total;
        const scaled = ingredients.map(i => ({ ...i, scaled: i.qty * factor }));
        const flour = scaled.filter(i => i.flour).reduce((s, i) => s + kg(i, 'scaled'), 0);
        const water = scaled.filter(i => i.water).reduce((s, i) => s + kg(i, 'scaled'), 0);
        return { recipeId: r.id, type: r.name, icon: r.icon || '🍕', ballWeight: r.ballWeight, palline: balls, totalKg: balls * r.ballWeight / 1000, hydration: flour > 0 ? water / flour * 100 : null, ingredients: scaled };
    }
    function dose(v, unit) {
        const grams = unit === 'kg' ? v * 1000 : v;
        return grams < 1000 ? { value: Number(grams.toFixed(2)).toString(), unit: 'g' } : { value: Number((grams / 1000).toFixed(3)).toString(), unit: 'kg' };
    }
    const norm = t => String(t || '').trim().toLowerCase();
    function recipeId(record, recipes) {
        if (record.recipeId) return record.recipeId;
        const match = recipes.filter(r => norm(r.name) === norm(record.type) || (r.aliases || []).some(name => norm(name) === norm(record.type)));
        return match.length === 1 ? match[0].id : null;
    }
    function key(record, recipes) { return recipeId(record, recipes) || 'legacy:' + norm(record.type); }
    function maturity(batch, at = new Date()) {
        const start = Date.parse(batch.readyAt || batch.createdAt);
        const end = batch.useBy ? Date.parse(batch.useBy) : Infinity;
        const now = +new Date(at);
        if (now < Date.parse(batch.createdAt) || now < Date.parse(batch.fridgeAt || batch.createdAt)) return 'future';
        return now < start ? 'maturing' : now > end ? 'past' : 'ready';
    }
    function plan(recipes, batches, targets, at) {
        return recipes.map(r => {
            const available = batches.filter(b => recipeId(b, recipes) === r.id && maturity(b, at) === 'ready').reduce((s, b) => s + (b.balls || []).filter(x => x.status === 'in_frigo' && Date.parse(x.createdAt) <= +new Date(at)).length, 0);
            const target = Number(targets[r.id] || 0);
            const make = Math.max(0, target - available);
            return { recipe: r, target, available, make, calculation: make ? scale(r, r.ingredients, make) : null };
        });
    }
    function move(batch, { qty, kind, ballId, at, operationId, note = '' }) {
        if (!batch) throw new Error('Lotto non più disponibile.');
        if (!['consumo', 'scarto', 'correzione'].includes(kind)) throw new Error('Movimento non valido.');
        number(qty, 'Palline', 1, MAX_BALLS, true);
        const available = batch.balls.filter(x => x.status === 'in_frigo' && (!ballId || x.id === ballId));
        if (available.length < qty) throw new Error('Le palline disponibili sono cambiate. Aggiorna la quantità.');
        const selected = available.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, qty);
        const ids = new Set(selected.map(x => x.id));
        return { ...batch, balls: batch.balls.map(x => ids.has(x.id) ? { ...x, status: kind === 'scarto' ? 'scartata' : kind === 'correzione' ? 'rettificata' : 'consumata', consumedAt: at, movementKind: kind, operationId } : x) };
    }
    function costs(calc, prices) {
        let cost = 0, kcal = 0, missingPrice = 0, missingCalories = 0;
        const rows = calc.ingredients.map(i => {
            const p = prices[i.id] || {}, grams = kg(i, 'scaled') * 1000;
            const hasPrice = typeof p.prezzo === 'number' && Number.isFinite(p.prezzo) && p.prezzo >= 0;
            const hasCalories = typeof p.cal === 'number' && Number.isFinite(p.cal) && p.cal >= 0;
            if (grams > 0) { if (!hasPrice) missingPrice++; if (!hasCalories) missingCalories++; }
            const c = hasPrice ? p.prezzo * grams / 1000 : 0, k = hasCalories ? p.cal * grams / 100 : 0;
            cost += c; kcal += k;
            const d = dose(i.scaled, i.unit);
            return { name: i.name, icon: i.icon, qty: d.value, unit: d.unit, cost: c, kcal: k, hasPrice, hasCalories };
        });
        return { rows, cost, kcal, missingPrice, missingCalories, perBallCost: cost / calc.palline, perBallKcal: kcal / calc.palline };
    }
    function stockUse(inventory, calc) {
        const next = copy(inventory || { items: {} }); next.items ||= {};
        const used = {};
        calc.ingredients.forEach(i => {
            const stock = next.items[i.id];
            if (!stock || !stock.tracked) return;
            const amount = kg(i, 'scaled');
            if (amount > stock.kg + 1e-9) throw new Error(`Scorta insufficiente: ${i.name}. Aggiorna il magazzino prima di salvare.`);
            stock.kg = Math.max(0, stock.kg - amount); used[i.id] = amount;
        });
        return { inventory: next, used };
    }
    function backup(input) {
        if (!input || input.app !== 'pizza-lab-pro' || ![1, 2].includes(input.version)) throw new Error('Formato o versione del backup non supportati.');
        const data = copy(input);
        function safe(x) { if (!x || typeof x !== 'object') return; for (const k of Object.keys(x)) { if (['__proto__', 'prototype', 'constructor'].includes(k)) throw new Error('Chiave non valida nel backup.'); safe(x[k]); } }
        safe(data);
        for (const c of ['recipes', 'history', 'batches']) if (!Array.isArray(data[c])) throw new Error(`Nel backup manca ${c}.`);
        if (!data.recipes.length) throw new Error('Il backup deve contenere almeno una ricetta.');
        const storedNumber = (v, ...args) => { if (typeof v !== 'number') throw new Error('Un valore numerico nel backup ha un formato non valido.'); return number(v, ...args); };
        data.recipes.forEach(r => { storedNumber(r.ballWeight, 'Peso', 1, 5000); r.ingredients?.forEach(i => storedNumber(i.qty, 'Dose', 0, 100000)); recipe(r); });
        const unique = (items, field) => { const seen = new Set(); for (const x of items) { const k = String(x[field]); if (seen.has(k)) throw new Error('Identificativi duplicati nel backup.'); seen.add(k); } };
        unique(data.recipes, 'id'); unique(data.history, 'id'); unique(data.batches, 'id');
        data.history.forEach(e => {
            storedNumber(e.id, 'ID produzione', 1, Number.MAX_SAFE_INTEGER, true); date(e.date); text(e.time || '', 'Ora', 10); text(e.type, 'Impasto', 100);
            if (e.recipeId) id(e.recipeId); storedNumber(e.palline, 'Palline', 0, MAX_BALLS, true); storedNumber(e.ballWeight, 'Peso', 1, 5000); storedNumber(e.cassetti || 0, 'Frigo', 0, 100000, true); text(e.note || '', 'Nota');
            if (e.snapshot) { storedNumber(e.snapshot.palline, 'Palline scheda', 1, MAX_BALLS, true); storedNumber(e.snapshot.ballWeight, 'Peso scheda', 1, 5000); storedNumber(e.snapshot.totalKg, 'Peso totale', 0); if (e.snapshot.hydration != null) storedNumber(e.snapshot.hydration, 'Idratazione', 0, 100000); recipe({ id: e.recipeId || 'archivio', name: e.type, ballWeight: e.ballWeight, ingredients: e.snapshot.ingredients }); e.snapshot.ingredients.forEach(i => storedNumber(i.scaled, 'Dose effettiva', 0, 1000000)); if (e.snapshot.prices) validatePrices(e.snapshot.prices); }
        });
        data.batches.forEach(b => {
            id(b.id); text(b.type, 'Impasto', 100); if (b.recipeId) id(b.recipeId); iso(b.createdAt); if (b.fridgeAt) iso(b.fridgeAt); if (b.readyAt) iso(b.readyAt); if (b.useBy) iso(b.useBy); text(b.note || '', 'Nota');
            storedNumber(b.ballWeight || 0, 'Peso', 0, 5000);
            if (b.useBy && Date.parse(b.useBy) < Date.parse(b.readyAt || b.createdAt)) throw new Error('Finestra di utilizzo non valida.');
            if (!Array.isArray(b.balls) || b.balls.length > MAX_BALLS) throw new Error('Palline del lotto non valide.'); unique(b.balls, 'id');
            b.balls.forEach(x => { id(x.id); iso(x.createdAt); if (!['in_frigo', 'consumata', 'scartata', 'rettificata'].includes(x.status)) throw new Error('Stato pallina non valido.'); if (x.consumedAt) iso(x.consumedAt); if (x.operationId) id(x.operationId); });
        });
        data.presets ||= {}; data.prices ||= {}; data.inventory ||= { items: {} }; data.plans ||= {}; data.frigoLog ||= [];
        validatePrices(data.prices);
        for (const [rid, list] of Object.entries(data.presets)) {
            id(rid); if (!Array.isArray(list)) throw new Error('Preset non validi.');
            list.forEach(p => { text(p.name, 'Preset', 100); if (p.id) id(p.id); const values = p.qty || p.vals; if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('Dosi preset non valide.'); for (const [k, v] of Object.entries(values)) { id(k); storedNumber(v, 'Dose preset', 0, 100000); } });
        }
        if (!data.inventory.items || typeof data.inventory.items !== 'object' || Array.isArray(data.inventory.items)) throw new Error('Magazzino non valido.');
        for (const [k, v] of Object.entries(data.inventory.items)) { id(k); storedNumber(v.kg, 'Scorta', 0); storedNumber(v.minKg || 0, 'Soglia', 0); text(v.name || k, 'Ingrediente', 100); }
        for (const [day, p] of Object.entries(data.plans)) { date(day); if (!p.targets || typeof p.targets !== 'object') throw new Error('Piano non valido.'); for (const [k, v] of Object.entries(p.targets)) { id(k); storedNumber(v, 'Obiettivo', 0, MAX_BALLS, true); } if (p.at) iso(p.at); }
        if (!Array.isArray(data.frigoLog)) throw new Error('Movimenti non validi.');
        data.frigoLog.forEach((e, i) => { e.id ||= 'import-' + i; id(e.id); iso(e.at); text(e.kind, 'Movimento', 50); storedNumber(e.qty || e.count || 0, 'Quantità', 0, 100000, true); text(e.note || '', 'Nota'); if (e.batchId) id(e.batchId); if (e.recipeId) id(e.recipeId); }); unique(data.frigoLog, 'id');
        return data;
    }
    function validatePrices(p) { if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('Prezzi non validi.'); for (const [k, v] of Object.entries(p)) { id(k); if (!v || typeof v !== 'object') throw new Error('Prezzo non valido.'); for (const f of ['prezzo', 'cal']) if (v[f] != null) { if (typeof v[f] !== 'number') throw new Error('Prezzo o calorie non numerici.'); number(v[f], f, 0); } } }
    return { MAX_BALLS, copy, number, date, iso, id, recipe, scale, dose, kg, recipeId, key, maturity, plan, move, costs, stockUse, backup };
})();
if (typeof module !== 'undefined') module.exports = Lab;
