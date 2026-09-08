/** Testes isolados: nunca abrem o banco pessoal nem chamam serviços Google. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { openStore, localStart } = require('./store.cjs');
const { createServer } = require('./server.cjs');

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-tracker-test-'));
  const inventoryFile = path.join(dir, 'inventory.json'), filename = path.join(dir, 'data.sqlite');
  const props = { DTSTART:[{value:'20260302T130000',parameters:';TZID=America/Sao_Paulo'}], DTEND:[{value:'20260302T131500'}], RRULE:[{value:'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'}], EXDATE:[{value:'20260610T130000'}] };
  const main = { uid:'test-uid', titulo:'Rotina de teste', categoriaSugerida:'Estudos', tipoRegistro:'serie', propriedades:props };
  fs.writeFileSync(inventoryFile, JSON.stringify({calendario:{'X-WR-CALNAME':'Teste'}, eventos:[main,{...main,tipoRegistro:'excecao',propriedades:{...props,'RECURRENCE-ID':[{value:'20260302T130000'}]}}]}));
  let store = openStore(filename, inventoryFile);
  t.after(() => { store.close(); fs.rmSync(dir, {recursive:true,force:true}); });
  return { get store(){return store;}, restart(){store.close();store=openStore(filename,inventoryFile);}, filename };
}
test('importa apenas a série, preserva exceções e não reaplica semente no reinício', t => {
  const context=setup(t), initial=context.store.list();
  assert.equal(initial.length,1);
  assert.equal(initial[0].source.exceptions.length,1);
  assert.equal(initial[0].source.event.propriedades.EXDATE[0].value,'20260610T130000');
  const updated=context.store.update(initial[0].id,{...initial[0],title:'Título revisado',status:'approved',recurrence:{...initial[0].recurrence,days:['SA']}});
  assert.equal(updated.version,2);
  context.restart();
  assert.equal(context.store.list().length,1);
  const persisted=context.store.get(initial[0].id);
  assert.equal(persisted.title,'Título revisado');
  assert.deepEqual(persisted.recurrence.days,['SA']);
  assert.equal(persisted.source.event.propriedades.RRULE[0].value,'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
  assert.equal(context.store.history(initial[0].id).length,2);
  assert.equal(context.store.history(initial[0].id)[0].before.title,'Rotina de teste');
});
test('conflito e entrada inválida não alteram registro nem histórico', t => {
  const {store}=setup(t), initial=store.list()[0];
  store.update(initial.id,{...initial,title:'Mudança na primeira aba'});
  assert.throws(()=>store.update(initial.id,{...initial,title:'Mudança atrasada'}),{status:409});
  const current=store.get(initial.id);
  assert.throws(()=>store.update(initial.id,{...current,date:'2026-02-30'}),{status:400});
  assert.throws(()=>store.update(initial.id,{...current,recurrence:{...current.recurrence,days:[]}}),{status:400});
  assert.equal(store.history(initial.id).length,2);
  assert.equal(store.get(initial.id).title,'Mudança na primeira aba');
  store.update(initial.id,current);
  assert.equal(store.history(initial.id).length,2);
});
test('normaliza evento UTC para São Paulo',()=>{
  assert.deepEqual(localStart('20260317T220000Z'),{date:'2026-03-17',time:'19:00'});
});
test('API salva e exporta, restringe origem e não serve arquivos privados',async t=>{
  const {store}=setup(t), server=createServer(store);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base)).status,200);
  const {routines}=await (await fetch(`${base}/api/routines`)).json();
  const item=routines[0];
  const result=await fetch(`${base}/api/routines/${item.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...item,notes:'Teste de persistência pela API'})});
  assert.equal(result.status,200);
  assert.equal((await (await fetch(`${base}/api/routines`)).json()).routines[0].notes,'Teste de persistência pela API');
  const exported=await (await fetch(`${base}/api/export`)).json();
  assert.equal(exported.history.length,2);
  assert.equal(exported.routines[0].version,2);
  assert.equal((await fetch(`${base}/api/routines`,{headers:{Origin:'https://external.example'}})).status,403);
  assert.equal((await fetch(`${base}/api/routines/${item.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:'not json'})).status,400);
  for (const url of ['/dados-locais/task-tracker.sqlite','/config.js','/apps-script/Code.gs','/../README.md']) assert.equal((await fetch(base+url)).status,404);
});
