/* Preset library: stable legacy IDs, searchable picker and recoverable deletion. */
'use strict';
const PresetModel = (() => {
    function hash(text) { let h = 2166136261; for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0).toString(36); }
    function normalize(doc, fields = {}) {
        const result = {};
        for (const [rid, items] of Object.entries(doc || {})) {
            if (!Array.isArray(items)) continue;
            const used = new Set(items.filter(p => p?.id).map(p => p.id));
            result[rid] = items.filter(Boolean).map(p => {
                let id = p.id;
                if (!id) { const base = 'legacy-' + hash(JSON.stringify(p)); let n = 1; id = base; while (used.has(id)) id = base + '-' + n++; used.add(id); }
                const qty = p.qty || Object.fromEntries(Object.entries(p.vals || {}).filter(([k]) => fields[rid]?.[k]).map(([k, v]) => [fields[rid][k], Number(v)]));
                return { ...p, id, qty: { ...qty } };
            });
        }
        return result;
    }
    const fold = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('it').trim();
    function rows(doc, recipes, options = {}) {
        const query = fold(options.query || '');
        return Object.entries(doc).flatMap(([rid, items]) => items.map(p => ({ ...p, rid, recipeName: recipes.find(r => r.id === rid)?.name || rid })))
            .filter(p => Boolean(p.deletedAt) === Boolean(options.trash) && (!options.rid || p.rid === options.rid) && (!query || fold(p.name + ' ' + p.recipeName).includes(query)))
            .sort((a, b) => a.name.localeCompare(b.name, 'it', { numeric: true }) || a.id.localeCompare(b.id));
    }
    function quantities(p, recipe) {
        if (!recipe) throw new Error('L’impasto di questo preset non è più disponibile.');
        const ids = new Set(recipe.ingredients.map(i => i.id));
        const removed = Object.keys(p.qty).filter(id => !ids.has(id));
        const added = recipe.ingredients.filter(i => !Object.hasOwn(p.qty, i.id)).map(i => i.name);
        const ingredients = recipe.ingredients.map(i => ({ ...i, qty: Object.hasOwn(p.qty, i.id) ? p.qty[i.id] : i.qty }));
        return { ingredients, removed, added, changed: Boolean(removed.length || added.length) };
    }
    function change(doc, rid, id, patch) {
        const list = doc[rid] || [], selected = list.find(p => p.id === id);
        if (!selected) throw new Error('Il preset è cambiato su un altro dispositivo. Riapri la libreria.');
        return { ...doc, [rid]: list.map(p => p.id === id ? { ...p, ...patch } : p) };
    }
    return { normalize, rows, quantities, change, fold };
})();
let presetLibrary = null;
let selectedPreset = null;
let presetFocusReturn = null;
function presetData() { return PresetModel.normalize(Store.getDoc('presets') || {}, LEGACY_PRESET_FIELDS); }
function presetFind(rid, id) { return presetData()[rid]?.find(p => p.id === id); }
function renderPresetBar() {
    const el = $('preset-bar'); if (!el) return;
    const list = (presetData()[currentRecipeId] || []).filter(p => !p.deletedAt);
    const applied = selectedPreset?.rid === currentRecipeId ? presetFind(selectedPreset.rid, selectedPreset.id) : null;
    const matches = applied && !applied.deletedAt && activeRecipe()?.ingredients.every(i => $('ing-' + i.id) && Number($('ing-' + i.id).value) === selectedPreset.qty[i.id]);
    el.innerHTML = `<button class="preset-selector" type="button" onclick="openPresetLibrary(currentRecipeId)" aria-haspopup="dialog"><span class="preset-selector-copy"><span class="preset-eyebrow">Preset${list.length ? ' · ' + list.length + ' salvati' : ''}</span><strong>${matches ? esc(applied.name) : applied ? 'Dosi modificate' : 'Scegli un preset'}</strong></span><span aria-hidden="true">⌄</span></button>`;
}
function renderAllPresets() {
    const el = $('all-presets'); if (!el) return;
    const doc = presetData(), active = PresetModel.rows(doc, recipes), trash = PresetModel.rows(doc, recipes, { trash: true });
    el.innerHTML = `<p class="card-note">${active.length} preset salvati${trash.length ? ' · ' + trash.length + ' nel cestino' : ''}. Cerca, applica e gestisci le dosi dalla libreria.</p><button class="btn btn-outline" onclick="openPresetLibrary('')">Apri libreria preset</button>`;
}
function closePresetLibrary() { $('preset-dialog')?.close(); }
function presetShell() {
    const existing = $('preset-dialog'); if (existing) return existing;
    presetFocusReturn = document.activeElement;
    const dialog = document.createElement('dialog'); dialog.id = 'preset-dialog'; dialog.className = 'preset-dialog';
    dialog.setAttribute('aria-labelledby', 'preset-title');
    dialog.addEventListener('close', () => { presetLibrary = null; dialog.remove(); if (presetFocusReturn?.isConnected) presetFocusReturn.focus(); });
    dialog.addEventListener('cancel', e => { if (presetLibrary?.busy) e.preventDefault(); });
    document.body.appendChild(dialog); dialog.showModal(); return dialog;
}
function openPresetLibrary(rid = currentRecipeId) {
    presetLibrary = { rid, query: '', trash: false, mode: 'list', pageSize: 30 };
    presetShell(); renderPresetLibrary();
}
function renderPresetLibrary() {
    const dialog = $('preset-dialog'); if (!dialog || !presetLibrary) return;
    const state = presetLibrary;
    if (state.mode !== 'list') return renderPresetDetail();
    const options = [...new Map([...recipes.map(r => [r.id, r.name]), ...Object.keys(presetData()).filter(id => !getRecipe(id)).map(id => [id, id + ' (archiviato)'])]).entries()];
    dialog.innerHTML = `<div class="preset-header"><div><span class="preset-eyebrow">Le tue dosi</span><h2 id="preset-title">Libreria preset</h2></div><button class="btn btn-outline" onclick="closePresetLibrary()">Chiudi</button></div>
        <div class="preset-tabs" role="group" aria-label="Mostra preset"><button class="btn ${state.trash ? 'btn-outline' : 'btn-outline preset-tab-active'}" aria-pressed="${!state.trash}" onclick="presetTab(false)">Salvati</button><button class="btn btn-outline ${state.trash ? 'preset-tab-active' : ''}" aria-pressed="${state.trash}" onclick="presetTab(true)">Cestino</button></div>
        <div class="preset-filters"><div class="field"><label class="field-label" for="preset-search">Cerca preset</label><input class="input" id="preset-search" type="search" placeholder="Nome o impasto…" value="${esc(state.query)}" oninput="presetLibrary.query=this.value;presetLibrary.pageSize=30;renderPresetRows()"></div><div class="field"><label class="field-label" for="preset-filter">Impasto</label><select class="select" id="preset-filter" onchange="presetLibrary.rid=this.value;presetLibrary.pageSize=30;renderPresetRows()"><option value="">Tutti gli impasti</option>${options.map(([id, name]) => `<option value="${esc(id)}"${state.rid === id ? ' selected' : ''}>${esc(name)}</option>`).join('')}</select></div></div>
        <p class="preset-count" id="preset-count" role="status" aria-live="polite"></p><div class="preset-scroll" id="preset-items"></div>`;
    renderPresetRows();
}
function presetTab(trash) { presetLibrary.trash = trash; presetLibrary.pageSize = 30; renderPresetLibrary(); }
function presetSummary(p) {
    const recipe = getRecipe(p.rid); if (!recipe) return 'Impasto non disponibile';
    try {
        const q = PresetModel.quantities(p, recipe); Lab.recipe({ ...recipe, ingredients: q.ingredients });
        const kg = q.ingredients.reduce((sum, i) => sum + Lab.kg(i), 0);
        const flour = q.ingredients.filter(i => i.flour).reduce((sum, i) => sum + Lab.kg(i), 0);
        const water = q.ingredients.filter(i => i.water).reduce((sum, i) => sum + Lab.kg(i), 0);
        return `${Number(kg.toFixed(3))} kg base${flour ? ' · ' + Number((100 * water / flour).toFixed(1)) + '% idratazione' : ''}${q.changed ? ' · ricetta modificata' : ''}`;
    } catch (e) { return 'Dosi da verificare'; }
}
function renderPresetRows() {
    if (!presetLibrary || presetLibrary.mode !== 'list' || !$('preset-items')) return;
    const rows = PresetModel.rows(presetData(), recipes, presetLibrary);
    presetLibrary.visible = rows.slice(0, presetLibrary.pageSize);
    $('preset-count').textContent = `${rows.length} preset${presetLibrary.trash ? ' nel cestino · recuperabili' : rows.length === 1 ? ' trovato' : ' trovati'}`;
    $('preset-items').innerHTML = rows.length ? presetLibrary.visible.map((p, index) => `<article class="preset-item"><div class="preset-item-copy"><h3>${esc(p.name)}</h3><p>${esc(p.recipeName)}</p><span>${esc(presetSummary(p))}</span></div><div class="preset-item-actions">${presetLibrary.trash ? `<button class="btn btn-outline" onclick="restorePresetRow(${index})">Ripristina</button>` : `<button class="btn btn-outline" onclick="openPresetRow(${index})" aria-label="Gestisci ${esc(p.name)}">Gestisci</button><button class="btn btn-outline preset-apply" onclick="applyPresetRow(${index})"${getRecipe(p.rid) ? '' : ' disabled'} aria-label="Applica ${esc(p.name)}">Applica</button>`}</div></article>`).join('') + (rows.length > presetLibrary.pageSize ? '<button class="btn btn-outline preset-more" onclick="presetLibrary.pageSize+=30;renderPresetRows()">Mostra altri 30</button>' : '') : `<div class="preset-empty"><h3>${presetLibrary.query ? 'Nessun risultato' : presetLibrary.trash ? 'Il cestino è vuoto' : 'Nessun preset per questo impasto'}</h3><p>${presetLibrary.query ? 'Prova un altro nome o scegli tutti gli impasti.' : presetLibrary.trash ? 'I preset rimossi saranno recuperabili da qui.' : 'Imposta le dosi nella ricetta e scegli Salva preset.'}</p></div>`;
}
function openPresetRow(index) { const p = presetLibrary.visible[index]; if (p) openPresetDetail(p.rid, p.id); }
function applyPresetRow(index) { const p = presetLibrary.visible[index]; if (p) applySavedPreset(p.rid, p.id); }
function openPresetDetail(rid, id) {
    const p = presetFind(rid, id); if (!p) { toast('Preset non più disponibile'); return; }
    presetLibrary.mode = 'detail'; presetLibrary.selected = { rid, id }; presetLibrary.name = p.name; presetLibrary.originalName = p.name; presetLibrary.error = ''; renderPresetDetail();
    $('preset-back')?.focus();
}
function presetBack() { presetLibrary.mode = 'list'; presetLibrary.error = ''; renderPresetLibrary(); $('preset-search')?.focus(); }
function presetDosesHTML(p, recipe) {
    if (!recipe) return '<p class="card-note">Impasto non più disponibile. Puoi rinominare o conservare il preset.</p>';
    const q = PresetModel.quantities(p, recipe);
    return `${q.changed ? `<p class="preset-warning">La ricetta è cambiata.${q.removed.length ? ' ' + q.removed.length + ' dosi di ingredienti rimossi non verranno applicate.' : ''}${q.added.length ? ' Per ' + esc(q.added.join(', ')) + ' verranno usate le dosi base.' : ''}</p>` : ''}<p class="card-note">Dosi di riferimento: il numero di palline si sceglie dopo l’applicazione.</p><dl class="preset-doses">${q.ingredients.map(i => { const dose = Lab.dose(i.qty, i.unit); return `<div><dt>${esc(i.name)}</dt><dd>${dose.value} ${dose.unit}</dd></div>`; }).join('')}</dl>`;
}
function renderPresetDetail() {
    const state = presetLibrary, dialog = $('preset-dialog'); if (!state || !dialog) return;
    const p = state.mode === 'save' ? state.draft : presetFind(state.selected.rid, state.selected.id);
    if (!p) { presetBack(); return; }
    const rid = state.mode === 'save' ? state.draft.rid : state.selected.rid, recipe = getRecipe(rid);
    const confirming = state.mode === 'archive';
    dialog.innerHTML = `<div class="preset-header"><h2 id="preset-title">${confirming ? 'Spostare nel cestino?' : state.mode === 'save' ? 'Salva preset' : 'Gestisci preset'}</h2><button class="btn btn-outline" id="preset-back" onclick="${state.mode === 'save' ? 'closePresetLibrary()' : 'presetBack()'}"${state.busy ? ' disabled' : ''}>${state.mode === 'save' ? 'Annulla' : 'Indietro'}</button></div>
    <div class="preset-detail-scroll">${confirming ? `<p><strong>${esc(p.name)}</strong> non comparirà più tra i preset salvati. Potrai ripristinarlo dal Cestino in qualsiasi momento.</p>` : `<div class="field"><label class="field-label" for="preset-name">Nome preset</label><input class="input" id="preset-name" maxlength="100" value="${esc(state.name)}" placeholder="Es. Servizio del sabato" oninput="presetLibrary.name=this.value"></div><p class="preset-recipe-name">${esc(recipe?.name || rid)}</p>${presetDosesHTML(p, recipe)}`}
    <p class="preset-error" role="alert">${esc(state.error || '')}</p></div>
    <div class="preset-footer">${confirming ? `<button class="btn btn-outline" onclick="presetLibrary.mode='detail';renderPresetDetail()"${state.busy ? ' disabled' : ''}>Mantieni preset</button><button class="btn btn-danger" onclick="archiveSelectedPreset()"${state.busy ? ' disabled' : ''}>Sposta nel cestino</button>` : state.mode === 'save' ? `<button class="btn btn-outline preset-apply" onclick="commitNewPreset()"${state.busy ? ' disabled' : ''}>${state.busy ? 'Salvataggio…' : 'Salva preset'}</button>` : `<button class="btn btn-outline" onclick="renameSelectedPreset()"${state.busy ? ' disabled' : ''}>Salva nome</button>${recipe && !p.deletedAt ? `<button class="btn btn-outline preset-apply" onclick="applySelectedPreset()"${state.busy ? ' disabled' : ''}>Applica dosi</button>` : ''}<button class="preset-trash-link" onclick="presetLibrary.mode='archive';renderPresetDetail();document.querySelector('#preset-dialog .preset-footer button').focus()"${state.busy ? ' disabled' : ''}>Sposta nel cestino…</button>`}</div>`;
}
function applySelectedPreset() { const s = presetLibrary.selected; applySavedPreset(s.rid, s.id, true); }
function applySavedPreset(rid, id, reviewed = false) {
    const p = presetFind(rid, id), recipe = getRecipe(rid);
    if (!p || p.deletedAt || !recipe) { toast('Preset non disponibile'); refreshPresetLibrary(); return; }
    try {
        const result = PresetModel.quantities(p, recipe); Lab.recipe({ ...recipe, ingredients: result.ingredients });
        if (result.changed && !reviewed) { openPresetDetail(rid, id); return; }
        if (rid !== currentRecipeId || replayRecipe) switchRecipe(rid);
        result.ingredients.forEach(i => { $('ing-' + i.id).value = i.qty; });
        clearResults(); selectedPreset = { rid, id, qty: Object.fromEntries(result.ingredients.map(i => [i.id, i.qty])) };
        renderPresetBar(); closePresetLibrary(); showSection('ricette');
        $('target-balls')?.focus(); toast(`Preset “${p.name}” applicato`);
    } catch (e) { toast(e.message); }
}
function savePreset() {
    if (!requireWritable()) return;
    try {
        const recipe = activeRecipe(), ingredients = readFormQuantities(); Lab.recipe({ ...recipe, ingredients });
        if (replayRecipe) throw new Error('Seleziona l’impasto attuale prima di salvare un preset.');
        presetLibrary = { mode: 'save', name: '', error: '', draft: { id: uid(), rid: recipe.id, qty: Object.fromEntries(ingredients.map(i => [i.id, i.qty])) } };
        presetShell(); renderPresetDetail(); $('preset-name').focus();
    } catch (e) { toast(e.message); }
}
async function presetMutation(run, success) {
    if (!requireWritable() || presetLibrary?.busy) return;
    const state = presetLibrary; if (!state) return;
    state.busy = true; state.error = ''; if (state.mode !== 'list') renderPresetDetail();
    try {
        await Store.updateDoc('presets', doc => run(PresetModel.normalize(doc || {}, LEGACY_PRESET_FIELDS)));
        loadPresets(); renderPresetBar(); renderAllPresets();
        if (presetLibrary === state) { state.busy = false; success(); }
    } catch (e) { if (presetLibrary === state) { state.busy = false; state.error = e.message; state.mode === 'list' ? toast(e.message) : renderPresetDetail(); } }
}
function presetName(name) { name = name.trim(); if (!name || name.length > 100) throw new Error('Inserisci un nome da 1 a 100 caratteri.'); return name; }
function commitNewPreset() {
    const state = presetLibrary;
    let name; try { name = presetName(state.name); } catch (e) { state.error = e.message; renderPresetDetail(); return; }
    const draft = { id: state.draft.id, name, qty: state.draft.qty, createdAt: new Date().toISOString() }, rid = state.draft.rid;
    return presetMutation(doc => {
        if ((doc[rid] || []).some(p => p.id === draft.id)) return doc;
        if ((doc[rid] || []).some(p => !p.deletedAt && PresetModel.fold(p.name) === PresetModel.fold(name))) throw new Error('Esiste già un preset con questo nome. Scegli un nome diverso.');
        return { ...doc, [rid]: [...(doc[rid] || []), draft] };
    }, () => { selectedPreset = { rid, id: draft.id, qty: draft.qty }; renderPresetBar(); closePresetLibrary(); toast('Preset salvato nella libreria'); });
}
function renameSelectedPreset() {
    const state = presetLibrary, { rid, id } = state.selected;
    let name; try { name = presetName(state.name); } catch (e) { state.error = e.message; renderPresetDetail(); return; }
    const original = state.originalName;
    return presetMutation(doc => {
        const p = doc[rid]?.find(x => x.id === id);
        if (!p || p.name !== original || p.deletedAt) throw new Error('Preset cambiato su un altro dispositivo. Riapri la libreria.');
        if (doc[rid].some(x => x.id !== id && !x.deletedAt && PresetModel.fold(x.name) === PresetModel.fold(name))) throw new Error('Nome già usato per questo impasto.');
        return PresetModel.change(doc, rid, id, { name });
    }, () => { toast('Nome aggiornato'); presetBack(); });
}
function archiveSelectedPreset() {
    const { rid, id } = presetLibrary.selected, at = new Date().toISOString();
    return presetMutation(doc => PresetModel.change(doc, rid, id, { deletedAt: at }), () => { toast('Preset spostato nel cestino. Puoi ripristinarlo dalla libreria.'); presetBack(); });
}
function restorePresetRow(index) {
    const p = presetLibrary.visible[index]; if (!p) return;
    return presetMutation(doc => PresetModel.change(doc, p.rid, p.id, { deletedAt: null }), () => { renderPresetRows(); toast('Preset ripristinato tra i salvati'); });
}
function refreshPresetLibrary() {
    if (!presetLibrary || presetLibrary.busy) return;
    // Keep the search cursor and unsaved names while remote snapshots update.
    if (presetLibrary.mode === 'list') renderPresetRows();
}
// Compatibility for old inline handlers during a version transition: no direct deletion.
function applyPreset(index) { const p = (presetData()[currentRecipeId] || []).filter(p => !p.deletedAt)[index]; if (p) applySavedPreset(currentRecipeId, p.id); }
function deletePreset(index) { deletePresetFrom(currentRecipeId, index); }
function deletePresetFrom(rid, index) { const p = presetData()[rid]?.[index]; if (p) { openPresetLibrary(rid); openPresetDetail(rid, p.id); } }
if (typeof module !== 'undefined') module.exports = PresetModel;
