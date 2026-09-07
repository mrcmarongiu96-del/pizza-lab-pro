const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function app(storage = new Map()) {
    const elements = {}, events = {};
    const ctx = vm.createContext({
        console, Date, Math, JSON, Blob, URL, setTimeout: () => 0, clearTimeout() {},
        navigator: { onLine: true }, location: { reload() {} },
        window: { addEventListener() {}, scrollTo() {} },
        localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
        alert: message => { ctx.lastAlert = message; }, confirm: () => true,
        document: { readyState: 'loading', activeElement: null, addEventListener: (k, v) => events[k] = v, querySelectorAll: () => [],
            getElementById: id => elements[id] ||= { value: '', disabled: false, textContent: '', innerHTML: '', contains: () => false, classList: { add() {}, remove() {}, contains: () => true, toggle() {} }, scrollIntoView() {} }
        }
    });
    for (const f of ['domain.js', 'app.js', 'workflows.js']) vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '..', f), 'utf8'), ctx);
    vm.runInContext(`toast = (message) => { globalThis.lastToast = message; }; openFrigoLog = renderRecipeForm = renderRecipeTabs = renderResults = renderRecipeList = renderPriceEditor = renderAllPresets = renderPresetBar = renderStorico = renderCharts = renderFrigo = renderInventory = renderPlanResults = renderPlanForm = () => {};`, ctx);
    ctx.run = code => vm.runInContext(code, ctx);
    return ctx;
}
function mockFirestore() {
    const db = new Map(), versions = new Map(); let fail = false;
    const snapshot = path => ({ exists: db.has(path), data: () => structuredClone(db.get(path)) });
    function collection(path) { return { doc: id => ref(path + '/' + id), get: async () => ({ docs: [...db].filter(([k]) => k.startsWith(path + '/') && !k.slice(path.length + 1).includes('/')).map(([k, v]) => ({ id: k.split('/').at(-1), data: () => structuredClone(v) })) }) }; }
    function ref(path) { return { path, collection: name => collection(path + '/' + name), get: async () => snapshot(path) }; }
    return { db, set fail(value) { fail = value; }, sdk: { db: { collection,
        runTransaction: async callback => {
            for (let attempt = 0; attempt < 5; attempt++) {
                const reads = new Map(), writes = new Map();
                const result = await callback({
                    get: async r => { reads.set(r.path, versions.get(r.path) || 0); return snapshot(r.path); },
                    set: (r, data) => writes.set(r.path, structuredClone(data)), delete: r => writes.set(r.path, null)
                });
                if ([...reads].some(([k, v]) => (versions.get(k) || 0) !== v)) continue;
                if (fail) throw new Error('simulated write failure');
                for (const [k, v] of writes) { if (v === null) db.delete(k); else db.set(k, v); versions.set(k, (versions.get(k) || 0) + 1); }
                return result;
            }
            throw new Error('too much contention');
        }
    } } };
}
function cloud(ctx, mock) { ctx.mock = mock.sdk; ctx.run(`FB = mock; Store.mode = 'cloud'; Store.uid = 'u'; Store.ready = true;`); }
function prepareProduction(ctx) {
    ctx.run(`recipes=cloneDefaults(); currentRecipeId=recipes[0].id; lastCalc=Lab.scale(recipes[0], recipes[0].ingredients, 10); $('save-date').value='2020-01-01'; $('save-time').value='12:00'; $('save-note').value='test'; $('save-ready-hours').value='24'; $('save-use-hours').value='72';`);
}
test('local atomic failure leaves all records and memory unchanged', async () => {
 const c = app(); c.run('Store.startLocal()'); c.run(`localStorage.setItem=()=>{throw Error('quota')}`);
 await assert.rejects(c.run(`Store.atomic(['history/1','batches/b'],()=>({'history/1':{id:1},'batches/b':{id:'b'}}))`));
 assert.equal(c.run(`Store.list('history').length + Store.list('batches').length`), 0);
});
test('offline mirrors are scoped by user and not overwritten by local mode', async () => {
 const c = app(); c.run(`Store.mode='cloud'; Store.uid='a'; Store.mirror('recipes',{list:[{id:'a'}]}); localStorage.setItem('pizzalab_last_uid','a'); Store.startLocal();`);
 await c.run(`Store.setDoc('prices',{items:{acqua:{prezzo:0}}})`);
 c.run(`Store.startOffline()`); assert.equal(c.run(`Store.getDoc('recipes').list[0].id`), 'a');
 c.run(`localStorage.setItem('pizzalab_last_uid','b');Store.startOffline()`); assert.equal(c.run(`Store.getDoc('recipes')`), null);
});
test('production is atomic, dated correctly and idempotent on repeated save', async () => {
 const c = app(); c.run('Store.startLocal()'); prepareProduction(c);
 await c.run('confirmSave()'); await c.run('confirmSave()');
 assert.equal(c.run(`Store.list('history').length`), 1); assert.equal(c.run(`Store.list('batches').length`), 1);
 assert.ok(c.run(`Store.list('batches')[0].createdAt.startsWith('2020-01-01')`));
 assert.equal(c.run(`Store.list('history')[0].snapshot.ingredients.length`), c.run(`recipes[0].ingredients.length`));
});
test('failed cloud production leaves no partial records and retry reuses ID', async () => {
 const mock = mockFirestore(), c = app(); cloud(c, mock); prepareProduction(c); mock.fail = true;
 await c.run('confirmSave()'); const id = c.run('pendingProduction.entry.id'); assert.equal(mock.db.size, 0);
 mock.fail = false; await c.run('confirmSave()'); await c.run('confirmSave()');
 assert.ok(mock.db.has('users/u/history/' + id)); assert.equal([...mock.db.keys()].filter(k => k.includes('/history/')).length, 1);
});
test('two devices modifying the same lot do not lose either consumption', async () => {
 const mock = mockFirestore(), a = app(), b = app(); cloud(a, mock); cloud(b, mock);
 mock.db.set('users/u/batches/b', { id: 'b', type: 'Test', createdAt: '2020-01-01T00:00:00Z', balls: Array.from({length:3},(_,i)=>({id:'x'+i,createdAt:'2020-01-01T00:00:00Z',status:'in_frigo'})) });
 await Promise.all([a.run(`moveLot('b',1)`), b.run(`moveLot('b',1)`)]);
 assert.equal(mock.db.get('users/u/batches/b').balls.filter(x=>x.status==='consumata').length, 2);
 assert.equal([...mock.db.keys()].filter(k=>k.includes('/frigoLog/')).length, 2);
});
test('independent recipe changes on two devices preserve both recipes', async () => {
 const mock = mockFirestore(), a = app(), b = app(); cloud(a,mock);cloud(b,mock);
 await Promise.all([a.run(`Store.updateDoc('recipes',d=>({list:[...(d?.list||[]),{id:'a'}]}))`),b.run(`Store.updateDoc('recipes',d=>({list:[...(d?.list||[]),{id:'b'}]}))`)]);
 assert.equal(mock.db.get('users/u/data/recipes').list.length, 2);
});
test('consumption graph excludes production, waste, corrections and undone movements', async () => {
 const c = app(); c.run(`historyCache=[{date:'2026-09-07',type:'Test',palline:10,cassetti:0}]; recipes=[{id:'r',name:'Test'}];`);
 assert.equal(c.run(`getConsumption('2026-09-07',[{key:'r'}]).total`), 0);
 c.run(`Store.cache.frigoLog=[{id:'a',batchId:'b',recipeId:'r',type:'Test',at:'2026-09-07T12:00:00Z',kind:'consumo',qty:3,schemaVersion:2},{id:'c',batchId:'b',recipeId:'r',at:'2026-09-07T12:00:00Z',kind:'scarto',qty:2,schemaVersion:2}];`);
 assert.equal(c.run(`getConsumption('2026-09-07',[{key:'r'}]).total`), 3);
 c.run(`Store.cache.frigoLog[0].undoneAt='2026-09-07T13:00:00Z'`);
 assert.equal(c.run(`getConsumption('2026-09-07',[{key:'r'}]).total`), 0);
});
test('legacy consumed balls are not double counted against legacy logs', () => {
 const c=app(); c.run(`recipes=[{id:'r',name:'Test'}]; batches=[{id:'b',type:'Test',balls:[{status:'consumata',consumedAt:'2026-09-07T12:00:00Z'}]}]; Store.cache.frigoLog=[{id:'a',batchId:'b',at:'2026-09-07T12:00:00Z',kind:'consumo',qty:1}];`);
 assert.equal(c.run(`getConsumption('2026-09-07',[{key:'r'}]).total`),1);
});
test('backup restore roundtrip includes all movement logs, stock and plans', async () => {
 const c=app(); c.run(`Store.startLocal(); recipes=cloneDefaults();`);
 await c.run(`Store.setDoc('recipes',{list:recipes})`);
 await c.run(`Store.addLog({id:'log',at:'2020-01-01T12:00:00Z',kind:'consumo',qty:1})`);
 const data=await c.run(`(async()=>Lab.backup(backupFromState(await Store.fullState())))()`); c.data=data;
 await c.run(`Store.clearCollection('frigoLog')`); assert.equal(c.run(`Store.list('frigoLog').length`),0);
 await c.run(`Store.restore(data)`); assert.equal(c.run(`Store.list('frigoLog').length`),1);
});
test('undo restores exactly the consumed balls and can only run once', async () => {
 const c=app(); c.run(`Store.startLocal()`);
 await c.run(`Store.setItem('batches','b',{id:'b',type:'Test',createdAt:'2020-01-01T00:00:00Z',balls:[{id:'a',status:'in_frigo',createdAt:'2020-01-01T00:00:00Z'}]})`);
 await c.run(`moveLot('b',1)`); c.run(`batches=Store.list('batches')`); const op=c.run(`Store.list('frigoLog')[0].id`);
 await c.run(`undoMovement('${op}')`); await c.run(`undoMovement('${op}')`);
 assert.equal(c.run(`Store.list('batches')[0].balls[0].status`),'in_frigo'); assert.ok(c.run(`Store.list('frigoLog')[0].undoneAt`));
});
module.exports={app,mockFirestore};
test('cloud backup failure preserves the entire original archive', async () => {
 const mock=mockFirestore(), c=app(); cloud(c,mock);
 mock.db.set('users/u/history/1',{id:1,type:'old'});
 mock.db.set('users/u/frigoLog/old',{id:'old',kind:'consumo',at:'2020-01-01T12:00:00Z',qty:1});
 const before=JSON.stringify([...mock.db]); mock.fail=true;
 await assert.rejects(c.run(`Store.restore({recipes:cloneDefaults(),presets:{},prices:{},inventory:{items:{}},plans:{},history:[],batches:[],frigoLog:[]})`));
 assert.equal(JSON.stringify([...mock.db]),before);
});
test('yearly consumption chart uses consumption rather than production', () => {
 const c=app(); c.run(`recipes=[{id:'r',name:'Test'}]; historyCache=[{id:1,date:todayStr(),type:'Test',recipeId:'r',palline:20,cassetti:0}]; Store.cache.frigoLog=[{id:'a',batchId:'b',recipeId:'r',type:'Test',at:new Date().toISOString(),kind:'consumo',qty:3,schemaVersion:2}]; renderYear([{key:'r',label:'Test',color:'red',soft:'pink'}]);`);
 assert.match(c.run(`$('cons-stats').innerHTML`),/>3<\/div>/);
 assert.doesNotMatch(c.run(`$('cons-stats').innerHTML`),/>20<\/div>/);
});
test('restoring oversized cloud archive is rejected without deletion', async () => {
 const mock=mockFirestore(),c=app();cloud(c,mock);
 mock.db.set('users/u/history/1',{id:1,type:'old'});
 await assert.rejects(c.run(`Store.restore({recipes:cloneDefaults(),presets:{},prices:{},inventory:{items:{}},plans:{},history:Array.from({length:450},(_,i)=>({id:i+1})),batches:[],frigoLog:[]})`),/450/);
 assert.equal(mock.db.size,1); assert.equal(mock.db.get('users/u/history/1').type,'old');
});
