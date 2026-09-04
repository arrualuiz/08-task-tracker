const tabs = document.querySelectorAll('.tab-btn');
const contents = document.querySelectorAll('.tab-content');

tabs.forEach(function (btn) {
  btn.addEventListener('click', function () {
    tabs.forEach(function (b) { b.classList.remove('active'); });
    contents.forEach(function (c) { c.classList.remove('active'); });

    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');

    if (btn.dataset.tab === 'dashboard') carregarDashboard();
  });
});

async function chamarApi(action, extraParams) {
  const params = new URLSearchParams(Object.assign(
    { action: action, token: CONFIG.TOKEN },
    extraParams || {}
  ));
  const resp = await fetch(CONFIG.APPS_SCRIPT_URL + '?' + params.toString());
  return resp.json();
}

async function carregarPendentes() {
  const data = await chamarApi('listar');
  const listaTasks = document.getElementById('lista-tasks');
  const listaEventos = document.getElementById('lista-eventos');

  listaTasks.innerHTML = '';
  (data.tasks || []).forEach(function (t) {
    const li = document.createElement('li');
    li.innerHTML = '<span>' + t.titulo + '</span>' +
      '<button data-origem="task" data-id="' + t.id + '" ' +
      'data-listid="' + t.listId + '" data-titulo="' + t.titulo + '">Concluir</button>';
    listaTasks.appendChild(li);
  });

  listaEventos.innerHTML = '';
  (data.eventos || []).forEach(function (ev) {
    const li = document.createElement('li');
    li.innerHTML = '<span>' + ev.titulo + '</span>' +
      '<button data-origem="evento" data-id="' + ev.id + '" ' +
      'data-titulo="' + ev.titulo + '">Concluir</button>';
    listaEventos.appendChild(li);
  });

  document.querySelectorAll('button[data-origem]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      btn.disabled = true;
      await chamarApi('concluir', {
        origem: btn.dataset.origem,
        id: btn.dataset.id,
        listId: btn.dataset.listid || '',
        titulo: btn.dataset.titulo,
        categoria: btn.dataset.origem
      });
      btn.closest('li').remove();
    });
  });
}

let graficoDias, graficoCategorias;

async function carregarDashboard() {
  const data = await chamarApi('dashboard');

  document.getElementById('taxa').textContent = data.taxaCumprimento + '%';
  document.getElementById('feitos').textContent = data.totalFeito;
  document.getElementById('naofeitos').textContent = data.totalNaoFeito;

  const dias = Object.keys(data.porDia || {}).sort();

  if (graficoDias) graficoDias.destroy();
  graficoDias = new Chart(document.getElementById('grafico-dias'), {
    type: 'bar',
    data: {
      labels: dias,
      datasets: [
        { label: 'Feito', data: dias.map(function (d) { return data.porDia[d].feito; }), backgroundColor: '#4caf50' },
        { label: 'Não feito', data: dias.map(function (d) { return data.porDia[d].naoFeito; }), backgroundColor: '#e53935' }
      ]
    },
    options: { responsive: true, plugins: { legend: { labels: { color: '#e6e6e6' } } },
      scales: { x: { ticks: { color: '#aaa' } }, y: { ticks: { color: '#aaa' } } } }
  });

  const categorias = Object.keys(data.porCategoria || {});

  if (graficoCategorias) graficoCategorias.destroy();
  graficoCategorias = new Chart(document.getElementById('grafico-categorias'), {
    type: 'pie',
    data: {
      labels: categorias,
      datasets: [{
        data: categorias.map(function (c) { return data.porCategoria[c].feito; }),
        backgroundColor: ['#4caf50', '#2196f3', '#ff9800', '#9c27b0', '#f44336']
      }]
    },
    options: { plugins: { legend: { labels: { color: '#e6e6e6' } } } }
  });
}

carregarPendentes();
