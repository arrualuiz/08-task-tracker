/** Rascunho em memória; o salvamento diário e seu histórico passam somente pela API local. */
const $ = id => document.getElementById(id);
const names = {morning:'Manhã',afternoon:'Tarde',evening:'Noite',anytime:'Sem bloco definido'};
let plan = null, routines = [], dirty = false, busy = false, dragged = null;
const node = (tag,text,cls) => { const n=document.createElement(tag); if(text)n.textContent=text; if(cls)n.className=cls; return n; };
const button = (text,action,cls='secondary') => { const n=node('button',text,cls); n.type='button'; n.onclick=action; return n; };
const tell = (text,error=false) => { $('notice').textContent=text; $('notice').className=error?'error':''; };
const today = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
async function api(url,options){const res=await fetch(url,options);const data=await res.json();if(!res.ok)throw new Error(data.error||'Não foi possível acessar o servidor.');return data;}
function state(){ $('save').disabled=!dirty||busy; $('state').textContent=busy?'Salvando…':dirty?'Alterações ainda não salvas':'Salvo neste computador'; }
function changed(){dirty=true;render();state();}
function move(id,block,beforeId=null){if(busy)return;const index=plan.items.findIndex(i=>i.id===id);if(index<0||id===beforeId)return;const [item]=plan.items.splice(index,1);item.block=block;const target=beforeId?plan.items.findIndex(i=>i.id===beforeId):-1;plan.items.splice(target<0?plan.items.length:target,0,item);changed();}
function shift(item,offset){const group=plan.items.filter(i=>i.block===item.block),index=group.findIndex(i=>i.id===item.id),other=group[index+offset];if(!other)return;const a=plan.items.indexOf(item),b=plan.items.indexOf(other);[plan.items[a],plan.items[b]]=[plan.items[b],plan.items[a]];changed();}
const minutes = item => Number(item.time.slice(0,2))*60+Number(item.time.slice(3));
/** Sobreposição é um aviso: o usuário pode planejar atividades simultâneas conscientemente. */
function overlaps(item){return item.time&&item.duration>0&&plan.items.some(other=>other.id!==item.id&&other.time&&other.duration>0&&minutes(item)<minutes(other)+other.duration&&minutes(other)<minutes(item)+item.duration);}
function render(){
  $('blocks').replaceChildren();
  for(const [key,name] of Object.entries(names)){
    const section=node('section','','day-block'),items=plan.items.filter(i=>i.block===key);
    section.append(node('h2',`${name} · ${items.length}`));
    section.ondragover=e=>{e.preventDefault();section.classList.add('drag-over');};section.ondragleave=()=>section.classList.remove('drag-over');
    section.ondrop=e=>{e.preventDefault();move(dragged,key);};
    if(!items.length)section.append(node('p','Espaço livre. Adicione algo ou deixe assim.','empty'));
    for(const item of items){
      const card=node('article','',`card ${item.kind==='block'?'reserved':''} ${item.done?'done':''}`);card.draggable=true;
      card.ondragstart=e=>{dragged=item.id;e.dataTransfer.setData('text/plain',item.id);};card.ondragend=()=>{dragged=null;document.querySelectorAll('.drag-over').forEach(n=>n.classList.remove('drag-over'));};
      card.ondrop=e=>{e.preventDefault();e.stopPropagation();move(dragged,key,item.id);};
      
      const headerRow=node('div','','card-header-row');
      headerRow.append(node('h3',item.title));
      if(item.purpose==='improvement')headerRow.append(node('span','🌟 Melhoria','badge badge-improvement'));
      else if(item.purpose==='moral_debt')headerRow.append(node('span','⏳ Dívida Moral','badge badge-debt'));
      card.append(headerRow);

      card.append(node('small',`${item.kind==='block'?'Reserva de tempo · ':''}${item.time||'Sem horário'}${item.duration?` · ${item.duration} min`:''}${item.account?` · ${item.account}`:''}`));
      if(overlaps(item))card.append(node('small','Horário sobreposto a outro item do dia.','conflict'));
      if(item.notes)card.append(node('p',item.notes));
      const actions=node('div','','actions');actions.append(button(item.done?'Reabrir':'Concluir',()=>{item.done=!item.done;changed();}),button('Editar',()=>edit(item)),button('↑',()=>shift(item,-1)),button('↓',()=>shift(item,1)));
      actions.children[2].setAttribute('aria-label',`Mover ${item.title} para cima`);actions.children[2].disabled=items[0]===item;
      actions.children[3].setAttribute('aria-label',`Mover ${item.title} para baixo`);actions.children[3].disabled=items.at(-1)===item;
      const select=document.createElement('select');select.setAttribute('aria-label',`Bloco de ${item.title}`);for(const [v,n]of Object.entries(names))select.add(new Option(n,v));select.value=key;select.onchange=()=>move(item.id,select.value);actions.append(select,button('Remover',()=>{plan.items=plan.items.filter(i=>i.id!==item.id);changed();tell('Item removido do rascunho. A rotina original permanece disponível.');}));card.append(actions);section.append(card);
    }
    section.append(button('+ Adicionar aqui',()=>edit(null,key)));$('blocks').append(section);
  }
  const total=plan.items.length, done=plan.items.filter(i=>i.done).length;
  const impDone=plan.items.filter(i=>i.purpose==='improvement'&&i.done).length;
  const debtDone=plan.items.filter(i=>i.purpose==='moral_debt'&&i.done).length;
  const totalMin=plan.items.reduce((sum,i)=>sum+i.duration,0);
  $('summary').textContent=`${total} itens · ${done} concluídos (${impDone}🌟 melhorias · ${debtDone}⏳ dívidas pagas) · ${totalMin} min planejados`;
  suggestions();
}

/** Afinidade com a data e contexto da semana (dias úteis, fins de semana, quarta sem aula). */
function fits(r, mode='auto'){
  const d=new Date(`${plan.date}T12:00:00`),day=['SU','MO','TU','WE','TH','FR','SA'][d.getDay()],p=r.recurrence;
  if(mode==='weekday'&&p.frequency==='WEEKLY'&&!p.days.some(x=>['MO','TU','WE','TH','FR'].includes(x)))return false;
  if(mode==='weekend'&&p.frequency==='WEEKLY'&&!p.days.some(x=>['SA','SU'].includes(x)))return false;
  if(mode==='wednesday'){
    if(/aula|1º sem/i.test(r.title))return false;
    if(p.frequency==='WEEKLY'&&!p.days.includes('WE'))return false;
  }
  if(mode==='all')return true;
  if(r.date>plan.date)return false;
  return p.frequency==='ONCE'?r.date===plan.date:p.frequency==='DAILY'?true:p.frequency==='WEEKLY'?p.days.includes(day):p.monthlyMode==='date'?p.monthDay===d.getDate():p.weekday===day&&p.ordinal===Math.ceil(d.getDate()/7);
}

function suggestions(){
  const target=$('suggestions');target.replaceChildren();const query=$('search').value.toLocaleLowerCase('pt-BR');
  const contextMode=$('context-mode')?.value||'auto', purposeFilter=$('purpose-filter')?.value||'';
  const list=routines.filter(r=>r.status!=='paused'&&r.kind!=='info'&&!plan.items.some(i=>i.routineId===r.id)&&(!$('account').value||r.account===$('account').value)&&(!purposeFilter||(r.purpose||'maintenance')===purposeFilter)&&r.title.toLocaleLowerCase('pt-BR').includes(query)&&fits(r,contextMode)).sort((a,b)=>(a.status==='approved'?0:1)-(b.status==='approved'?0:1)||a.time.localeCompare(b.time)||a.title.localeCompare(b.title));
  if(!list.length)target.append(node('p','Nenhuma sugestão neste filtro. Você pode adicionar uma tarefa livre.'));
  for(const r of list){
    const card=node('div','','suggestion');
    const header=node('div','','suggestion-header');
    header.append(node('strong',r.title));
    if(r.purpose==='improvement')header.append(node('span','🌟 Melhoria','badge badge-improvement'));
    else if(r.purpose==='moral_debt')header.append(node('span','⏳ Dívida Moral','badge badge-debt'));
    card.append(header);
    card.append(node('small',`${r.status==='approved'?'Rotina aprovada':'Ainda para revisar'} · ${r.time||'Sem horário'} · ${r.account}`));
    card.append(button('+ Escolher para o dia',()=>{edit({id:'',routineId:r.id,title:r.title,account:r.account,notes:r.notes,time:r.time,duration:Math.min(r.duration,1440),block:r.time?(r.time<'12:00'?'morning':r.time<'18:00'?'afternoon':'evening'):'anytime',kind:'task',done:false,purpose:r.purpose||'maintenance'});}));
    target.append(card);
  }
}
let editingSource=null;
function edit(item,block='anytime',kind='task'){
  if(!plan||busy)return;editingSource=item;const f=$('item-form');f.reset();
  const values=item||{id:'',title:'',block,kind,time:'',duration:kind==='block'?60:0,notes:'',account:'',purpose:'maintenance'};
  for(const key of ['id','title','block','kind','time','duration','notes','account','purpose'])if(f.elements.namedItem(key))f.elements.namedItem(key).value=values[key]||'';
  $('dialog-title').textContent=item?.id?'Editar item':kind==='block'?'Reservar tempo':'Adicionar ao dia';$('form-error').textContent='';$('editor').showModal();f.elements.namedItem('title').focus();
}
$('item-form').onsubmit=e=>{
  e.preventDefault();const f=new FormData(e.target),item={id:f.get('id')||crypto.randomUUID(),routineId:editingSource?.routineId||null,title:f.get('title').trim(),block:f.get('block'),kind:f.get('kind'),time:f.get('time'),duration:Number(f.get('duration')),notes:f.get('notes'),account:f.get('account'),done:editingSource?.done||false,purpose:f.get('purpose')||'maintenance'};
  if(!item.title){$('form-error').textContent='Preencha o título.';return;}
  if(item.kind==='block'&&(!item.time||!item.duration)){$('form-error').textContent='Escolha horário e duração para reservar tempo.';return;}
  if(item.time&&minutes(item)+item.duration>1440){$('form-error').textContent='O item deve terminar no mesmo dia.';return;}
  const index=plan.items.findIndex(i=>i.id===item.id);if(index<0)plan.items.push(item);else plan.items[index]=item;$('editor').close();changed();
};
$('cancel').onclick=()=>$('editor').close();$('add').onclick=()=>edit(null);$('reserve').onclick=()=>edit(null,'anytime','block');
async function history(){try{const data=await api(`/api/days/${plan.date}/history`);$('history').replaceChildren(...data.history.map(h=>node('p',`${new Date(h.created_at).toLocaleString('pt-BR')} · versão ${JSON.parse(h.after_json).version} · ${JSON.parse(h.after_json).items.length} itens`)));if(!data.history.length)$('history').textContent='Nenhuma alteração salva neste dia.';}catch{$('history').textContent='Histórico indisponível. Recarregue para tentar novamente.';}}
async function load(){
  if(busy)return;
  if(dirty&&!confirm('Descartar alterações não salvas? Você pode cancelar e baixar o rascunho.')){$('date').value=plan.date;return;}
  const date=$('date').value;if(!date){if(plan)$('date').value=plan.date;return;}
  busy=true;$('blocks').inert=true;$('date').disabled=true;$('add').disabled=true;$('reserve').disabled=true;state();
  try{const [next,data]=await Promise.all([api(`/api/days/${date}`),api('/api/routines')]);plan=next;routines=data.routines;dirty=false;const account=$('account').value;$('account').replaceChildren(new Option('Todas as contas',''));[...new Set(routines.map(r=>r.account))].sort().forEach(a=>$('account').add(new Option(a,a)));$('account').value=account;render();await history();tell('Escolha suas sugestões e salve quando estiver pronto.');}catch(error){tell(error.message,true);if(plan)$('date').value=plan.date;}finally{busy=false;$('blocks').inert=false;$('date').disabled=false;$('add').disabled=!plan;$('reserve').disabled=!plan;state();}
}
$('save').onclick=async()=>{
  if(!dirty||busy)return;busy=true;state();
  document.querySelectorAll('main button, main input, main select').forEach(n=>n.disabled=true);$('blocks').inert=true;
  try{plan=await api(`/api/days/${plan.date}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(plan)});dirty=false;tell('Seu dia foi salvo com histórico.');await history();}catch(error){tell(error.message+' Seu rascunho foi mantido.',true);}finally{busy=false;document.querySelectorAll('main button, main input, main select').forEach(n=>n.disabled=false);$('blocks').inert=false;render();state();}
};
$('copy').onclick=()=>{if(!plan)return;const url=URL.createObjectURL(new Blob([JSON.stringify(plan,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`rascunho-${plan.date}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('reload').onclick=load;$('date').onchange=load;for(const id of ['search','account','context-mode','purpose-filter'])$(id).oninput=()=>{if(plan)suggestions();};
window.addEventListener('beforeunload',e=>{if(dirty||busy){e.preventDefault();e.returnValue='';}});
const urlParamDate = new URLSearchParams(window.location.search).get('date');
$('date').value = urlParamDate || today();
load();

