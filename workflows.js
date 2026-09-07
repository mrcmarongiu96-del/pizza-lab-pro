/* Production planning, stock, lot movements and archived production sheets. */
'use strict';

function updateStockUnit() {
    const ing = activeRecipe()?.ingredients.find(i => i.id === $('stock-ing')?.value);
    if ($('stock-unit-hint')) $('stock-unit-hint').textContent = 'Quantità disponibile in ' + (ing?.unit || 'kg') + '.';
}
let priceWrite = Promise.resolve();
async function flushPrices() {
    clearTimeout(priceSaveTimer);
    const patch = pendingPrices; pendingPrices = {};
    if (!Object.keys(patch).length) return priceWrite;
    const epoch = Store.epoch;
    priceWrite = priceWrite.catch(() => {}).then(async () => {
        if (epoch !== Store.epoch) throw new Error('Account cambiato: prezzi non salvati.');
        await Store.updateDoc('prices', doc => {
            const items = Lab.copy(doc?.items || {});
            for (const [id, fields] of Object.entries(patch)) {
                items[id] ||= {};
                for (const [key, value] of Object.entries(fields)) { if (value === null) delete items[id][key]; else items[id][key] = value; }
            }
            return { items };
        });
    }).catch(e => {
        if (epoch === Store.epoch) for (const [id, fields] of Object.entries(patch)) pendingPrices[id] = { ...fields, ...(pendingPrices[id] || {}) };
        toast('Prezzi non salvati: ' + e.message); throw e;
    });
    return priceWrite;
}
function dataDocsChanged(name) {
    const doc = Store.getDoc('recipes');
    if (doc?.list?.length) {
        const old = JSON.stringify(getRecipe(currentRecipeId)), previous = JSON.stringify(recipes);
        recipes = doc.list;
        if (!getRecipe(currentRecipeId) && !replayRecipe) currentRecipeId = recipes[0].id;
        if (!replayRecipe && old !== JSON.stringify(getRecipe(currentRecipeId))) { clearResults(); renderRecipeForm(); }
        if (previous !== JSON.stringify(recipes)) { renderRecipeTabs(); if (!$('section-strumenti').classList.contains('hidden')) renderRecipeList(); }
    }
    loadPresets(); loadPrices();
    if (!name || name === 'presets') { renderPresetBar(); if (!$('section-strumenti').classList.contains('hidden')) renderAllPresets(); }
    if (lastCalc && (!name || name === 'prices')) renderResults();
    if (!$('section-magazzino').classList.contains('hidden') && !$('inventory-body').contains(document.activeElement)) renderInventory();
    if (!$('section-piano').classList.contains('hidden')) {
        if (!$('plan-form').contains(document.activeElement)) renderPlanForm();
        renderPlanResults();
    }
}
function backupFromState(state) {
    return { app: 'pizza-lab-pro', version: 2, exportedAt: new Date().toISOString(), recipes: state.recipes?.list || cloneDefaults(), presets: state.presets || {}, prices: state.prices?.items || {}, inventory: state.inventory || { items: {} }, plans: state.plans || {}, history: state.history || [], batches: state.batches || [], frigoLog: state.frigoLog || [] };
}
function localDateTime(iso) {
    const d = new Date(iso); return dateStr(d) + 'T' + d.toTimeString().slice(0, 5);
}
function readDateTime(id, label) {
    const value = $(id).value;
    if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error(label + ': indica data e ora.');
    Lab.date(value.slice(0, 10));
    return new Date(value).toISOString();
}
function lotSchedule(prefix) {
    const createdAt = readDateTime(prefix + '-created', 'Produzione');
    const fridgeAt = readDateTime(prefix + '-fridge', 'Ingresso in frigo');
    const readyAt = readDateTime(prefix + '-ready', 'Inizio utilizzo');
    const useBy = readDateTime(prefix + '-end', 'Fine utilizzo');
    if (Date.parse(fridgeAt) < Date.parse(createdAt) || Date.parse(readyAt) < Date.parse(createdAt) || Date.parse(useBy) < Date.parse(readyAt)) throw new Error('Le date non sono in ordine: produzione, frigo e finestra di utilizzo.');
    return { createdAt, fridgeAt, readyAt, useBy };
}
function scheduleFields(prefix, batch) {
    const start = batch?.createdAt || new Date().toISOString();
    const fields = [['created', 'Prodotto il', start], ['fridge', 'Ingresso in frigo', batch?.fridgeAt || start], ['ready', 'Utilizzabile dal', batch?.readyAt || new Date(Date.parse(start) + 86400000).toISOString()], ['end', 'Utilizzare entro', batch?.useBy || new Date(Date.parse(start) + 259200000).toISOString()]];
    return `<div class="field-row">${fields.map(([id, label, value]) => `<div class="field"><label class="field-label" for="${prefix}-${id}">${label}</label><input class="input" type="datetime-local" id="${prefix}-${id}" value="${localDateTime(value)}"></div>`).join('')}</div><p class="card-note">Imposta la finestra prevista per questo impasto. I lotti fuori finestra non vengono conteggiati dal piano di produzione.</p>`;
}
function openManualBatch() {
    if (!requireWritable()) return;
    openModal(`<h3>Aggiungi lotto</h3><div class="field"><label class="field-label" for="man-type">Impasto</label><select class="select" id="man-type" onchange="$('man-other-wrap').classList.toggle('hidden',this.value!=='__altro__')">${recipes.map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}<option value="__altro__">Altro…</option></select></div>
        <div class="field hidden" id="man-other-wrap"><label class="field-label" for="man-other">Nome impasto</label><input class="input" id="man-other" maxlength="100"></div>
        <div class="field-row"><div class="field"><label class="field-label" for="man-qty">Palline</label><input class="input" type="number" id="man-qty" min="1" max="3000" value="1"></div><div class="field"><label class="field-label" for="man-note">Nota</label><input class="input" id="man-note" maxlength="2000"></div></div>
        ${scheduleFields('man')}<p class="card-note">L’aggiunta manuale registra palline già preparate e non scarica ingredienti dal magazzino.</p>
        <div class="modal-actions"><button class="btn btn-outline" onclick="closeModal('modal-manual')">Annulla</button><button class="btn btn-dark" id="man-save" onclick="submitManualBatch()">Aggiungi</button></div>`, 'modal-manual');
}
async function submitManualBatch() {
    if (!requireWritable() || $('man-save').disabled) return;
    const btn = $('man-save'); btn.disabled = true;
    try {
        const r = $('man-type').value === '__altro__' ? { id: '', name: $('man-other').value.trim(), ballWeight: 0 } : getRecipe($('man-type').value);
        if (!r?.name) throw new Error('Indica il nome dell’impasto.');
        const qty = Lab.number($('man-qty').value, 'Palline', 1, Lab.MAX_BALLS, true);
        const dates = lotSchedule('man'), id = 'm' + uid(), note = $('man-note').value.trim();
        if (Date.parse(dates.createdAt) > Date.now() + 60000) throw new Error('Non puoi inserire in frigo una produzione futura.');
        const batch = { id, ...dates, recipeId: r.id, type: r.name, ballWeight: r.ballWeight, note, source: 'manuale', balls: Array.from({ length: qty }, () => ({ id: 'b' + uid(), createdAt: dates.createdAt, status: 'in_frigo' })) };
        await Store.atomic(['batches/' + id, 'frigoLog/' + id], () => ({ ['batches/' + id]: batch, ['frigoLog/' + id]: { id, batchId: id, recipeId: r.id, type: r.name, kind: 'aggiunta_manuale', qty, at: new Date().toISOString(), schemaVersion: 2 } }));
        closeModal('modal-manual'); toast('Lotto aggiunto');
    } catch (e) { toast(e.message); btn.disabled = false; }
}
const movingLots = new Set();
async function moveLot(batchId, qty, kind = 'consumo', ballId, note = '') {
    if (!requireWritable() || movingLots.has(batchId)) return;
    movingLots.add(batchId);
    const op = uid(), at = new Date().toISOString(), bk = 'batches/' + batchId, lk = 'frigoLog/' + op;
    try {
        await Store.atomic([bk, lk], values => {
            const before = values[bk];
            const after = Lab.move(before, { qty, kind, ballId, at, operationId: op, note });
            return { [bk]: after, [lk]: { id: op, batchId, recipeId: Lab.recipeId(before, recipes) || '', type: before.type, kind, qty, at, note, schemaVersion: 2 } };
        });
        toast(`${qty} palline: ${kind}`, { label: 'Annulla', run: () => undoMovement(op) });
        buzz(15); return true;
    } catch (e) { toast(e.message); return false; }
    finally { movingLots.delete(batchId); }
}
function removeBall(id) { return moveLot(id, 1); }
function consumeBall(id, ballId) { return moveLot(id, 1, 'consumo', ballId); }
function consumeAll(id) {
    const qty = findBatch(id)?.balls.filter(x => x.status === 'in_frigo').length || 0;
    if (qty && confirm(`Registrare il consumo di ${qty} palline?`)) return moveLot(id, qty);
}
async function addBall(batchId) {
    if (!requireWritable() || movingLots.has(batchId)) return;
    movingLots.add(batchId);
    const op = uid(), at = new Date().toISOString(), bk = 'batches/' + batchId, lk = 'frigoLog/' + op;
    try {
        await Store.atomic([bk, lk], values => {
            const b = values[bk]; if (!b) throw new Error('Lotto non disponibile.');
            if (b.balls.length >= Lab.MAX_BALLS) throw new Error('Lotto pieno: crea un nuovo lotto.');
            return { [bk]: { ...b, balls: [...b.balls, { id: 'b' + op, createdAt: b.createdAt, status: 'in_frigo', addedBy: op }] }, [lk]: { id: op, batchId, recipeId: Lab.recipeId(b, recipes) || '', type: b.type, kind: 'aggiunta_manuale', qty: 1, at, schemaVersion: 2 } };
        });
        toast('Pallina aggiunta al lotto', { label: 'Annulla', run: () => undoMovement(op) });
    } catch (e) { toast(e.message); }
    finally { movingLots.delete(batchId); }
}
function openMovement(id) {
    const batch = findBatch(id); if (!batch || !requireWritable()) return;
    const qty = batch.balls.filter(x => x.status === 'in_frigo').length;
    openModal(`<h3>${esc(batch.type)} · movimento</h3><div class="field"><label class="field-label" for="move-kind">Operazione</label><select id="move-kind" class="select"><option value="consumo">Consumo</option><option value="scarto">Scarto</option><option value="correzione">Rettifica in diminuzione</option></select></div>
    <div class="field"><label class="field-label" for="move-qty">Palline (disponibili: ${qty})</label><input id="move-qty" class="input" type="number" min="1" max="${qty}" value="${Math.min(10, qty)}"></div><div class="btn-row"><button class="btn btn-outline" onclick="$ ('move-qty').value=Math.min(10,${qty})">10</button><button class="btn btn-outline" onclick="$ ('move-qty').value=Math.min(20,${qty})">20</button><button class="btn btn-outline" onclick="$ ('move-qty').value=${qty}">Tutte</button></div>
    <div class="field"><label class="field-label" for="move-note">Motivo / nota</label><input class="input" id="move-note" maxlength="2000"></div><div class="modal-actions"><button class="btn btn-outline" onclick="closeModal('modal-move')">Chiudi</button><button id="move-save" class="btn btn-dark" onclick="submitMovement('${esc(id)}')">Registra</button></div>`, 'modal-move');
}
async function submitMovement(id) {
    try {
        const qty = Lab.number($('move-qty').value, 'Palline', 1, Lab.MAX_BALLS, true), kind = $('move-kind').value, note = $('move-note').value.trim();
        if (kind !== 'consumo' && !note) throw new Error('Indica il motivo dello scarto o della rettifica.');
        $('move-save').disabled = true;
        if (await moveLot(id, qty, kind, undefined, note)) closeModal('modal-move');
        else if ($('move-save')) $('move-save').disabled = false;
    } catch (e) { toast(e.message); }
}
async function undoMovement(id) {
    const log = Store.list('frigoLog').find(e => e.id === id); if (!log || !requireWritable()) return;
    const bk = 'batches/' + log.batchId, lk = 'frigoLog/' + id;
    try {
        await Store.atomic([bk, lk], values => {
            const e = values[lk], b = values[bk];
            if (!e || !b || e.undoneAt) throw new Error('Movimento già annullato o lotto non disponibile.');
            let balls;
            if (e.kind === 'aggiunta_manuale') {
                const added = b.balls.filter(x => x.addedBy === id);
                if (added.length !== e.qty || added.some(x => x.status !== 'in_frigo')) throw new Error('Le palline aggiunte sono già state utilizzate.');
                balls = b.balls.filter(x => x.addedBy !== id);
            } else {
                const selected = b.balls.filter(x => x.operationId === id);
                if (selected.length !== e.qty || selected.some(x => x.status === 'in_frigo')) throw new Error('Le palline sono state modificate dopo questo movimento.');
                balls = b.balls.map(x => {
                    if (x.operationId !== id) return x;
                    const restored = { ...x, status: 'in_frigo' }; delete restored.consumedAt; delete restored.operationId; delete restored.movementKind; delete restored.note; return restored;
                });
            }
            return { [bk]: { ...b, balls }, [lk]: { ...e, undoneAt: new Date().toISOString() } };
        });
        toast('Movimento annullato');
        if ($('modal-log')) openFrigoLog();
    } catch (e) { toast(e.message); }
}
function deleteBatch(id) { openMovement(id); }
function openLotDates(id) {
    const b = findBatch(id); if (!b || !requireWritable()) return;
    lotDateOriginal = Lab.copy(b);
    openModal(`<h3>Date · ${esc(b.type)}</h3>${scheduleFields('lot', b)}<div class="modal-actions"><button class="btn btn-outline" onclick="closeModal('modal-dates')">Annulla</button><button class="btn btn-dark" onclick="saveLotDates('${esc(id)}')">Salva</button></div>`, 'modal-dates');
}
let lotDateOriginal = null;
async function saveLotDates(id) {
    try {
        const dates = lotSchedule('lot'), bk = 'batches/' + id;
        await Store.atomic([bk], values => {
            const b = values[bk]; if (!b) throw new Error('Lotto non disponibile.');
            for (const k of ['createdAt', 'fridgeAt', 'readyAt', 'useBy']) if (b[k] !== lotDateOriginal[k]) throw new Error('Date cambiate da un altro dispositivo. Riapri il lotto.');
            if (b.historyId && dates.createdAt !== b.createdAt) throw new Error('La data di produzione è conservata nella scheda originale. Puoi modificare ingresso in frigo e finestra d’uso.');
            return { [bk]: { ...b, ...dates, balls: b.balls.map(x => ({ ...x, createdAt: x.createdAt === b.createdAt ? dates.createdAt : x.createdAt })) } };
        });
        closeModal('modal-dates'); toast('Date aggiornate');
    } catch (e) { toast(e.message); }
}
function maturityLabel(b) {
    if (!b.readyAt || !b.useBy) return 'Finestra non impostata';
    return { future: 'Non ancora in frigo', maturing: 'In maturazione', ready: 'Utilizzabile', past: 'Fuori finestra' }[Lab.maturity(b)];
}

let planDay = todayStr();
function renderPlan() {
    if (!$('plan-date').value) $('plan-date').value = planDay;
    planDay = $('plan-date').value || todayStr(); renderPlanForm(); renderPlanResults();
}
function renderPlanForm() {
    const plan = Store.getDoc('plans')?.[planDay] || { targets: {} };
    $('plan-time').value = plan.at ? new Date(plan.at).toTimeString().slice(0, 5) : '20:00';
    $('plan-form').innerHTML = recipes.map(r => `<div class="plan-input"><label for="plan-${esc(r.id)}">${esc(r.icon)} ${esc(r.name)}</label><input class="input" id="plan-${esc(r.id)}" type="number" min="0" max="3000" value="${plan.targets[r.id] || 0}" onchange="savePlanTarget('${esc(r.id)}',this.value)"></div>`).join('');
}
function plannedAt() { return new Date(planDay + 'T' + ($('plan-time')?.value || '20:00') + ':00'); }
async function savePlanTarget(id, value) {
    if (!requireWritable()) return;
    try {
        const target = Lab.number(value, 'Obiettivo', 0, Lab.MAX_BALLS, true), day = planDay;
        const at = plannedAt().toISOString();
        await Store.updateDoc('plans', doc => ({ ...doc, [day]: { ...(doc?.[day] || {}), at: doc?.[day]?.at || at, targets: { ...(doc?.[day]?.targets || {}), [id]: target } } }));
        renderPlanResults();
    } catch (e) { toast(e.message); renderPlanForm(); }
}
async function savePlanTime() {
    if (!requireWritable()) return;
    try {
        const day = Lab.date(planDay), at = plannedAt().toISOString();
        await Store.updateDoc('plans', doc => ({ ...doc, [day]: { targets: {}, ...doc?.[day], at } })); renderPlanResults();
    } catch (e) { toast(e.message); }
}
function planRows() {
    const plan = Store.getDoc('plans')?.[planDay] || { targets: {} };
    return Lab.plan(recipes, batches, plan.targets, plan.at || plannedAt());
}
function renderPlanResults() {
    if (!$('plan-results')) return;
    try {
        const rows = planRows(), total = rows.reduce((s, r) => s + r.make, 0);
        $('plan-results').innerHTML = `<div class="plan-total"><b>${total}</b><span>palline da preparare</span></div><div class="table-scroll"><table class="lab-table"><thead><tr><th>Impasto</th><th>Obiettivo</th><th>Utilizzabili</th><th>Da fare</th><th></th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.recipe.name)}</td><td data-label="Obiettivo">${r.target}</td><td data-label="Utilizzabili">${r.available}</td><td data-label="Da fare"><b>${r.make}</b></td><td>${r.make ? `<button class="btn btn-outline" onclick="calculatePlan('${esc(r.recipe.id)}')">Calcola</button>` : '✓'}</td></tr>`).join('')}</tbody></table></div><p class="card-note">Disponibilità stimata dai lotti attuali alla data e ora del servizio. I lotti senza finestra impostata sono inclusi: completa le date nel Frigo. I consumi futuri non sono ancora sottratti.</p>`;
    } catch (e) { $('plan-results').textContent = e.message; }
}
function calculatePlan(id) {
    const row = planRows().find(r => r.recipe.id === id); if (!row?.make) return;
    calcMode = 'balls'; switchRecipe(id); showSection('ricette'); $('target-balls').value = row.make; calculate();
}
function inventoryItems() {
    const saved = Store.getDoc('inventory')?.items || {}, map = new Map(allIngredients().map(i => [i.id, i]));
    Object.entries(saved).forEach(([id, item]) => { if (!map.has(id)) map.set(id, { id, name: item.name || id, icon: '📦' }); });
    return [...map.values()].map(i => ({ ...i, ...saved[i.id], id: i.id }));
}
function renderInventory() {
    $('inventory-body').innerHTML = inventoryItems().map(i => `<div class="inventory-row"><div class="inventory-title"><b>${esc(i.icon || '📦')} ${esc(i.name)}</b><span class="tag ${i.tracked && i.kg < i.minKg ? 'stock-low' : ''}">${i.tracked ? Number((i.kg || 0).toFixed(3)) + ' kg' : 'Non monitorato'}</span></div>
    <div class="field-row"><div class="field"><label class="field-label" for="stock-min-${i.id}">Scorta minima (kg)</label><input class="input" id="stock-min-${i.id}" type="number" step="0.001" min="0" value="${i.minKg || 0}"></div><div class="field"><label class="field-label" for="stock-delta-${i.id}">Carico / rettifica (kg)</label><input class="input" id="stock-delta-${i.id}" type="number" step="0.001" placeholder="Es. 25 oppure -2"></div></div>
    <div class="btn-row"><button class="btn btn-outline" onclick="saveInventoryItem('${i.id}',true)">${i.tracked ? 'Aggiorna scorta' : 'Attiva e registra scorta'}</button>${i.tracked ? `<button class="btn btn-outline" onclick="saveInventoryItem('${i.id}',false)">Disattiva</button>` : ''}</div></div>`).join('');
    renderShopping();
}
async function saveInventoryItem(id, tracked) {
    if (!requireWritable()) return;
    try {
        const item = inventoryItems().find(i => i.id === id);
        const delta = $('stock-delta-' + id).value === '' ? 0 : Lab.number($('stock-delta-' + id).value, 'Carico / rettifica', -1000000, 1000000);
        const minKg = Lab.number($('stock-min-' + id).value, 'Scorta minima', 0);
        await Store.updateDoc('inventory', doc => {
            const items = { ...(doc?.items || {}) }, old = items[id] || { kg: 0 };
            const kg = Lab.number(old.kg + delta, 'Scorta risultante', 0);
            items[id] = { ...old, name: item.name, tracked, minKg, kg }; return { items };
        });
        renderInventory(); toast('Magazzino aggiornato');
    } catch (e) { toast(e.message); }
}
function shoppingList() {
    const needs = {};
    planRows().forEach(r => r.calculation?.ingredients.forEach(i => { needs[i.id] = (needs[i.id] || 0) + Lab.kg(i, 'scaled'); }));
    return inventoryItems().map(i => {
        const required = needs[i.id] || 0;
        const buy = Math.max(0, required + (i.tracked ? i.minKg || 0 : 0) - (i.tracked ? i.kg || 0 : 0));
        return { ...i, required, buy };
    }).filter(i => i.buy > 0.000001);
}
function renderShopping() {
    const list = shoppingList();
    $('shopping-list').innerHTML = `<p class="card-note">Piano del ${fmtDate(planDay)}. Gli acquisti coprono la produzione da fare e riportano gli ingredienti monitorati alla scorta minima.</p>${list.length ? list.map(i => `<div class="cost-row"><span>${esc(i.name)}${!i.tracked ? ' · scorta non registrata' : ''}</span><b>${Number(i.buy.toFixed(3))} kg</b></div>`).join('') : '<p class="card-note">Nessun acquisto necessario per il piano selezionato.</p>'}`;
}
function exportShopping() {
    const rows = shoppingList().map(i => `${i.name}: ${Number(i.buy.toFixed(3))} kg${i.tracked ? '' : ' (scorta non registrata)'}`);
    downloadBlob(new Blob([`Lista acquisti · ${planDay}\n\n` + rows.join('\n')], { type: 'text/plain;charset=utf-8' }), `pizza-lab-acquisti-${planDay}.txt`);
}
function openProduction(id) {
    const e = historyCache.find(x => x.id === id); if (!e) return;
    const s = e.snapshot, lot = findBatch(e.batchId);
    openModal(`<h3>${esc(e.type)} · ${e.palline} palline</h3><p>${fmtDate(e.date)} ${esc(e.time || '')} · ${e.ballWeight} g per pallina</p>
    ${s ? `<p>Idratazione: ${s.hydration == null ? '—' : s.hydration.toFixed(1) + '%'}</p>${s.ingredients.map(i => { const d = Lab.dose(i.scaled, i.unit); return `<div class="cost-row"><span>${esc(i.name)}</span><b>${d.value} ${d.unit}</b></div>`; }).join('')}${costDetailHTML(Lab.costs(s, s.prices || {}))}` : '<p class="card-note">Produzione precedente alle schede complete: le dosi originali non sono disponibili.</p>'}
    ${lot ? `<p class="card-note">Ingresso in frigo: ${fmtDT(lot.fridgeAt || lot.createdAt)}<br>Finestra d’uso: ${lot.readyAt ? fmtDT(lot.readyAt) : 'non impostata'} → ${lot.useBy ? fmtDT(lot.useBy) : 'non impostata'}</p>` : ''}
    <p>${esc(e.note || '')}</p><div class="modal-actions">${s ? `<button class="btn btn-outline" onclick="repeatProduction(${e.id})">Ripeti dosi</button>` : ''}<button class="btn btn-outline" onclick="closeModal('modal-production')">Chiudi</button></div>`, 'modal-production');
}
function repeatProduction(id) {
    const e = historyCache.find(x => x.id === id); if (!e?.snapshot) return;
    calcMode = 'balls'; switchRecipe(e.recipeId || 'archivio');
    replayRecipe = { id: e.recipeId || 'archivio', name: e.type, icon: e.snapshot.icon || '🍕', ballWeight: e.ballWeight, originalDate: e.date, ingredients: e.snapshot.ingredients.map(({ scaled, ...i }) => i) };
    renderRecipeForm(); showSection('ricette'); $('target-balls').value = e.palline; calculate();
    $('save-note').value = 'Ripetizione del ' + e.date;
    closeModal('modal-production'); toast('Dosi originali caricate. Il costo del nuovo impasto userà i prezzi attuali.');
}
window.addEventListener('storage', e => {
    if (e.key === LOCAL_STATE_KEY && Store.mode === 'local') {
        try { Store.publishLocal(Store.localState()); } catch (err) { toast(err.message); }
    }
});
window.addEventListener('online', () => { if (Store.mode === 'offline') toast('Connessione disponibile. Riapri l’app per accedere e sincronizzare.'); });
window.addEventListener('offline', () => { if (Store.mode === 'cloud') setSyncStatus('offline'); });
window.addEventListener('beforeunload', e => {
    if (savingProduction || Object.keys(pendingPrices).length) { e.preventDefault(); e.returnValue = ''; }
});
