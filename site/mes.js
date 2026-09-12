/**
 * Visão integrada de Mês Completo, Mês Reduzido (Mini-calendário) e Semana Certinha.
 *
 * Responsabilidade:
 * - Alternar entre Visão de Mês Completa (com rotinas diárias por dia, como na Imagem 2 do Google Agenda)
 *   e Visão de Semana Certinha (com colunas e faixas de horários, como na Imagem 1 do Google Agenda).
 * - Renderizar o Mês Reduzido na barra lateral para navegação ágil entre semanas e meses.
 * - Projetar rotinas recorrentes ativas para todos os dias do período.
 * - Oferecer filtros por conta e propósito (melhorias, dívidas morais e manutenção).
 */

const $ = id => document.getElementById(id);
const node = (tag, text, cls) => {
  const n = document.createElement(tag);
  if (text) n.textContent = text;
  if (cls) n.className = cls;
  return n;
};

const monthNames = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

const state = {
  viewMode: 'month', // 'month' ou 'week'
  year: new Date().getFullYear(),
  month: new Date().getMonth() + 1,
  selectedDate: new Date().toISOString().slice(0, 10),
  weekScope: 7, // 7 dias (Seg a Dom) ou 5 dias úteis (Seg a Sex)
  progressDays: 14,
  accountFilter: '',
  purposeFilter: '',
  monthData: null,
  weekData: null,
  progressData: null,
  routinesList: [],
  busy: false
};

/** Chamada auxiliar para endpoints JSON locais. */
async function api(url) {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Não foi possível carregar os dados.');
  return data;
}

/** Atualiza a mensagem de status da página. */
function tell(text, error = false) {
  $('month-notice').textContent = text;
  $('month-notice').className = error ? 'error' : '';
}

/** Formata data YYYY-MM-DD para exibição amigável. */
function formatDateBR(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

/** Filtra itens de um dia conforme as escolhas do usuário no menu lateral. */
function filterDayItems(items) {
  return items.filter(item => {
    if (state.accountFilter && item.account !== state.accountFilter) return false;
    if (state.purposeFilter && (item.purpose || 'maintenance') !== state.purposeFilter) return false;
    return true;
  });
}

/** Atualiza os cards com as métricas calculadas da API. */
function renderProgress(data) {
  state.progressData = data;
  $('metric-rate').textContent = `${data.completionRate}%`;
  $('metric-tasks-ratio').textContent = `${data.completedTasks} de ${data.totalTasks} tarefas`;
  $('metric-rate-bar').style.width = `${Math.min(100, data.completionRate)}%`;

  $('metric-debts-paid').textContent = data.moralDebtsPaid;
  $('metric-debts-ratio').textContent = `de ${data.moralDebtsTotal} acumuladas`;
  const debtRate = data.moralDebtsTotal > 0 ? Math.round((data.moralDebtsPaid / data.moralDebtsTotal) * 100) : 0;
  $('metric-debts-bar').style.width = `${debtRate}%`;

  $('metric-improvements-done').textContent = data.improvementsAchieved;
  $('metric-improvements-ratio').textContent = `de ${data.improvementsTotal} planejadas`;
  const impRate = data.improvementsTotal > 0 ? Math.round((data.improvementsAchieved / data.improvementsTotal) * 100) : 0;
  $('metric-improvements-bar').style.width = `${impRate}%`;

  $('metric-active-days').textContent = data.daysWithPlans;
  $('metric-period-days').textContent = `de ${data.daysCount} dias`;
  $('metric-consistency-hint').textContent = `${data.daysWithPlans > 0 ? Math.round((data.daysWithPlans / data.daysCount) * 100) : 0}% de consistência`;

  // Linha do tempo de consistência
  const timeline = $('progress-timeline');
  timeline.replaceChildren();
  const todayStr = new Date().toISOString().slice(0, 10);

  for (const day of data.daily) {
    const card = node('div', '', `timeline-day ${day.date === todayStr ? 'today' : ''}`);
    const parts = day.date.split('-');
    const dayDisplay = `${parts[2]}/${parts[1]}`;
    card.append(node('span', dayDisplay, 'timeline-day-date'));

    if (day.hasPlan) {
      const rate = day.stats.completionRate;
      const statusCls = rate === 100 ? 'status-full' : rate > 0 ? 'status-partial' : 'status-empty';
      const statusText = `${day.stats.completed}/${day.stats.total}`;
      card.append(node('span', statusText, `timeline-day-status ${statusCls}`));
    } else {
      card.append(node('span', '—', 'timeline-day-status status-empty'));
    }

    card.onclick = () => {
      state.selectedDate = day.date;
      window.location.href = `/?date=${day.date}`;
    };
    timeline.append(card);
  }
}

/** Renderiza a Visão de Mês Reduzida (Mini-Calendário na barra lateral). */
function renderMiniCalendar(data) {
  $('mini-month-title').textContent = `${monthNames[data.month - 1]} ${data.year}`;
  const grid = $('mini-month-grid');
  grid.replaceChildren();

  const firstDayOfWeek = new Date(`${data.year}-${String(data.month).padStart(2, '0')}-01T12:00:00`).getDay();
  for (let i = 0; i < firstDayOfWeek; i++) {
    grid.append(node('div', '', 'mini-day pad'));
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const activeWeekDates = state.weekData ? state.weekData.days.map(d => d.date) : [];

  for (const day of data.days) {
    const classes = ['mini-day'];
    if (day.isPeriodicMilestone) classes.push('milestone');
    if (day.date === todayStr) classes.push('today');
    if (day.date === state.selectedDate) classes.push('selected');
    if (activeWeekDates.includes(day.date)) classes.push('active-week');

    const dayEl = node('div', String(day.day), classes.join(' '));
    dayEl.setAttribute('role', 'button');
    dayEl.setAttribute('tabindex', '0');
    dayEl.setAttribute('aria-label', `Selecionar ${day.date}`);

    dayEl.onclick = () => {
      state.selectedDate = day.date;
      load();
    };

    grid.append(dayEl);
  }
}

/**
 * Renderiza a Visão de Mês Completo: grade ampla com pílulas de rotinas diárias
 * (como na Imagem 2 do Google Agenda, com hora + título e botão "+ Mais N").
 */
function renderMonthView(data) {
  state.monthData = data;
  $('calendar-title').textContent = `${monthNames[data.month - 1]} de ${data.year}`;
  $('calendar-subtitle').textContent = 'Visão panorâmica com todas as rotinas diárias e marcos do mês.';

  const grid = $('calendar-grid');
  grid.replaceChildren();

  // Dias vazios antes do 1º dia
  const firstDayOfWeek = new Date(`${data.year}-${String(data.month).padStart(2, '0')}-01T12:00:00`).getDay();
  for (let i = 0; i < firstDayOfWeek; i++) {
    grid.append(node('div', '', 'calendar-cell pad'));
  }

  const todayStr = new Date().toISOString().slice(0, 10);

  for (const day of data.days) {
    const classes = ['calendar-cell'];
    if (day.isPeriodicMilestone) classes.push('milestone');
    if (day.isWeekend) classes.push('weekend');
    if (day.date === todayStr) classes.push('today');

    const cell = node('div', '', classes.join(' '));
    cell.setAttribute('tabindex', '0');
    cell.setAttribute('aria-label', `Dia ${day.date}`);

    // Topo da célula
    const top = node('div', '', 'cell-top');
    top.append(node('span', String(day.day), 'cell-number'));
    if (day.isPeriodicMilestone) {
      top.append(node('span', '★ MARCO', 'milestone-tag'));
    }
    cell.append(top);

    // Lista de rotinas diárias do dia
    const routinesContainer = node('div', '', 'cell-routines-list');
    const filteredItems = filterDayItems(day.items);
    const maxVisibleChips = 3;
    const visibleChips = filteredItems.slice(0, maxVisibleChips);

    for (const item of visibleChips) {
      const chipClasses = ['routine-chip'];
      if (item.purpose === 'improvement') chipClasses.push('improvement');
      else if (item.purpose === 'moral_debt') chipClasses.push('moral_debt');
      if (item.done) chipClasses.push('done');

      const chip = node('div', '', chipClasses.join(' '));
      if (item.time) {
        chip.append(node('span', item.time, 'chip-time'));
      }
      chip.append(node('span', item.title, 'chip-title'));
      chip.title = `${item.time ? item.time + ' · ' : ''}${item.title}${item.account ? ' (' + item.account + ')' : ''}`;
      routinesContainer.append(chip);
    }

    // Botão "+ Mais N" se ultrapassar o limite visível
    const remainingCount = filteredItems.length - maxVisibleChips;
    if (remainingCount > 0) {
      const moreBtn = node('button', `+ Mais ${remainingCount}`, 'more-routines-badge');
      moreBtn.type = 'button';
      moreBtn.onclick = e => {
        e.stopPropagation();
        openDayDialog(day);
      };
      routinesContainer.append(moreBtn);
    }

    cell.append(routinesContainer);

    // Clicar na célula abre o Meu Dia para aquela data
    cell.onclick = () => {
      window.location.href = `/?date=${day.date}`;
    };

    grid.append(cell);
  }
}

/**
 * Renderiza a Visão de Semana Certinha: colunas verticais com horários e rotinas
 * (como na Imagem 1 do Google Agenda).
 */
function renderWeekView(weekData) {
  state.weekData = weekData;
  const startParts = weekData.startDate.split('-');
  const endParts = weekData.endDate.split('-');
  $('calendar-title').textContent = `${startParts[2]}/${startParts[1]} a ${endParts[2]}/${endParts[1]} de ${startParts[0]}`;
  $('calendar-subtitle').textContent = 'Visão semanal com rotinas diárias organizadas por horário ao longo do dia.';

  // Aplicar escopo de 7 dias vs 5 dias úteis
  let displayDays = weekData.days;
  if (state.weekScope === 5) {
    // Filtrar apenas segunda a sexta (weekdayKey !== 'SU' && weekdayKey !== 'SA')
    displayDays = weekData.days.filter(d => d.weekdayKey !== 'SU' && d.weekdayKey !== 'SA');
  }

  document.documentElement.style.setProperty('--week-cols', displayDays.length);

  const headerContainer = $('week-grid-header');
  headerContainer.replaceChildren();

  const columnsContainer = $('week-grid-columns');
  columnsContainer.replaceChildren();

  const todayStr = new Date().toISOString().slice(0, 10);

  for (const day of displayDays) {
    // Cabeçalho da coluna do dia
    const isToday = day.date === todayStr;
    const colHeader = node('div', '', `week-col-header ${isToday ? 'today' : ''} ${day.isPeriodicMilestone ? 'milestone' : ''}`);
    colHeader.append(node('span', day.weekdayName, 'week-col-weekday'));
    colHeader.append(node('span', String(day.day), 'week-col-daynum'));
    headerContainer.append(colHeader);

    // Coluna do dia com suas rotinas diárias
    const col = node('div', '', `week-day-column ${isToday ? 'today' : ''}`);
    const filteredItems = filterDayItems(day.items);

    if (filteredItems.length === 0) {
      col.append(node('p', day.isWeekend ? 'Fim de semana sem rotinas cadastradas.' : 'Nenhuma rotina neste filtro.', 'week-day-empty'));
    } else {
      for (const item of filteredItems) {
        const cardClasses = ['week-routine-card'];
        if (item.purpose === 'improvement') cardClasses.push('improvement');
        else if (item.purpose === 'moral_debt') cardClasses.push('moral_debt');
        if (item.done) cardClasses.push('done');

        const card = node('article', '', cardClasses.join(' '));
        card.setAttribute('tabindex', '0');

        // Horário e duração
        const timeText = `${item.time || 'Sem horário'}${item.duration ? ' · ' + item.duration + ' min' : ''}`;
        card.append(node('span', timeText, 'week-card-time'));

        // Título da rotina
        card.append(node('span', item.title, 'week-card-title'));

        // Metadados (propósito e conta)
        const meta = node('div', '', 'week-card-meta');
        if (item.purpose === 'improvement') meta.append(node('span', '🌟 Melhoria'));
        else if (item.purpose === 'moral_debt') meta.append(node('span', '⏳ Dívida'));
        if (item.account) meta.append(node('span', item.account));
        if (meta.children.length > 0) card.append(meta);

        card.onclick = () => {
          window.location.href = `/?date=${day.date}`;
        };

        col.append(card);
      }
    }

    // Rodapé com atalho rápido para abrir Meu dia
    const footer = node('div', '', 'week-day-footer');
    const planLink = node('a', 'Planejar dia →');
    planLink.href = `/?date=${day.date}`;
    footer.append(planLink);
    col.append(footer);

    columnsContainer.append(col);
  }
}

/** Abre o modal com a lista completa de rotinas de um dia. */
function openDayDialog(day) {
  const dialog = $('day-detail-dialog');
  $('dialog-day-title').textContent = `Rotinas de ${formatDateBR(day.date)} (${day.weekdayName})`;
  $('dialog-open-day-link').href = `/?date=${day.date}`;

  const list = $('dialog-day-items');
  list.replaceChildren();

  const filtered = filterDayItems(day.items);
  if (filtered.length === 0) {
    list.append(node('p', 'Nenhuma rotina cadastrada para esta data.', 'hint'));
  } else {
    for (const item of filtered) {
      const row = node('div', '', 'dialog-item');
      const left = node('div', '', 'dialog-item-left');
      left.append(node('span', item.time || '--:--', 'dialog-item-time'));
      left.append(node('strong', item.title));
      row.append(left);

      let badgeText = '🔄 Rotina';
      let badgeCls = 'routine-badge';
      if (item.purpose === 'improvement') { badgeText = '🌟 Melhoria'; badgeCls = 'improvement-badge'; }
      else if (item.purpose === 'moral_debt') { badgeText = '⏳ Dívida'; badgeCls = 'debt-badge'; }

      row.append(node('span', badgeText, `legend-badge ${badgeCls}`));
      list.append(row);
    }
  }

  dialog.showModal();
}

$('dialog-close-btn').onclick = () => $('day-detail-dialog').close();

/** Atualiza o seletor de contas com base nas rotinas recebidas. */
function populateAccounts(routines) {
  state.routinesList = routines;
  const select = $('filter-account');
  const current = select.value;
  select.replaceChildren(new Option('Todas as contas', ''));
  const uniqueAccounts = [...new Set(routines.map(r => r.account).filter(Boolean))].sort();
  uniqueAccounts.forEach(a => select.add(new Option(a, a)));
  select.value = current;
}

/** Carrega dados do mês, semana e progresso em paralelo. */
async function load() {
  if (state.busy) return;
  state.busy = true;
  tell('Carregando visão de calendário e rotinas…');

  try {
    const formattedMonth = String(state.month).padStart(2, '0');
    const [monthRes, weekRes, progressRes, routinesRes] = await Promise.all([
      api(`/api/overview/month?year=${state.year}&month=${formattedMonth}`),
      api(`/api/overview/week?date=${state.selectedDate}&start=MO`),
      api(`/api/overview/progress?days=${state.progressDays}`),
      api('/api/routines')
    ]);

    populateAccounts(routinesRes.routines || []);
    renderProgress(progressRes);
    renderMiniCalendar(monthRes);

    if (state.viewMode === 'month') {
      $('view-month-container').classList.remove('hidden');
      $('view-week-container').classList.add('hidden');
      $('week-scope-container').classList.add('hidden');
      renderMonthView(monthRes);
    } else {
      $('view-month-container').classList.add('hidden');
      $('view-week-container').classList.remove('hidden');
      $('week-scope-container').classList.remove('hidden');
      renderWeekView(weekRes);
    }

    tell('');
  } catch (error) {
    tell(error.message, true);
  } finally {
    state.busy = false;
  }
}

// ========================================================
// CONTROLES DE NAVEGAÇÃO E EVENTOS
// ========================================================

// Alternador de Visão: Mês Completo vs Semana Certinha
$('btn-view-month').onclick = () => {
  if (state.viewMode === 'month') return;
  state.viewMode = 'month';
  $('btn-view-month').classList.add('active');
  $('btn-view-month').setAttribute('aria-pressed', 'true');
  $('btn-view-week').classList.remove('active');
  $('btn-view-week').setAttribute('aria-pressed', 'false');
  load();
};

$('btn-view-week').onclick = () => {
  if (state.viewMode === 'week') return;
  state.viewMode = 'week';
  $('btn-view-week').classList.add('active');
  $('btn-view-week').setAttribute('aria-pressed', 'true');
  $('btn-view-month').classList.remove('active');
  $('btn-view-month').setAttribute('aria-pressed', 'false');
  load();
};

// Navegação Anterior
$('nav-prev').onclick = () => {
  if (state.viewMode === 'month') {
    if (state.month === 1) {
      state.month = 12;
      state.year--;
    } else {
      state.month--;
    }
  } else {
    // Voltar 7 dias na semana
    const cur = new Date(`${state.selectedDate}T12:00:00`);
    const prev = new Date(cur.getTime() - 7 * 86400000);
    state.selectedDate = prev.toISOString().slice(0, 10);
    state.year = prev.getFullYear();
    state.month = prev.getMonth() + 1;
  }
  load();
};

// Navegação Próximo
$('nav-next').onclick = () => {
  if (state.viewMode === 'month') {
    if (state.month === 12) {
      state.month = 1;
      state.year++;
    } else {
      state.month++;
    }
  } else {
    // Avançar 7 dias na semana
    const cur = new Date(`${state.selectedDate}T12:00:00`);
    const next = new Date(cur.getTime() + 7 * 86400000);
    state.selectedDate = next.toISOString().slice(0, 10);
    state.year = next.getFullYear();
    state.month = next.getMonth() + 1;
  }
  load();
};

// Navegação Hoje
$('nav-today').onclick = () => {
  const now = new Date();
  state.year = now.getFullYear();
  state.month = now.getMonth() + 1;
  state.selectedDate = now.toISOString().slice(0, 10);
  load();
};

// Navegação no Mini-Calendário lateral
$('mini-prev').onclick = () => {
  if (state.month === 1) {
    state.month = 12;
    state.year--;
  } else {
    state.month--;
  }
  load();
};

$('mini-next').onclick = () => {
  if (state.month === 12) {
    state.month = 1;
    state.year++;
  } else {
    state.month++;
  }
  load();
};

// Alternar exibição do Mini-Mês lateral
$('toggle-sidebar-btn').onclick = () => {
  const sidebar = $('calendar-sidebar');
  sidebar.classList.toggle('collapsed');
  const isExpanded = !sidebar.classList.contains('collapsed');
  $('toggle-sidebar-btn').setAttribute('aria-expanded', String(isExpanded));
};

// Seletor de escopo da semana (7 dias vs 5 dias úteis)
$('week-scope-select').onchange = e => {
  state.weekScope = Number(e.target.value);
  if (state.weekData) {
    renderWeekView(state.weekData);
  }
};

// Filtros da barra lateral
$('filter-account').onchange = e => {
  state.accountFilter = e.target.value;
  if (state.viewMode === 'month' && state.monthData) renderMonthView(state.monthData);
  else if (state.viewMode === 'week' && state.weekData) renderWeekView(state.weekData);
};

$('filter-purpose').onchange = e => {
  state.purposeFilter = e.target.value;
  if (state.viewMode === 'month' && state.monthData) renderMonthView(state.monthData);
  else if (state.viewMode === 'week' && state.weekData) renderWeekView(state.weekData);
};

// Seletor de período do avanço (7, 14, 30 dias)
document.querySelectorAll('.period-btn').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.progressDays = Number(btn.dataset.days);
    load();
  };
});

// Suporte a parâmetro de data na URL (?date=YYYY-MM-DD)
const urlParamDate = new URLSearchParams(window.location.search).get('date');
if (urlParamDate && /^\d{4}-\d{2}-\d{2}$/.test(urlParamDate)) {
  state.selectedDate = urlParamDate;
  state.year = Number(urlParamDate.slice(0, 4));
  state.month = Number(urlParamDate.slice(5, 7));
}

// Inicialização
load();
