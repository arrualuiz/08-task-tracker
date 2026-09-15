/**
 * TASK TRACKER API — Google Apps Script
 * ---------------------------------------------------
 * Expõe uma Web App (doGet/doPost) com estas ações:
 *   - listar     -> retorna tasks pendentes + eventos de hoje
 *   - concluir   -> marca task como concluída e grava log no Sheets
 *   - dashboard  -> retorna estatísticas agregadas do Sheets
 *
 * Também tem um trigger diário (snapshotDiario) que registra
 * como "não feito" tudo que ficou pendente no fim do dia.
 */

// ======================= CONFIGURAÇÃO =======================
// Preencha com o ID da sua planilha Google Sheets e um token secreto.
// Nunca commite valores reais neste arquivo; mantenha-os apenas no ambiente do Apps Script.
const SPREADSHEET_ID = 'SEU_SPREADSHEET_ID_AQUI';
const SHEET_LOG = 'Log';
const SECRET_TOKEN = 'SEU_TOKEN_SECRETO_AQUI';

// ======================= ROTEAMENTO =======================
function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  try {
    const params = (e && e.parameter) || {};

    if (params.token !== SECRET_TOKEN) {
      return jsonResponse({ error: 'Token inválido' });
    }

    switch (params.action) {
      case 'listar':
        return jsonResponse(listarPendentes());
      case 'concluir':
        return jsonResponse(concluirItem(params));
      case 'dashboard':
        return jsonResponse(gerarDashboard());
      default:
        return jsonResponse({ error: 'Ação desconhecida: ' + params.action });
    }
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ======================= GOOGLE TASKS =======================
// Requer o serviço avançado "Tasks API" ativado (ver appsscript.json)
function listarTasksPendentes() {
  const listas = Tasks.Tasklists.list().items || [];
  let todas = [];
  let listasInfo = [];

  listas.forEach(function (lista) {
    listasInfo.push({ id: lista.id, titulo: lista.title });
    const resultado = Tasks.Tasks.list(lista.id, {
      showCompleted: false,
      maxResults: 100
    });
    const tasks = resultado.items || [];

    tasks.forEach(function (t) {
      todas.push({
        id: t.id,
        listId: lista.id,
        listaNome: lista.title,
        titulo: t.title,
        notes: t.notes || '',
        vencimento: t.due || null,
        origem: 'task'
      });
    });
  });

  return { todas: todas, listas: listasInfo };
}

// ======================= GOOGLE CALENDAR =======================
function listarEventosHoje() {
  const hoje = new Date();
  const inicio = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const fim = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + 1);
  const eventos = CalendarApp.getDefaultCalendar().getEvents(inicio, fim);

  return eventos.map(function (ev) {
    return {
      id: ev.getId(),
      titulo: ev.getTitle(),
      inicio: ev.getStartTime(),
      origem: 'evento'
    };
  });
}

// ======================= AÇÃO: LISTAR =======================
function listarPendentes() {
  const tasksData = listarTasksPendentes();
  return {
    tasks: tasksData.todas,
    listas: tasksData.listas,
    eventos: listarEventosHoje()
  };
}

// ======================= AÇÃO: CONCLUIR =======================
function concluirItem(params) {
  // Tasks e Sheets são escritas independentes: se o log falhar após o patch,
  // a tarefa já estará concluída. A evolução deve reconciliar por ID estável.
  const origem = params.origem;
  const id = params.id;
  const listId = params.listId;
  const titulo = params.titulo || id;
  const categoria = params.categoria || params.listaNome || (origem === 'evento' ? 'Eventos do Dia' : 'Geral');

  if (origem === 'task') {
    Tasks.Tasks.patch({ status: 'completed' }, listId, id);
  }
  // Eventos de calendário não têm "completed" nativo — só logamos.

  registrarLog(titulo, categoria, 'feito', origem);
  return { ok: true };
}

// ======================= SHEETS: LOG =======================
function getSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_LOG);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_LOG);
    sheet.appendRow(['data', 'hora', 'item', 'categoria', 'status', 'origem']);
  }

  return sheet;
}

function registrarLog(item, categoria, status, origem) {
  const sheet = getSheet();
  const agora = new Date();
  const tz = Session.getScriptTimeZone();

  sheet.appendRow([
    Utilities.formatDate(agora, tz, 'yyyy-MM-dd'),
    Utilities.formatDate(agora, tz, 'HH:mm:ss'),
    item,
    categoria,
    status,
    origem
  ]);
}

// ======================= AÇÃO: DASHBOARD =======================
function gerarDashboard() {
  const sheet = getSheet();
  const dados = sheet.getDataRange().getValues();
  dados.shift(); // remove cabeçalho

  let totalFeito = 0;
  let totalNaoFeito = 0;
  const porCategoria = {};
  const porDia = {};

  dados.forEach(function (row) {
    const data = row[0];
    const item = row[2];
    const categoria = row[3] || 'geral';
    const status = row[4];

    if (status === 'feito') totalFeito++;
    else if (status === 'não feito') totalNaoFeito++;

    if (!porCategoria[categoria]) porCategoria[categoria] = { feito: 0, naoFeito: 0 };
    if (status === 'feito') porCategoria[categoria].feito++;
    else porCategoria[categoria].naoFeito++;

    if (!porDia[data]) porDia[data] = { feito: 0, naoFeito: 0 };
    if (status === 'feito') porDia[data].feito++;
    else porDia[data].naoFeito++;
  });

  const total = totalFeito + totalNaoFeito;

  return {
    totalFeito: totalFeito,
    totalNaoFeito: totalNaoFeito,
    taxaCumprimento: total > 0 ? Number(((totalFeito / total) * 100).toFixed(1)) : 0,
    porCategoria: porCategoria,
    porDia: porDia
  };
}

// ======================= TRIGGER DIÁRIO =======================
// Marca como "não feito" tudo que ainda estava pendente no fim do dia.
function snapshotDiario() {
  // Limitação atual: inclui tarefas futuras/sem data e eventos já logados.
  // O planejamento deverá filtrar ocorrências aprovadas do dia e evitar duplicatas.
  const pendentes = listarPendentes();

  pendentes.tasks.forEach(function (t) {
    registrarLog(t.titulo, t.listaNome || 'Geral', 'não feito', 'task');
  });

  pendentes.eventos.forEach(function (ev) {
    registrarLog(ev.titulo, 'Eventos do Dia', 'não feito', 'evento');
  });
}

/**
 * Rode esta função MANUALMENTE uma única vez (no editor do Apps Script)
 * para criar o gatilho automático diário às 23h.
 */
function criarTriggerDiario() {
  ScriptApp.newTrigger('snapshotDiario')
    .timeBased()
    .everyDays(1)
    .atHour(23)
    .create();
}
