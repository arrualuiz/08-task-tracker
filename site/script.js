/**
 * TASK TRACKER — SCRIPT DO FRONTEND
 * Gerencia quadro Kanban estilo Google Tasks, gestão de visibilidade de listas, sincronização e dashboard
 */

// ======================= CONSTANTES E ESTADO =======================
const STORAGE_KEY_LISTAS = 'task_tracker_listas_visiveis';
let dadosAtuais = { tasks: [], listas: [], eventos: [] };
let listasVisiveis = carregarListasVisiveis();
let graficoDiasInstance = null;
let graficoCategoriasInstance = null;

// ======================= ELEMENTOS DO DOM =======================
const tabs = document.querySelectorAll('.tab-btn');
const contents = document.querySelectorAll('.tab-content');
const boardContainer = document.getElementById('board-container');
const boardLoading = document.getElementById('quadro-loading');
const btnAtualizar = document.getElementById('btn-atualizar');
const btnRecarregarDash = document.getElementById('btn-recarregar-dash');
const inputFiltro = document.getElementById('input-filtro');
const syncStatus = document.getElementById('sync-status');
const toastContainer = document.getElementById('toast-container');

// Elementos da Sidebar de Gestão de Listas
const listsSidebar = document.getElementById('lists-sidebar');
const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
const sidebarBackdrop = document.getElementById('sidebar-backdrop');
const sidebarListsContainer = document.getElementById('sidebar-lists-container');
const btnSelectAll = document.getElementById('btn-select-all');
const btnDeselectAll = document.getElementById('btn-deselect-all');
const activeListsCount = document.getElementById('active-lists-count');

// ======================= PERSISTÊNCIA (LOCALSTORAGE) =======================
function carregarListasVisiveis() {
  try {
    const salvo = localStorage.getItem(STORAGE_KEY_LISTAS);
    if (salvo) {
      return JSON.parse(salvo);
    }
  } catch (e) {
    console.error('Erro ao ler localStorage', e);
  }
  return null; // null = padrão: todas ativas
}

function salvarListasVisiveis(arrayDeListas) {
  try {
    localStorage.setItem(STORAGE_KEY_LISTAS, JSON.stringify(arrayDeListas));
  } catch (e) {
    console.error('Erro ao salvar no localStorage', e);
  }
}

// ======================= NAVEGAÇÃO ENTRE ABAS =======================
tabs.forEach(btn => {
  btn.addEventListener('click', () => {
    tabs.forEach(b => b.classList.remove('active'));
    contents.forEach(c => c.classList.remove('active'));

    btn.classList.add('active');
    const targetSection = document.getElementById(btn.dataset.tab);
    if (targetSection) targetSection.classList.add('active');

    if (btn.dataset.tab === 'dashboard') {
      carregarDashboard();
    }
  });
});

// ======================= CONTROLE DA SIDEBAR DE LISTAS =======================
function alternarSidebar() {
  const estaFechada = listsSidebar.classList.toggle('collapsed');
  btnToggleSidebar.classList.toggle('open', !estaFechada);
  sidebarBackdrop.classList.toggle('active', !estaFechada);
}

btnToggleSidebar.addEventListener('click', alternarSidebar);
sidebarBackdrop.addEventListener('click', alternarSidebar);

// ======================= COMUNICAÇÃO COM API =======================
async function chamarApi(action, extraParams = {}) {
  // Todas as ações atuais usam GET, inclusive conclusão. Na evolução da API,
  // separar consultas de alterações e substituir o token exposto no navegador.
  const params = new URLSearchParams({
    action: action,
    token: CONFIG.TOKEN,
    ...extraParams
  });

  const url = `${CONFIG.APPS_SCRIPT_URL}?${params.toString()}`;
  const resp = await fetch(url, { method: 'GET' });
  if (!resp.ok) {
    throw new Error(`Falha na requisição HTTP: ${resp.status}`);
  }
  const json = await resp.json();
  if (json.error) {
    throw new Error(json.error);
  }
  return json;
}

// ======================= FORMATAÇÃO DE DATAS =======================
function formatarVencimento(dueString) {
  if (!dueString) return null;
  const data = new Date(dueString);
  if (isNaN(data.getTime())) return null;

  const hoje = new Date();
  const amanha = new Date();
  amanha.setDate(hoje.getDate() + 1);

  const ehHoje = data.toDateString() === hoje.toDateString();
  const ehAmanha = data.toDateString() === amanha.toDateString();
  const atrasada = data < new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());

  let texto = '';
  if (ehHoje) {
    texto = 'Hoje';
  } else if (ehAmanha) {
    texto = 'Amanhã';
  } else {
    texto = data.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  }

  return { texto, ehHoje, atrasada };
}

function formatarHoraEvento(inicioString) {
  if (!inicioString) return '';
  const d = new Date(inicioString);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// ======================= SISTEMA DE NOTIFICAÇÕES (TOASTS) =======================
function showToast(mensagem, tipo = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${tipo === 'error' ? 'error' : ''}`;
  
  const icon = tipo === 'error' 
    ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`
    : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

  toast.innerHTML = `
    <div class="toast-icon">${icon}</div>
    <div class="toast-text">${mensagem}</div>
  `;

  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'fadeOutDown 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ======================= AGRUPAMENTO DE TAREFAS =======================
function agruparTarefas(tasks, listasDefinidas) {
  // Limitação atual: o título é a chave; listas homônimas podem se misturar.
  // Ao evoluir o planejamento, usar listId também nas preferências de exibição.
  const grupos = {};

  // Se a API retornou a lista oficial de listas, inicializa todas (mesmo as vazias)
  if (Array.isArray(listasDefinidas) && listasDefinidas.length > 0) {
    listasDefinidas.forEach(lista => {
      grupos[lista.titulo] = {
        id: lista.id,
        titulo: lista.titulo,
        tarefas: []
      };
    });
  }

  // Distribui as tarefas nas suas respectivas listas
  tasks.forEach(task => {
    const nomeLista = task.listaNome || task.listId || 'Geral';
    if (!grupos[nomeLista]) {
      grupos[nomeLista] = {
        id: task.listId,
        titulo: nomeLista,
        tarefas: []
      };
    }
    grupos[nomeLista].tarefas.push(task);
  });

  return grupos;
}

function escolherCorAcento(titulo) {
  const t = titulo.toLowerCase();
  if (t.includes('prioridade')) return 'prioridades';
  if (t.includes('compra')) return 'compras';
  if (t.includes('dia') || t.includes('hábito') || t.includes('habito')) return 'habitos';
  return '';
}

// ======================= GESTÃO DO PAINEL LATERAL DE LISTAS =======================
function renderizarSidebarListas(grupos, totalEventos) {
  sidebarListsContainer.innerHTML = '';
  const todasListas = [];

  // Se houver eventos de agenda, adiciona o item da agenda
  if (totalEventos > 0) {
    todasListas.push({
      id: '__calendario__',
      titulo: 'Eventos de Hoje (Agenda)',
      count: totalEventos,
      isCalendar: true
    });
  }

  // Adiciona as listas do Google Tasks
  Object.keys(grupos).forEach(nome => {
    todasListas.push({
      id: grupos[nome].id || nome,
      titulo: nome,
      count: grupos[nome].tarefas.length,
      isCalendar: false
    });
  });

  // Se o usuário nunca configurou listas visíveis, todas começam ativas por padrão
  if (!listasVisiveis) {
    listasVisiveis = todasListas.map(l => l.titulo);
    salvarListasVisiveis(listasVisiveis);
  }

  let countAtivas = 0;

  todasListas.forEach(item => {
    const isAtiva = listasVisiveis.includes(item.titulo);
    if (isAtiva) countAtivas++;

    const div = document.createElement('div');
    div.className = `sidebar-list-item ${isAtiva ? 'selected' : ''}`;
    div.dataset.titulo = item.titulo;

    div.innerHTML = `
      <div class="custom-checkbox">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      </div>
      <span class="sidebar-list-name" title="${escapeHtml(item.titulo)}">${escapeHtml(item.titulo)}</span>
      <span class="sidebar-list-badge">${item.count}</span>
    `;

    div.addEventListener('click', () => {
      const index = listasVisiveis.indexOf(item.titulo);
      if (index > -1) {
        listasVisiveis.splice(index, 1);
        div.classList.remove('selected');
      } else {
        listasVisiveis.push(item.titulo);
        div.classList.add('selected');
      }
      salvarListasVisiveis(listasVisiveis);
      atualizarVisibilidadeColunas();
    });

    sidebarListsContainer.appendChild(div);
  });

  atualizarBadgeContador();
}

function atualizarVisibilidadeColunas() {
  let countAtivas = 0;
  document.querySelectorAll('.board-column').forEach(col => {
    const titulo = col.dataset.lista;
    if (!listasVisiveis || listasVisiveis.includes(titulo)) {
      col.classList.remove('hidden-by-filter');
      countAtivas++;
    } else {
      col.classList.add('hidden-by-filter');
    }
  });

  atualizarBadgeContador();
}

function atualizarBadgeContador() {
  const total = document.querySelectorAll('.sidebar-list-item').length;
  const ativas = listasVisiveis ? listasVisiveis.length : total;
  activeListsCount.textContent = `${ativas}/${total}`;
}

// Botões de Seleção Rápida no Painel de Listas
btnSelectAll.addEventListener('click', () => {
  const itens = document.querySelectorAll('.sidebar-list-item');
  listasVisiveis = [];
  itens.forEach(it => {
    listasVisiveis.push(it.dataset.titulo);
    it.classList.add('selected');
  });
  salvarListasVisiveis(listasVisiveis);
  atualizarVisibilidadeColunas();
  showToast('Todas as listas foram ativadas no quadro.');
});

btnDeselectAll.addEventListener('click', () => {
  listasVisiveis = [];
  document.querySelectorAll('.sidebar-list-item').forEach(it => {
    it.classList.remove('selected');
  });
  salvarListasVisiveis(listasVisiveis);
  atualizarVisibilidadeColunas();
  showToast('Todas as listas foram ocultadas. Marque as que deseja ver.');
});

// ======================= RENDERIZAÇÃO DO QUADRO KANBAN =======================
function renderizarQuadro(data) {
  boardContainer.innerHTML = '';
  const grupos = agruparTarefas(data.tasks || [], data.listas || []);
  const eventos = data.eventos || [];

  // Renderiza a sidebar de controle de listas
  renderizarSidebarListas(grupos, eventos.length);

  // 1. Coluna especial de EVENTOS DO CALENDÁRIO
  if (eventos.length > 0) {
    const colEventos = document.createElement('div');
    colEventos.className = 'board-column';
    colEventos.dataset.lista = 'Eventos de Hoje (Agenda)';
    colEventos.innerHTML = `
      <div class="column-header">
        <div class="column-title-group">
          <span class="column-accent-bar eventos"></span>
          <span class="column-title" title="Eventos de Hoje">Eventos de Hoje (Agenda)</span>
        </div>
        <span class="column-count">${eventos.length}</span>
      </div>
      <div class="column-cards" id="col-cards-eventos"></div>
    `;

    const cardsContainer = colEventos.querySelector('#col-cards-eventos');
    eventos.forEach(ev => {
      const card = document.createElement('div');
      card.className = 'task-card';
      card.dataset.titulo = (ev.titulo || '').toLowerCase();
      const horaStr = formatarHoraEvento(ev.inicio);
      card.innerHTML = `
        <button class="task-checkbox-btn" title="Marcar evento como concluído"
          data-origem="evento" data-id="${ev.id}" data-titulo="${escapeHtml(ev.titulo)}" data-categoria="Eventos do Dia">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </button>
        <div class="task-info">
          <div class="task-title">${escapeHtml(ev.titulo)}</div>
          <div class="task-meta">
            ${horaStr ? `<span class="task-due hoje">⏰ ${horaStr}</span>` : ''}
            <span class="task-origem-badge">Google Calendar</span>
          </div>
        </div>
      `;
      cardsContainer.appendChild(card);
    });

    boardContainer.appendChild(colEventos);
  }

  // 2. Colunas para cada Lista do Google Tasks
  const nomesListas = Object.keys(grupos);
  nomesListas.forEach(nomeLista => {
    const grupo = grupos[nomeLista];
    const qtdTarefas = grupo.tarefas.length;
    const acento = escolherCorAcento(grupo.titulo);

    const col = document.createElement('div');
    col.className = 'board-column';
    col.dataset.lista = grupo.titulo;

    col.innerHTML = `
      <div class="column-header">
        <div class="column-title-group">
          <span class="column-accent-bar ${acento}"></span>
          <span class="column-title" title="${escapeHtml(grupo.titulo)}">${escapeHtml(grupo.titulo)}</span>
        </div>
        <span class="column-count ${qtdTarefas === 0 ? 'zero' : ''}">${qtdTarefas}</span>
      </div>
      <div class="column-cards" id="cards-${escapeAttr(grupo.id || nomeLista)}"></div>
    `;

    const cardsContainer = col.querySelector('.column-cards');

    if (qtdTarefas === 0) {
      cardsContainer.innerHTML = `
        <div class="column-empty">
          <div class="empty-icon-circle">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </div>
          <h4>Tudo concluído!</h4>
          <p>Nenhuma tarefa pendente nesta lista.</p>
        </div>
      `;
    } else {
      grupo.tarefas.forEach(t => {
        const card = document.createElement('div');
        card.className = 'task-card';
        card.dataset.titulo = (t.titulo || '').toLowerCase();

        const dueInfo = formatarVencimento(t.vencimento);
        let dueBadgeHtml = '';
        if (dueInfo) {
          const dueClass = dueInfo.atrasada ? 'atrasada' : (dueInfo.ehHoje ? 'hoje' : '');
          dueBadgeHtml = `<span class="task-due ${dueClass}">📅 ${dueInfo.texto}</span>`;
        }

        const notesHtml = t.notes 
          ? `<div class="task-notes" title="${escapeHtml(t.notes)}">${escapeHtml(t.notes)}</div>` 
          : '';

        card.innerHTML = `
          <button class="task-checkbox-btn" title="Concluir tarefa"
            data-origem="task"
            data-id="${escapeAttr(t.id)}"
            data-listid="${escapeAttr(t.listId)}"
            data-titulo="${escapeAttr(t.titulo)}"
            data-listanome="${escapeAttr(grupo.titulo)}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </button>
          <div class="task-info">
            <div class="task-title">${escapeHtml(t.titulo)}</div>
            ${notesHtml}
            ${dueBadgeHtml ? `<div class="task-meta">${dueBadgeHtml}</div>` : ''}
          </div>
        `;
        cardsContainer.appendChild(card);
      });
    }

    boardContainer.appendChild(col);
  });

  // Aplica o filtro de visibilidade salvo
  atualizarVisibilidadeColunas();

  // Vincula eventos de clique nos checkboxes
  vincularBotoesConcluir();

  // Aplica filtro de texto se houver
  if (inputFiltro.value.trim()) {
    aplicarFiltro(inputFiltro.value.trim());
  }
}

// ======================= CONCLUIR TAREFA =======================
function vincularBotoesConcluir() {
  // Este checkbox significa execução concluída, não aprovação para fazer.
  // Para eventos, a API atual só registra no Sheets; não modifica o Calendar.
  document.querySelectorAll('.task-checkbox-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('.task-card');
      if (!card || card.classList.contains('completing')) return;

      const titulo = btn.dataset.titulo;
      const origem = btn.dataset.origem;
      const id = btn.dataset.id;
      const listId = btn.dataset.listid || '';
      const listaNome = btn.dataset.listanome || btn.dataset.categoria || 'Geral';

      card.classList.add('completing');
      btn.disabled = true;

      try {
        await chamarApi('concluir', {
          origem: origem,
          id: id,
          listId: listId,
          titulo: titulo,
          categoria: listaNome,
          listaNome: listaNome
        });

        card.style.transition = 'all 0.35s ease';
        card.style.maxHeight = `${card.offsetHeight}px`;
        requestAnimationFrame(() => {
          card.style.opacity = '0';
          card.style.transform = 'scale(0.85) translateY(-10px)';
          card.style.maxHeight = '0';
          card.style.padding = '0';
          card.style.margin = '0';
          card.style.border = 'none';
        });

        setTimeout(() => {
          const colCards = card.closest('.column-cards');
          const col = card.closest('.board-column');
          card.remove();

          if (col) {
            const countBadge = col.querySelector('.column-count');
            const restantes = colCards ? colCards.querySelectorAll('.task-card').length : 0;
            if (countBadge) {
              countBadge.textContent = restantes;
              if (restantes === 0) countBadge.classList.add('zero');
            }

            if (restantes === 0 && colCards) {
              colCards.innerHTML = `
                <div class="column-empty">
                  <div class="empty-icon-circle">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                  </div>
                  <h4>Tudo concluído!</h4>
                  <p>Nenhuma tarefa pendente nesta lista.</p>
                </div>
              `;
            }
          }

          showToast(`Tarefa "${titulo}" concluída e gravada no Sheets!`);
        }, 360);

      } catch (err) {
        card.classList.remove('completing');
        btn.disabled = false;
        showToast(`Erro ao concluir tarefa: ${err.message}`, 'error');
      }
    });
  });
}

// ======================= FILTRAGEM DE TAREFAS (BUSCA) =======================
function aplicarFiltro(query) {
  const q = query.toLowerCase();
  document.querySelectorAll('.task-card').forEach(card => {
    const titulo = card.dataset.titulo || card.textContent.toLowerCase();
    if (titulo.includes(q)) {
      card.style.display = '';
    } else {
      card.style.display = 'none';
    }
  });
}

inputFiltro.addEventListener('input', e => {
  aplicarFiltro(e.target.value.trim());
});

// ======================= CARREGAR DADOS PENDENTES =======================
async function carregarPendentes(mostrarFeedback = false) {
  try {
    if (mostrarFeedback) {
      btnAtualizar.classList.add('spinning');
      syncStatus.innerHTML = '<span class="status-dot syncing"></span> Sincronizando...';
    } else {
      boardLoading.classList.remove('hidden');
      boardContainer.classList.add('hidden');
    }

    const data = await chamarApi('listar');
    dadosAtuais = data;

    renderizarQuadro(data);

    syncStatus.innerHTML = '<span class="status-dot online"></span> Conectado';
    if (mostrarFeedback) {
      showToast('Tarefas sincronizadas com sucesso!');
    }
  } catch (err) {
    syncStatus.innerHTML = '<span class="status-dot offline" style="background:#ef4444;box-shadow:0 0 8px #ef4444;"></span> Erro';
    showToast(`Erro ao sincronizar tarefas: ${err.message}`, 'error');
  } finally {
    boardLoading.classList.add('hidden');
    boardContainer.classList.remove('hidden');
    btnAtualizar.classList.remove('spinning');
  }
}

btnAtualizar.addEventListener('click', () => carregarPendentes(true));

// ======================= DASHBOARD & MÉTRICAS =======================
async function carregarDashboard() {
  const taxaEl = document.getElementById('taxa');
  const feitosEl = document.getElementById('feitos');
  const naoFeitosEl = document.getElementById('naofeitos');
  const totalRegEl = document.getElementById('total-registros');

  try {
    const data = await chamarApi('dashboard');

    const taxa = data.taxaCumprimento || 0;
    const feitos = data.totalFeito || 0;
    const naoFeitos = data.totalNaoFeito || 0;
    const total = feitos + naoFeitos;

    taxaEl.textContent = `${taxa}%`;
    feitosEl.textContent = feitos;
    naoFeitosEl.textContent = naoFeitos;
    totalRegEl.textContent = total;

    renderizarGraficoDias(data.porDia || {});
    renderizarGraficoCategorias(data.porCategoria || {});
  } catch (err) {
    showToast(`Erro ao carregar métricas: ${err.message}`, 'error');
  }
}

btnRecarregarDash.addEventListener('click', carregarDashboard);

function renderizarGraficoDias(porDia) {
  const canvas = document.getElementById('grafico-dias');
  if (!canvas) return;

  const dias = Object.keys(porDia).sort();
  const dadosFeitos = dias.map(d => porDia[d].feito || 0);
  const dadosNaoFeitos = dias.map(d => porDia[d].naoFeito || 0);

  if (graficoDiasInstance) graficoDiasInstance.destroy();

  graficoDiasInstance = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: dias.length > 0 ? dias : ['Sem registros ainda'],
      datasets: [
        {
          label: 'Feito',
          data: dias.length > 0 ? dadosFeitos : [0],
          backgroundColor: '#10b981',
          borderRadius: 6
        },
        {
          label: 'Não feito',
          data: dias.length > 0 ? dadosNaoFeitos : [0],
          backgroundColor: '#ef4444',
          borderRadius: 6
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: '#94a3b8', font: { family: 'Inter', size: 12 } }
        }
      },
      scales: {
        x: {
          ticks: { color: '#64748b' },
          grid: { color: 'rgba(255, 255, 255, 0.05)' }
        },
        y: {
          ticks: { color: '#64748b', stepSize: 1 },
          grid: { color: 'rgba(255, 255, 255, 0.05)' }
        }
      }
    }
  });
}

function renderizarGraficoCategorias(porCategoria) {
  const canvas = document.getElementById('grafico-categorias');
  if (!canvas) return;

  const categorias = Object.keys(porCategoria);
  const valores = categorias.map(c => porCategoria[c].feito || 0);

  if (graficoCategoriasInstance) graficoCategoriasInstance.destroy();

  const cores = [
    '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6',
    '#ec4899', '#06b6d4', '#14b8a6', '#f97316'
  ];

  graficoCategoriasInstance = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: categorias.length > 0 ? categorias : ['Sem dados ainda'],
      datasets: [{
        data: categorias.length > 0 ? valores : [1],
        backgroundColor: categorias.length > 0 ? cores.slice(0, categorias.length) : ['#334155'],
        borderWidth: 2,
        borderColor: '#161e2e'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#94a3b8', font: { family: 'Inter', size: 11 }, padding: 12 }
        }
      },
      cutout: '70%'
    }
  });
}

// ======================= HELPERS DE SEGURANÇA =======================
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttr(str) {
  if (!str) return '';
  return String(str).replace(/"/g, '&quot;');
}

// ======================= INICIALIZAÇÃO =======================
carregarPendentes();
