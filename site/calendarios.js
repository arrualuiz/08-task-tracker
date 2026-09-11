/** Consulta de agendas reais via servidor local; nenhum token é devolvido ao navegador. */
const $ = id => document.getElementById(id);
const el = (tag, text, cls) => { const n = document.createElement(tag); n.textContent = text; if (cls) n.className = cls; return n; };
const key = c => JSON.stringify([c.accountId, c.id]);
let connection = null, calendars = [], selected = new Set(), events = [], busy = false, firstList = true;
function notice(id, text, error = false) { $(id).textContent = text; $(id).className = error ? 'error' : ''; }
async function api(url, body) {
  const response = await fetch(url, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Não foi possível acessar o servidor.'); return data;
}
function lock(value) {
  busy = value;
  for (const id of ['events-form', 'calendar-list', 'accounts', 'config-form', 'calendar-selection']) $(id).inert = value;
  $('connect').disabled = value || !connection?.configured;
  $('refresh-calendars').disabled = value || !connection?.accounts.length;
  $('load-events').disabled = value || !calendars.length;
  $('configure').disabled = value || Boolean(connection?.accounts.length);
}
function empty(title, text) { const n = el('div', '', 'calendar-empty'); n.append(el('h2', title), el('p', text)); $('events').replaceChildren(n); }
function stale() {
  events = []; $('result-count').textContent = '';
  empty('Escolha o que quer consultar', 'Selecione os calendários e o período, depois clique em Consultar eventos.');
  notice('events-notice', '');
}
function renderAccounts() {
  $('accounts').replaceChildren();
  const previous = $('account-filter').value;
  $('account-filter').replaceChildren(new Option('Todas as contas', ''));
  for (const a of connection.accounts) {
    $('account-filter').add(new Option(a.email, a.id));
    const row = el('div', '', 'calendar-account'), remove = el('button', 'Desconectar deste site'); remove.type = 'button';
    remove.onclick = async () => {
      if (busy || !confirm(`Desconectar ${a.email} deste site? Os eventos no Google serão preservados.`)) return;
      lock(true);
      try { await api('/api/calendars/disconnect', { accountId: a.id }); await refresh(); notice('connection-notice', 'Conta desconectada deste site. A permissão também pode ser revogada na sua Conta Google.'); }
      catch (error) { notice('connection-notice', error.message, true); }
      finally { lock(false); }
    };
    row.append(el('strong', a.email), remove); $('accounts').append(row);
  }
  if (connection.accounts.some(a => a.id === previous)) $('account-filter').value = previous;
  if (!connection.accounts.length) $('accounts').append(el('p', 'Nenhuma conta conectada.'));
}
function selectionCount() { $('selected-count').textContent = `${selected.size} calendário(s) selecionado(s)`; }
function renderCalendars() {
  selectionCount();
  $('calendar-list').replaceChildren();
  for (const a of connection.accounts) {
    const values = calendars.filter(c => c.accountId === a.id); if (!values.length) continue;
    $('calendar-list').append(el('h3', a.email, 'calendar-group'));
    for (const c of values) {
      const label = el('label', '', 'calendar-choice'), checkbox = document.createElement('input'), text = el('span', c.title);
      checkbox.type = 'checkbox'; checkbox.checked = selected.has(key(c));
      checkbox.onchange = () => { if (checkbox.checked) selected.add(key(c)); else selected.delete(key(c)); selectionCount(); stale(); };
      text.append(el('small', `${c.primary ? 'Principal · ' : ''}${c.accessRole === 'freeBusyReader' ? 'Somente disponibilidade' : 'Leitura autorizada'}`));
      label.append(checkbox, text); $('calendar-list').append(label);
    }
  }
}
async function refresh() {
  connection = await api('/api/calendars/status');
  $('redirect-uri').textContent = connection.redirectUri;
  $('setup').open = !connection.configured; renderAccounts();
  calendars = []; events = []; renderCalendars(); $('result-count').textContent = '';
  empty('Carregando calendários…', 'Aguarde a leitura das contas conectadas.');
  notice('calendar-errors', '');
  if (connection.accounts.length) {
    const result = await api('/api/calendars/list'); calendars = result.calendars;
    selected = new Set(calendars.filter(c => selected.has(key(c)) || (firstList && c.primary)).map(key)); firstList = false;
    notice('calendar-errors', result.errors.map(e => `${e.accountEmail}: ${e.message}`).join('\n'), true);
    stale();
  } else {
    calendars = []; selected.clear(); events = []; firstList = true; $('result-count').textContent = '';
    empty('Conecte sua primeira conta', connection.configured ? 'Clique em Conectar conta Google e autorize a leitura dos calendários e eventos.' : 'Siga os passos de configuração acima para autorizar o acesso aos seus eventos.');
  }
  renderCalendars();
  notice('connection-notice', connection.configured ? `${connection.accounts.length} conta(s) conectada(s) · acesso de leitura` : 'Configure o projeto Google para conectar sua primeira conta.');
}
$('config-form').onsubmit = async event => {
  event.preventDefault(); if (busy) return; lock(true);
  try {
    const file = $('credential-file').files[0]; if (!file || file.size > 100000) throw new Error('Selecione um arquivo JSON de até 100 KB.');
    let value; try { value = JSON.parse(await file.text()); } catch { throw new Error('O arquivo não contém um JSON válido.'); }
    await api('/api/calendars/config', value); $('config-form').reset(); await refresh();
    notice('connection-notice', 'Configuração salva. Agora conecte sua conta Google.');
  } catch (error) { notice('connection-notice', error.message, true); }
  finally { lock(false); }
};
$('connect').onclick = async () => {
  if (busy) return; lock(true);
  try { const data = await api('/api/calendars/connect', {}); window.location.assign(data.url); }
  catch (error) { notice('connection-notice', error.message, true); lock(false); }
};
$('refresh-calendars').onclick = async () => {
  if (busy) return; lock(true);
  try { await refresh(); } catch (error) { notice('connection-notice', error.message, true); } finally { lock(false); }
};
const shortDate = value => value.split('-').reverse().join('/');
const time = value => new Intl.DateTimeFormat('pt-BR', { timeZone: 'Etc/GMT+3', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const day = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'Etc/GMT+3', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
/** Dia inteiro usa datas puras e término exclusivo; não converte para a véspera por fuso. */
function eventTime(e) {
  if (e.allDay) {
    const last = e.end?.date ? new Date(Date.parse(e.end.date) - 86400000).toISOString().slice(0, 10) : e.start.date;
    return last > e.start.date ? `Dia inteiro · até ${shortDate(last)}` : 'Dia inteiro';
  }
  const end = e.end?.dateTime;
  return `${time(e.start.dateTime)}${end ? ` – ${time(end)}${day(end) !== day(e.start.dateTime) ? ` (${shortDate(day(end))})` : ''}` : ''}`;
}
function renderEvents() {
  const query = $('event-search').value.toLocaleLowerCase('pt-BR');
  const values = events.filter(e => `${e.title} ${e.location} ${e.description}`.toLocaleLowerCase('pt-BR').includes(query));
  $('result-count').textContent = `${values.length} evento(s)`; $('events').replaceChildren();
  if (!values.length) { empty(query ? 'Nenhum resultado para a busca' : 'Nenhum evento neste período', query ? 'Tente outro título, local ou descrição.' : 'Confira os calendários selecionados ou escolha outro período.'); return; }
  let previousDay = '';
  // Usa instante para ordenar horários recebidos com offsets diferentes.
  values.sort((a, b) => (a.start.date || day(a.start.dateTime)).localeCompare(b.start.date || day(b.start.dateTime)) || Number(b.allDay) - Number(a.allDay) || (Date.parse(a.start.dateTime || a.start.date) - Date.parse(b.start.dateTime || b.start.date)));
  for (const e of values) {
    const date = e.start.date || day(e.start.dateTime);
    if (date !== previousDay) { $('events').append(el('h2', shortDate(date), 'event-day')); previousDay = date; }
    const card = el('article', '', 'calendar-event'), content = el('div', '');
    const calendar = calendars.find(c => c.accountId === e.accountId && c.id === e.calendarId);
    content.append(el('h3', e.title), el('p', `${calendar?.title || 'Calendário'} · ${e.accountEmail}`));
    if (e.location) content.append(el('p', e.location));
    if (e.recurringEventId) content.append(el('p', 'Evento de uma série recorrente'));
    if (e.status === 'tentative') content.append(el('p', 'Confirmação pendente'));
    if (e.description) { const details = document.createElement('details'); details.append(el('summary', 'Descrição'), el('pre', e.description)); content.append(details); }
    if (e.htmlLink) { const link = el('a', 'Abrir no Google Calendar'); link.href = e.htmlLink; link.target = '_blank'; link.rel = 'noopener noreferrer'; content.append(link); }
    card.append(el('div', eventTime(e), 'event-time'), content); $('events').append(card);
  }
}
$('events-form').onsubmit = async event => {
  event.preventDefault(); if (busy) return;
  const chosen = calendars.filter(c => selected.has(key(c)) && (!$('account-filter').value || c.accountId === $('account-filter').value));
  if (!chosen.length) { notice('events-notice', 'Selecione pelo menos um calendário da conta escolhida.', true); return; }
  lock(true); events = []; $('result-count').textContent = ''; empty('Consultando eventos…', 'Aguarde a resposta dos calendários selecionados.'); notice('events-notice', '');
  try {
    const result = await api('/api/calendars/events', { from: $('from').value, to: $('to').value, calendars: chosen.map(c => ({ accountId: c.accountId, id: c.id })) });
    events = result.events; renderEvents();
    const failures = result.errors.map(e => { const c = calendars.find(c => c.accountId === e.accountId && c.id === e.calendarId); return `${c?.title || 'Calendário'} (${c?.accountEmail || 'conta'}): ${e.message}`; });
    notice('events-notice', failures.length ? `Consulta incompleta.\n${failures.join('\n')}` : `Consulta atualizada em ${new Date(result.fetchedAt).toLocaleString('pt-BR')}.`, failures.length > 0);
    if (failures.length && !events.length) empty('Não foi possível obter os eventos', 'Veja o motivo acima. Reconecte a conta ou tente consultar novamente.');
  } catch (error) { notice('events-notice', error.message, true); empty('Consulta não realizada', 'Corrija o período ou a conexão e tente novamente.'); }
  finally { lock(false); }
};
$('select-all').onclick = () => {
  const values = calendars.filter(c => !$('account-filter').value || c.accountId === $('account-filter').value);
  const next = new Set([...selected, ...values.map(key)]);
  if (next.size > (connection?.maxCalendars || 200)) { notice('events-notice', 'Selecione até 200 calendários por consulta.', true); return; }
  selected = next; renderCalendars(); stale();
};
$('select-none').onclick = () => { selected.clear(); renderCalendars(); stale(); };
$('event-search').oninput = () => { if (events.length) renderEvents(); };
for (const id of ['from', 'to', 'account-filter']) $(id).onchange = stale;
async function init() {
  const start = day(new Date()); $('from').value = start; $('to').value = new Date(Date.parse(start) + 6 * 86400000).toISOString().slice(0, 10);
  lock(true);
  try {
    await refresh();
    const params = new URLSearchParams(location.search);
    if (params.get('connection') === 'success') notice('connection-notice', 'Conta conectada. Selecione os calendários e consulte os eventos.');
    if (params.get('connection') === 'error') notice('connection-notice', params.get('reason') || 'Não foi possível conectar a conta.', true);
    if (params.has('connection')) history.replaceState(null, '', '/calendarios');
  } catch (error) { notice('connection-notice', error.message, true); empty('Servidor indisponível', 'Verifique se o servidor local está ativo e recarregue a página.'); }
  finally { lock(false); }
}
init();
