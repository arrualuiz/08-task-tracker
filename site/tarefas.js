/** Visão Google Tasks somente leitura; IDs de conta/lista/tarefa preservam a origem. */
const $ = id => document.getElementById(id);
const el = (tag, text, cls) => { const node = document.createElement(tag); node.textContent = text; if (cls) node.className = cls; return node; };
const key = list => JSON.stringify([list.accountId, list.id]);
let connection = null, lists = [], selected = new Set(), tasks = [], busy = false, firstLoad = true;
function notice(id, text, error = false) { $(id).textContent = text; $(id).className = error ? 'error' : ''; }
async function api(url, input) {
  const response = await fetch(url, input === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  const value = await response.json(); if (!response.ok) throw new Error(value.error || 'Não foi possível acessar o servidor.'); return value;
}
function lock(value) {
  busy = value;
  for (const id of ['tasks-form', 'task-lists', 'list-selection']) $(id).inert = value;
  $('authorize').disabled = value || !connection?.configured;
  $('reload-lists').disabled = value || !connection?.accounts.length;
  $('load-tasks').disabled = value || !lists.length;
}
function empty(title, text) { const node = el('div', '', 'calendar-empty'); node.append(el('h2', title), el('p', text)); $('tasks').replaceChildren(node); }
function stale() { tasks = []; $('result-count').textContent = ''; notice('tasks-notice', ''); empty('Escolha suas listas', 'Selecione as listas e clique em Consultar tarefas.'); }
function renderLists() {
  $('selected-count').textContent = `${selected.size} lista(s) selecionada(s)`; $('task-lists').replaceChildren();
  for (const a of connection.accounts) {
    const values = lists.filter(list => list.accountId === a.id); if (!values.length) continue;
    $('task-lists').append(el('h3', a.email, 'calendar-group'));
    for (const list of values) {
      const row = el('label', '', 'calendar-choice'), checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = selected.has(key(list));
      checkbox.onchange = () => { if (checkbox.checked) selected.add(key(list)); else selected.delete(key(list)); $('selected-count').textContent = `${selected.size} lista(s) selecionada(s)`; stale(); };
      row.append(checkbox, el('span', list.title)); $('task-lists').append(row);
    }
  }
}
async function refresh() {
  const previousAccount = $('account-filter').value;
  connection = await api('/api/calendars/status');
  $('account-filter').replaceChildren(new Option('Todas as contas', '')); $('account-status').replaceChildren();
  for (const a of connection.accounts) {
    $('account-filter').add(new Option(a.email, a.id));
    const row = el('div', '', 'calendar-account'); row.append(el('strong', a.email), el('p', a.tasksAuthorized ? 'Google Tasks autorizado' : 'Falta autorizar Google Tasks')); $('account-status').append(row);
  }
  if (connection.accounts.some(a => a.id === previousAccount)) $('account-filter').value = previousAccount;
  $('setup-tasks').hidden = connection.accounts.length > 0 && connection.accounts.every(a => a.tasksAuthorized);
  lists = []; tasks = []; renderLists(); $('result-count').textContent = ''; notice('list-errors', '');
  const authorized = connection.accounts.filter(a => a.tasksAuthorized);
  if (authorized.length) {
    empty('Carregando listas…', 'Aguarde a resposta do Google Tasks.');
    const result = await api('/api/tasks/lists'); lists = result.lists;
    selected = new Set(lists.filter(list => selected.has(key(list)) || (firstLoad && lists.find(l => l.accountId === list.accountId) === list)).map(key)); firstLoad = false;
    notice('list-errors', result.errors.map(e => `${e.accountEmail}: ${e.message}`).join('\n'), true);
    renderLists(); stale();
    if (!lists.length) empty(result.errors.length ? 'Listas indisponíveis' : 'Nenhuma lista encontrada', result.errors.length ? 'Confira os avisos de conexão e se a Google Tasks API está ativada.' : 'Atualize depois de criar suas listas no Google Tasks.');
  } else {
    selected.clear(); renderLists();
    empty('Conecte o Google Tasks', connection.configured ? 'Ative a API no projeto e clique em Autorizar Google Tasks para liberar a leitura desta conta.' : 'Configure o projeto Google na aba Calendários antes de autorizar o Google Tasks.');
  }
  notice('connection-notice', `${authorized.length} de ${connection.accounts.length} conta(s) com Google Tasks autorizado.`);
}
/** A tarefa pai é identificada na mesma conta/lista, inclusive quando títulos se repetem. */
function renderTasks() {
  const query = $('search').value.toLocaleLowerCase('pt-BR');
  const values = tasks.filter(t => `${t.title} ${t.notes}`.toLocaleLowerCase('pt-BR').includes(query));
  $('result-count').textContent = `${values.length} tarefa(s)`; $('tasks').replaceChildren();
  if (!values.length) { empty('Nenhuma tarefa encontrada', query ? 'Tente outra busca.' : 'Confira as listas e a situação selecionada.'); return; }
  for (const list of lists) {
    const items = values.filter(t => t.accountId === list.accountId && t.listId === list.id).sort((a, b) => a.position.localeCompare(b.position)); if (!items.length) continue;
    $('tasks').append(el('h2', `${list.title} · ${list.accountEmail}`, 'event-day'));
    for (const task of items) {
      const card = el('article', '', `calendar-event task-card${task.status === 'completed' ? ' task-completed' : ''}`), content = el('div', '');
      const date = task.date ? task.date.split('-').reverse().join('/') : 'Sem data';
      content.append(el('h3', task.title), el('p', task.status === 'completed' ? 'Concluída' : 'Pendente'));
      if (task.parentId) { const parent = tasks.find(t => t.accountId === task.accountId && t.listId === task.listId && t.id === task.parentId); content.append(el('p', parent ? `Subtarefa de: ${parent.title}` : 'Subtarefa')); }
      if (task.notes) { const detail = document.createElement('details'); detail.append(el('summary', 'Comentários / notas'), el('pre', task.notes)); content.append(detail); }
      if (task.webViewLink) { const link = el('a', 'Abrir no Google Tasks'); link.href = task.webViewLink; link.target = '_blank'; link.rel = 'noopener noreferrer'; content.append(link); }
      card.append(el('div', date, 'event-time'), content); $('tasks').append(card);
    }
  }
}
$('authorize').onclick = async () => {
  if (busy) return; lock(true);
  try { const result = await api('/api/calendars/connect', { includeTasks: true }); location.assign(result.url); }
  catch (error) { notice('connection-notice', error.message, true); lock(false); }
};
$('reload-lists').onclick = async () => { if (busy) return; lock(true); try { await refresh(); } catch (error) { notice('connection-notice', error.message, true); } finally { lock(false); } };
$('select-all').onclick = () => {
  const chosen = lists.filter(list => !$('account-filter').value || list.accountId === $('account-filter').value), next = new Set([...selected, ...chosen.map(key)]);
  if (next.size > 200) { notice('tasks-notice', 'Selecione até 200 listas por consulta.', true); return; }
  selected = next; renderLists(); stale();
};
$('select-none').onclick = () => { selected.clear(); renderLists(); stale(); };
for (const id of ['account-filter', 'status-filter']) $(id).onchange = stale;
$('search').oninput = () => { if (tasks.length) renderTasks(); };
$('tasks-form').onsubmit = async event => {
  event.preventDefault(); if (busy) return;
  const chosen = lists.filter(list => selected.has(key(list)) && (!$('account-filter').value || list.accountId === $('account-filter').value));
  if (!chosen.length || chosen.length > 200) { notice('tasks-notice', 'Selecione de 1 a 200 listas da conta escolhida.', true); return; }
  lock(true); tasks = []; $('result-count').textContent = ''; notice('tasks-notice', ''); empty('Consultando tarefas…', 'Aguarde as listas selecionadas.');
  try {
    const result = await api('/api/tasks/list', { lists: chosen.map(list => ({ accountId: list.accountId, id: list.id })), status: $('status-filter').value });
    tasks = result.tasks; renderTasks();
    const errors = result.errors.map(e => { const list = lists.find(l => l.accountId === e.accountId && l.id === e.listId); return `${list?.title || 'Lista'} (${list?.accountEmail || 'conta'}): ${e.message}`; });
    notice('tasks-notice', errors.length ? `Consulta incompleta.\n${errors.join('\n')}` : `Atualizado em ${new Date(result.fetchedAt).toLocaleString('pt-BR')}.`, errors.length > 0);
    if (errors.length && !tasks.length) empty('Não foi possível obter as tarefas', 'Confira os avisos acima e tente novamente.');
  } catch (error) { notice('tasks-notice', error.message, true); empty('Consulta não realizada', 'Confira a conexão e tente novamente.'); }
  finally { lock(false); }
};
async function init() {
  lock(true);
  try { await refresh(); if (new URLSearchParams(location.search).get('connection') === 'success') { notice('connection-notice', 'Google Tasks autorizado. Selecione as listas e consulte suas tarefas.'); history.replaceState(null, '', '/tarefas'); } }
  catch (error) { notice('connection-notice', error.message, true); empty('Servidor indisponível', 'Verifique o servidor local e recarregue a página.'); }
  finally { lock(false); }
}
init();
