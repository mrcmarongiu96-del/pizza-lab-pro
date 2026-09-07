const { test } = require('node:test');
const assert = require('node:assert/strict');
const Lab = require('../domain.js');
const recipe = { id: 'r', name: 'Test', ballWeight: 250, ingredients: [{ id: 'farina', name: 'Farina', qty: 1, unit: 'kg', flour: true }, { id: 'acqua', name: 'Acqua', qty: 650, unit: 'g', water: true }, { id: 'sale', name: 'Sale', qty: 25, unit: 'g' }] };
const lot = { id: 'b1', recipeId: 'r', type: 'Test', createdAt: '2026-09-01T10:00:00Z', readyAt: '2026-09-02T10:00:00Z', useBy: '2026-09-04T10:00:00Z', balls: [{ id: 'a', status: 'in_frigo', createdAt: '2026-09-01T10:00:00Z' }, { id: 'b', status: 'in_frigo', createdAt: '2026-09-01T10:00:00Z' }] };
test('scaled mixed units conserve mass and hydration', () => {
 const c = Lab.scale(recipe, recipe.ingredients, 55);
 assert.ok(Math.abs(c.ingredients.reduce((s, i) => s + Lab.kg(i, 'scaled'), 0) - 13.75) < 1e-10);
 assert.ok(Math.abs(c.hydration - 65) < 1e-10);
});
test('reject negative, nonfinite, fractional counts and excessive quantities', () => {
 for (const n of [-1, Infinity, NaN, 0, 1.5, 3001]) assert.throws(() => Lab.scale(recipe, recipe.ingredients, n));
 assert.throws(() => Lab.scale(recipe, [{ ...recipe.ingredients[0], qty: -1 }], 10));
 assert.throws(() => Lab.number('', 'dose'));
 assert.equal(Lab.number('1,25', 'dose'), 1.25);
});
test('dose display preserves small weights', () => {
 assert.deepEqual(Lab.dose(0.00125, 'kg'), { value: '1.25', unit: 'g' });
 assert.deepEqual(Lab.dose(1.234, 'kg'), { value: '1.234', unit: 'kg' });
});
test('prices and calories are independent, explicit zero is complete', () => {
 const c = Lab.scale(recipe, recipe.ingredients, 10);
 let result = Lab.costs(c, { farina: { cal: 300 } });
 assert.equal(result.missingPrice, 3); assert.equal(result.missingCalories, 2);
 result = Lab.costs(c, Object.fromEntries(recipe.ingredients.map(i => [i.id, { cal: 0, prezzo: 0 }])));
 assert.equal(result.missingPrice, 0); assert.equal(result.missingCalories, 0);
});
test('identity survives renames and separates equal names', () => {
 assert.equal(Lab.recipeId(lot, [{ ...recipe, name: 'Nuovo' }]), 'r');
 assert.equal(Lab.recipeId({ type: 'Test' }, [recipe, { ...recipe, id: 'r2' }]), null);
});
test('planning includes only available lots at service time', () => {
 for (const [at, available] of [['2026-09-01T12:00:00Z', 0], ['2026-09-03T12:00:00Z', 2], ['2026-09-05T12:00:00Z', 0]]) {
  const [r] = Lab.plan([recipe], [lot], { r: 10 }, at); assert.equal(r.available, available); assert.equal(r.make, 10 - available);
 }
});
test('consumption, waste and corrections are distinct and validate live stock', () => {
 const options = { qty: 1, at: '2026-09-03T10:00:00Z', operationId: 'op' };
 const used = Lab.move(lot, { ...options, kind: 'consumo' });
 assert.equal(used.balls[0].status, 'consumata'); assert.equal(lot.balls[0].status, 'in_frigo');
 assert.equal(Lab.move(lot, { ...options, kind: 'scarto' }).balls[0].status, 'scartata');
 assert.equal(Lab.move(lot, { ...options, kind: 'correzione' }).balls[0].status, 'rettificata');
 assert.throws(() => Lab.move(used, { ...options, qty: 2, kind: 'consumo' }));
 assert.throws(() => Lab.move(used, { ...options, ballId: 'a', kind: 'consumo' }));
});
test('inventory use is exact and insufficient stock aborts without mutating input', () => {
 const inv = { items: { farina: { kg: 10, tracked: true } } }, calc = Lab.scale(recipe, recipe.ingredients, 10);
 const r = Lab.stockUse(inv, calc); assert.equal(inv.items.farina.kg, 10); assert.ok(r.inventory.items.farina.kg < 10);
 assert.throws(() => Lab.stockUse({ items: { farina: { kg: 0, tracked: true } } }, calc));
});
const backup = () => ({ app: 'pizza-lab-pro', version: 1, recipes: [recipe], history: [], batches: [lot], frigoLog: [{ at: '2026-09-03T12:00:00Z', kind: 'consumo', qty: 1 }] });
test('v1 backup upgrades log IDs and retains archived data', () => {
 const b = Lab.backup(backup()); assert.equal(b.frigoLog[0].id, 'import-0'); assert.equal(b.batches.length, 1); assert.deepEqual(b.inventory, { items: {} });
});
test('invalid backups fail before any write', () => {
 const b = backup(); b.batches[0] = { ...lot, balls: [{ id: 'x', status: 'bad', createdAt: 'bad' }] }; assert.throws(() => Lab.backup(b));
 const c = backup(); c.recipes = [{ ...recipe, id: "r');alert(1)//" }]; assert.throws(() => Lab.backup(c));
 assert.throws(() => Lab.backup({ ...backup(), version: 99 }));
 assert.throws(() => Lab.date('2026-02-31'));
});
test('legacy names remain attached to renamed recipes through aliases', () => {
 assert.equal(Lab.recipeId({ type: 'Test' }, [{ ...recipe, name: 'Nuovo', aliases: ['Test'] }]), 'r');
});
test('backup rejects numeric strings rather than introducing concatenated counts', () => {
 const b=backup(); b.history=[{id:1,date:'2026-09-07',type:'Test',palline:'10',ballWeight:250}];
 assert.throws(()=>Lab.backup(b));
});
