/** Lógica da visão mensal, marcos periódicos e métricas de dívidas morais e melhorias. */
const $ = id => document.getElementById(id);
const node = (tag, text, cls) => { const n = document.createElement(tag); if (text) n.textContent = text; if (cls) n.className = cls; return n; };

const state = {
  year: new Date().getFullYear(),
  month: new Date().getMonth() + 1,
  progressDays: 14,
  monthData: null,
  progressData: null,
  busy: false
};

const monthNames = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

async function api(url) {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Não foi possível carregar os dados.');
  return data;
}

function tell(text, error = false) {
  $('month-notice').textContent = text;
  $('month-notice').className = error ? 'error' : '';
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
      window.location.href = `/?date=${day.date}`;
    };
    timeline.append(card);
  }
}

/** Renderiza a grade de dias do mês alinhada ao dia da semana. */
function renderCalendar(data) {
  state.monthData = data;
  $('month-title').textContent = `${monthNames[data.month - 1]} de ${data.year}`;
  const grid = $('calendar-grid');
  grid.replaceChildren();

  // Calcular o dia da semana do 1º dia do mês para preencher espaços vazios
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
    cell.setAttribute('role', 'button');
    cell.setAttribute('tabindex', '0');
    cell.setAttribute('aria-label', `Planejamento de ${day.date}`);

    // Topo da célula: número do dia e etiqueta de marco periódico se aplicável
    const top = node('div', '', 'cell-top');
    top.append(node('span', String(day.day), 'cell-number'));
    if (day.isPeriodicMilestone) {
      top.append(node('span', '★ MARCO', 'milestone-tag'));
    }
    cell.append(top);

    // Conteúdo e badges de progresso
    const content = node('div', '', 'cell-content');
    if (day.hasPlan) {
      const badgeRow = node('div', '', 'cell-badge-row');
      if (day.stats.improvements > 0) {
        badgeRow.append(node('span', `🌟 ${day.stats.improvementsDone}/${day.stats.improvements}`, 'cell-badge badge-imp'));
      }
      if (day.stats.moralDebts > 0) {
        badgeRow.append(node('span', `⏳ ${day.stats.moralDebtsDone}/${day.stats.moralDebts}`, 'cell-badge badge-debt'));
      }
      content.append(badgeRow);

      const summaryText = `${day.stats.completed}/${day.stats.total} feitos (${day.stats.completionRate}%)`;
      content.append(node('p', summaryText, 'cell-summary'));
    } else {
      content.append(node('p', day.isWeekend ? 'Fim de semana' : 'Sem tarefas', 'cell-summary'));
    }
    cell.append(content);

    // Link de ação
    cell.append(node('span', 'Abrir dia →', 'cell-action'));

    cell.onclick = () => {
      window.location.href = `/?date=${day.date}`;
    };
    cell.onkeydown = e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        window.location.href = `/?date=${day.date}`;
      }
    };

    grid.append(cell);
  }
}

/** Carrega os dados do mês e progresso em paralelo. */
async function load() {
  if (state.busy) return;
  state.busy = true;
  tell('Carregando visão do mês e progresso…');

  try {
    const formattedMonth = String(state.month).padStart(2, '0');
    const [monthRes, progressRes] = await Promise.all([
      api(`/api/overview/month?year=${state.year}&month=${formattedMonth}`),
      api(`/api/overview/progress?days=${state.progressDays}`)
    ]);

    renderCalendar(monthRes);
    renderProgress(progressRes);
    tell('');
  } catch (error) {
    tell(error.message, true);
  } finally {
    state.busy = false;
  }
}

// Navegação entre meses
$('prev-month').onclick = () => {
  if (state.month === 1) {
    state.month = 12;
    state.year--;
  } else {
    state.month--;
  }
  load();
};

$('next-month').onclick = () => {
  if (state.month === 12) {
    state.month = 1;
    state.year++;
  } else {
    state.month++;
  }
  load();
};

$('today-month').onclick = () => {
  const now = new Date();
  state.year = now.getFullYear();
  state.month = now.getMonth() + 1;
  load();
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

// Inicialização
load();
