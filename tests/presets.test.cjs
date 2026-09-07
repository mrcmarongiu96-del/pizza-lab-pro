const {test}=require('node:test');
const assert=require('node:assert/strict');
const P=require('../presets.js');
const recipe={id:'r',name:'Solina',ingredients:[{id:'farina',name:'Farina',qty:1,unit:'kg'},{id:'acqua',name:'Acqua',qty:.65,unit:'kg'}]};
test('legacy presets get deterministic distinct IDs without mutating their source',()=>{
 const source={r:[{name:'Uguale',qty:{farina:2}},{name:'Uguale',qty:{farina:2}}]};
 const first=P.normalize(source);assert.notEqual(first.r[0].id,first.r[1].id);assert.equal(source.r[0].id,undefined);
 assert.deepEqual(P.normalize(source),first);assert.deepEqual(P.normalize(first),first);
});
test('legacy field quantities are converted and existing metadata is preserved',()=>{
 const doc=P.normalize({r:[{name:'Vecchio',vals:{'farina-kg':2},deletedAt:'2026-09-07T12:00:00Z'}]},{r:{'farina-kg':'farina'}});
 assert.deepEqual(doc.r[0].qty,{farina:2});assert.ok(doc.r[0].deletedAt);
});
test('search is accent insensitive, scoped by recipe and excludes trash by default',()=>{
 const doc=P.normalize({r:[{name:'Classico caffè 10',qty:{}},{name:'Classico 2',qty:{}},{name:'Cancellato',qty:{},deletedAt:'2026-09-07T12:00:00Z'}],other:[{name:'Classico',qty:{}}]});
 assert.equal(P.rows(doc,[recipe],{query:'CAFFE',rid:'r'}).length,1);
 assert.equal(P.rows(doc,[recipe],{rid:'r'}).length,2);
 assert.equal(P.rows(doc,[recipe],{trash:true})[0].name,'Cancellato');
 assert.equal(P.rows(doc,[recipe],{query:'impossibile'}).length,0);
});
test('trashing and restoring preserve doses and siblings, including identical legacy names',()=>{
 const doc=P.normalize({r:[{name:'A',qty:{farina:2}},{name:'A',qty:{farina:3}}]});
 const id=doc.r[0].id;
 const trashed=P.change(doc,'r',id,{deletedAt:'2026-09-07T12:00:00Z'});
 assert.equal(P.rows(trashed,[recipe]).length,1);assert.equal(trashed.r.length,2);assert.equal(trashed.r[1].qty.farina,3);
 const restored=P.change(trashed,'r',id,{deletedAt:null});assert.equal(P.rows(restored,[recipe]).length,2);assert.deepEqual(restored.r[0].qty,doc.r[0].qty);
});
test('renaming does not change stable ID or doses',()=>{
 const doc=P.normalize({r:[{name:'Prima',qty:{farina:2}}]});const id=doc.r[0].id;
 const next=P.change(doc,'r',id,{name:'Dopo'});assert.equal(next.r[0].id,id);assert.deepEqual(next.r[0].qty,{farina:2});
 assert.throws(()=>P.change(next,'r','missing',{deletedAt:'today'}));
});
test('applying a partial old preset resets new ingredients to base doses and flags the change',()=>{
 const result=P.quantities({qty:{farina:2,removed:3}},recipe);
 assert.equal(result.ingredients[1].qty,.65);assert.deepEqual(result.removed,['removed']);assert.deepEqual(result.added,['Acqua']);assert.equal(result.changed,true);
});
test('large libraries are sorted deterministically without altering stored order',()=>{
 const source={r:Array.from({length:200},(_,i)=>({name:'Preset '+(200-i),qty:{farina:1}}))};const doc=P.normalize(source);
 const rows=P.rows(doc,[recipe]);assert.equal(rows.length,200);assert.equal(rows[0].name,'Preset 1');assert.equal(doc.r[0].name,'Preset 200');
});
