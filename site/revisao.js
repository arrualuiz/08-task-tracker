/** Edição real via API local. O navegador guarda apenas o rascunho em memória. */
const $ = id => document.getElementById(id);
const form = $('edit-form');
const field = name => form.elements.namedItem(name);
const weekdays = [['MO','Segunda'],['TU','Terça'],['WE','Quarta'],['TH','Quinta'],['FR','Sexta'],['SA','Sábado'],['SU','Domingo']];
const statusNames = { pending: 'Para revisar', approved: 'Aprovada', paused: 'Pausada' };
let routines = [], selected = null, dirty = false, saving = false, historyRequest = 0;
const el = (tag, text, className) => { const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node; };
const notice = (text, error = false) => { $('notice').textContent = text; $('notice').className = error ? 'error' : ''; };
async function api(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Falha ao acessar os dados locais.');
  return data;
}

// Rótulos de repetição usam os campos revisados, não o título potencialmente antigo.
function schedule(r) {
  const p = r.recurrence;
  const name = d => weekdays.find(x => x[0] === d)?.[1] || d;
  let text = p.frequency === 'ONCE' ? r.date.split('-').reverse().join('/') : p.frequency === 'DAILY' ? 'Todos os dias' : p.frequency === 'WEEKLY' ? p.days.map(d => name(d).slice(0,3)).join(', ') : p.monthlyMode === 'date' ? `Dia ${p.monthDay} de cada mês` : `${p.ordinal}ª ${name(p.weekday).toLowerCase()} do mês`;
  return text + (r.time ? ` · ${r.time}` : ' · sem horário');
}
function populateOptions(id, values, initial) {
  const target = $(id), previous = target.value;
  target.replaceChildren();
  if (initial) target.append(new Option(initial, ''));
  values.forEach(value => target.append(new Option(value, value)));
  if (values.includes(previous)) target.value = previous;
}
function refresh() {
  $('total').textContent = routines.length;
  for (const state of ['pending', 'approved', 'paused']) $(state).textContent = routines.filter(r => r.status === state).length;
  const categories = [...new Set(routines.map(r => r.category))].sort();
  const accounts = [...new Set(routines.map(r => r.account))].sort();
  populateOptions('category-filter', categories, 'Todas'); populateOptions('categories', categories);
  populateOptions('account-filter', accounts, 'Todas as contas'); populateOptions('accounts', accounts);
  renderList();
}
function renderList() {
  const query = $('search').value.toLocaleLowerCase('pt-BR');
  const filtered = routines.filter(r => r.title.toLocaleLowerCase('pt-BR').includes(query) && (!$('category-filter').value || r.category === $('category-filter').value) && (!$('status-filter').value || r.status === $('status-filter').value) && (!$('account-filter').value || r.account === $('account-filter').value)).sort((a,b) => a.category.localeCompare(b.category) || a.time.localeCompare(b.time) || a.title.localeCompare(b.title));
  $('results').textContent = `${filtered.length} rotinas nesta visão`;
  $('routine-list').replaceChildren();
  for (const r of filtered) {
    const button = el('button', '', 'routine'); button.type = 'button'; button.setAttribute('aria-current', String(r.id === selected?.id));
    button.append(el('span', statusNames[r.status], `status ${r.status}`), el('strong', r.title), el('small', schedule(r)), el('small', `${r.category} · ${r.account}`));
    button.addEventListener('click', () => { if (saving || (dirty && !confirm('Descartar as alterações não salvas desta rotina?'))) return; selectRoutine(r); });
    $('routine-list').append(button);
  }
  if (!filtered.length) $('routine-list').append(el('p', 'Nenhuma rotina encontrada. Tente outros filtros.'));
}
function toggleSchedule() {
  $('weekly').hidden = field('frequency').value !== 'WEEKLY';
  $('monthly').hidden = field('frequency').value !== 'MONTHLY';
  $('month-date').hidden = field('monthlyMode').value !== 'date';
  $('month-week').hidden = field('monthlyMode').value !== 'weekday';
}
function selectRoutine(r) {
  selected = r; dirty = false; form.hidden = false; $('empty').hidden = true;
  for (const name of ['title','category','account','kind','status','purpose','date','time','duration','notes']) if (field(name)) field(name).value = r[name] || (name === 'purpose' ? 'maintenance' : '');
  for (const name of ['frequency','monthDay','ordinal','weekday','monthlyMode']) field(name).value = r.recurrence[name];
  document.querySelectorAll('[name=days]').forEach(input => input.checked = r.recurrence.days.includes(input.value));
  $('editor-title').textContent = r.title; $('version').textContent = `VERSÃO ${r.version}`;
  $('kind-label').textContent = r.category; $('warnings').replaceChildren();
  for (const warning of r.source.warnings) $('warnings').append(el('div', warning, 'warning'));
  if (r.source.exceptions.length) $('warnings').append(el('div', 'Esta série tem uma ocorrência modificada na origem.', 'warning'));
  $('source').textContent = JSON.stringify(r.source, null, 2);
  $('save-state').textContent = `Salvo · ${new Date(r.updatedAt).toLocaleString('pt-BR')}`;
  $('save').disabled = true; toggleSchedule(); renderList(); loadHistory(r.id);
}
const labels = { title:'Título',category:'Categoria',account:'Conta',kind:'Tipo',status:'Situação',purpose:'Propósito',date:'Data inicial',time:'Horário',duration:'Duração',notes:'Observações',recurrence:'Repetição' };
async function loadHistory(id) {
  const request = ++historyRequest;
  $('history').textContent = 'Carregando histórico…';
  try {
    const { history } = await api(`/api/routines/${id}/history`);
    if (request !== historyRequest) return;
    $('history').replaceChildren();
    for (const entry of history) {
      const row = el('div', '', 'history-entry');
      row.append(el('strong', entry.action === 'import' ? 'Importada do calendário' : 'Revisão salva'), el('time', new Date(entry.created_at).toLocaleString('pt-BR')));
      if (entry.before) {
        const list = el('ul', '');
        for (const key of Object.keys(labels)) if (JSON.stringify(entry.before[key]) !== JSON.stringify(entry.after[key])) {
          const display = v => key === 'recurrence' ? schedule({ recurrence:v, date:entry.after.date, time:'' }) : key === 'status' ? statusNames[v] : String(v || 'vazio');
          list.append(el('li', `${labels[key]}: ${display(entry.before[key])} → ${display(entry.after[key])}`));
        }
        row.append(list);
      }
      $('history').append(row);
    }
  } catch (error) { if (request === historyRequest) $('history').textContent = error.message; }
}
function draft() {
  const data = { version:selected.version };
  for (const name of ['title','category','account','kind','status','purpose','date','time','notes']) data[name] = field(name).value.trim();
  data.duration = Number(field('duration').value);
  data.recurrence = { frequency:field('frequency').value, days:[...document.querySelectorAll('[name=days]:checked')].map(input => input.value), monthDay:Number(field('monthDay').value), ordinal:Number(field('ordinal').value), weekday:field('weekday').value, monthlyMode:field('monthlyMode').value };
  return data;
}
form.addEventListener('input', () => { dirty = true; $('save').disabled = false; $('save-state').textContent = 'Alterações ainda não salvas'; toggleSchedule(); });
form.addEventListener('submit', async event => {
  event.preventDefault(); if (!selected || saving) return;
  const input = draft(); saving = true;
  // Congela o formulário durante a escrita para não perder uma edição mais recente.
  const controls = [...form.querySelectorAll('input,select,textarea,button')]; controls.forEach(c => c.disabled = true);
  $('save-state').textContent = 'Salvando…';
  try {
    const { routine } = await api(`/api/routines/${selected.id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(input) });
    routines = routines.map(r => r.id === routine.id ? routine : r);
    refresh(); selectRoutine(routine); notice('Alteração salva neste computador e registrada no histórico.');
  } catch (error) { notice(error.message, true); $('save-state').textContent = 'Não salvo. Seu rascunho foi mantido.'; }
  finally { saving = false; controls.forEach(c => c.disabled = false); $('save').disabled = !dirty; }
});
$('discard').addEventListener('click', () => { if (!dirty || confirm('Descartar esta edição não salva?')) selectRoutine(selected); });
for (const id of ['search','category-filter','status-filter','account-filter']) $(id).addEventListener('input', renderList);
for (const [value, name] of weekdays) {
  const label = el('label',''), checkbox = document.createElement('input'); checkbox.type='checkbox'; checkbox.name='days'; checkbox.value=value;
  label.append(checkbox, document.createTextNode(name.slice(0,3))); $('weekly').append(label);
  field('weekday').append(new Option(name, value));
}
async function load() {
  if (saving || (dirty && !confirm('Recarregar e descartar alterações não salvas?'))) return;
  try {
    const data = await api('/api/routines'); routines = data.routines;
    refresh(); const next = routines.find(r => r.id === selected?.id) || [...routines].sort((a,b) => a.title.localeCompare(b.title))[0];
    if (next) selectRoutine(next);
    else { form.hidden=true; $('empty').hidden=false; $('empty').textContent='Nenhuma rotina importada.'; }
    notice('');
  } catch (error) { notice(error.message, true); $('empty').textContent='Não foi possível carregar. Verifique o servidor e clique em Atualizar.'; }
}
$('reload').addEventListener('click', load);
window.addEventListener('beforeunload', event => { if (dirty || saving) { event.preventDefault(); event.returnValue=''; } });
load();
