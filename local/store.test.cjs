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

test('planejamento persiste ordem, comentários e blocos sem alterar a rotina; repetição é idempotente',t=>{
  const context=setup(t),routine=context.store.list()[0];
  const a={id:'11111111-1111-4111-8111-111111111111',routineId:routine.id,title:'Escolha diária',block:'morning',kind:'task',time:'',duration:0,notes:'Fazer com calma',account:'Pessoal',done:false};
  const b={...a,id:'22222222-2222-4222-8222-222222222222',routineId:null,title:'Foco',kind:'block',time:'14:00',duration:60,block:'afternoon'};
  const first=context.store.planning.save('2026-09-10',{version:0,items:[a,b]});
  assert.equal(first.version,1);
  assert.equal(context.store.planning.save('2026-09-10',{version:0,items:[a,b]}).version,1);
  assert.equal(context.store.planning.history('2026-09-10').length,1);
  assert.throws(()=>context.store.planning.save('2026-09-10',{version:0,items:[b]}),{status:409});
  assert.throws(()=>context.store.planning.save('2026-09-10',{version:1,items:[a,{...b,routineId:routine.id}]}),{status:400});
  assert.throws(()=>context.store.planning.save('2026-09-10',{version:1,items:[{...b,time:''}]}),{status:400});
  assert.throws(()=>context.store.planning.get('2026-02-30'),{status:400});
  context.store.planning.save('2026-09-10',{version:1,items:[b,{...a,done:true,block:'evening'}]});
  context.restart();
  assert.deepEqual(context.store.planning.get('2026-09-10').items.map(i=>i.id),[b.id,a.id]);
  assert.equal(context.store.planning.get('2026-09-10').items[1].notes,a.notes);
  assert.deepEqual(context.store.get(routine.id),routine);
  assert.equal(context.store.planning.get('2026-09-11').items.length,0);
  context.store.planning.save('2026-09-10',{version:2,items:[]});
  assert.equal(context.store.planning.history('2026-09-10').length,3);
  assert.equal(context.store.export().planning.days.length,1);
});

test('API diária valida entrada, salva e mantém histórico sem expor dados privados',async t=>{
  const {store}=setup(t),server=createServer(store);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  assert.match(await (await fetch(base)).text(),/Como vai ser o seu dia/);
  for(const asset of ['/dia.js','/dia.css','/revisao'])assert.equal((await fetch(base+asset)).status,200);
  const url=base+'/api/days/2026-09-10';
  assert.deepEqual(await (await fetch(url)).json(),{date:'2026-09-10',version:0,items:[]});
  const body={version:0,items:[{id:'11111111-1111-4111-8111-111111111111',routineId:null,title:'Teste isolado',block:'anytime',kind:'task',time:'',duration:0,notes:'',account:'',done:false}]};
  assert.equal((await fetch(url,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).status,200);
  assert.equal((await (await fetch(url+'/history')).json()).history.length,1);
  assert.equal((await fetch(url,{method:'PUT',headers:{'Content-Type':'application/json'},body:'null'})).status,400);
  assert.equal((await fetch(url,{method:'PUT',headers:{'Content-Type':'application/json',Origin:'https://external.example'},body:JSON.stringify(body)})).status,403);
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

test('classificação de propósito (melhorias e dívidas morais) persiste e calcula métricas do mês e progresso', async t => {
  const context = setup(t);
  const routine = context.store.list()[0];
  // Atualizar rotina com propósito de melhoria
  const updatedRoutine = context.store.update(routine.id, { ...routine, purpose: 'improvement' });
  assert.equal(updatedRoutine.purpose, 'improvement');

  // Adicionar tarefas com dívida moral e melhoria em 2026-09-05 (um marco periódico)
  const itemMoral = { id: '33333333-3333-4333-8333-333333333333', routineId: null, title: 'Resolver pendência atrasada', block: 'morning', kind: 'task', time: '', duration: 0, notes: '', account: '', done: true, purpose: 'moral_debt' };
  const itemImprove = { id: '44444444-4444-4444-8444-444444444444', routineId: routine.id, title: 'Treinar 45min', block: 'afternoon', kind: 'task', time: '17:00', duration: 45, notes: '', account: '', done: true, purpose: 'improvement' };
  const itemRoutine = { id: '55555555-5555-4555-8555-555555555555', routineId: null, title: 'Lavar louça', block: 'evening', kind: 'task', time: '', duration: 0, notes: '', account: '', done: false, purpose: 'maintenance' };

  context.store.planning.save('2026-09-05', { version: 0, items: [itemMoral, itemImprove, itemRoutine] });

  // Outro dia: 2026-09-06 com dívida moral não paga
  const itemMoralPending = { id: '66666666-6666-4666-8666-666666666666', routineId: null, title: 'Enviar e-mail adiado', block: 'morning', kind: 'task', time: '', duration: 0, notes: '', account: '', done: false, purpose: 'moral_debt' };
  context.store.planning.save('2026-09-06', { version: 0, items: [itemMoralPending] });

  // Testar mês (2026-09)
  const monthData = context.store.planning.month(2026, 9);
  assert.equal(monthData.totalDays, 30);
  const day05 = monthData.days.find(d => d.day === 5);
  assert.equal(day05.isPeriodicMilestone, true);
  assert.equal(day05.hasPlan, true);
  assert.equal(day05.stats.total, 3);
  assert.equal(day05.stats.completed, 2);
  assert.equal(day05.stats.moralDebts, 1);
  assert.equal(day05.stats.moralDebtsDone, 1);
  assert.equal(day05.stats.improvements, 1);
  assert.equal(day05.stats.improvementsDone, 1);

  const day10 = monthData.days.find(d => d.day === 10);
  assert.equal(day10.isPeriodicMilestone, true);
  assert.equal(day10.hasPlan, false);

  // Testar progresso dos últimos 7 dias até 2026-09-07
  const progress = context.store.planning.progress(7, '2026-09-07');
  assert.equal(progress.totalTasks, 4);
  assert.equal(progress.completedTasks, 2);
  assert.equal(progress.completionRate, 50);
  assert.equal(progress.moralDebtsTotal, 2);
  assert.equal(progress.moralDebtsPaid, 1);
  assert.equal(progress.moralDebtsPending, 1);
  assert.equal(progress.improvementsTotal, 1);
  assert.equal(progress.improvementsAchieved, 1);

  // Testar endpoints HTTP no servidor
  const server = createServer(context.store);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const monthRes = await (await fetch(`${base}/api/overview/month?year=2026&month=09`)).json();
  assert.equal(monthRes.totalDays, 30);
  assert.equal(monthRes.days.find(d => d.day === 5).isPeriodicMilestone, true);

  const progressRes = await (await fetch(`${base}/api/overview/progress?days=7&date=2026-09-07`)).json();
  assert.equal(progressRes.moralDebtsTotal, 2);
  assert.equal(progressRes.moralDebtsPaid, 1);

  // Validar novo endpoint de semana e projeção de rotinas
  const weekRes = await (await fetch(`${base}/api/overview/week?date=2026-09-14&start=MO`)).json();
  assert.equal(weekRes.days.length, 7);
  assert.equal(weekRes.startDate, '2026-09-14');
  assert.equal(weekRes.endDate, '2026-09-20');
  assert.ok(Array.isArray(weekRes.days[0].items));
  // O dia sem plano salvo deve ter hasPlan=false e rotinas projetadas
  const dayWithoutPlan = weekRes.days.find(d => d.date === '2026-09-14');
  assert.equal(dayWithoutPlan.hasPlan, false);
  assert.ok(dayWithoutPlan.items.length > 0);
  assert.equal(dayWithoutPlan.items[0].isProjected, true);
});

