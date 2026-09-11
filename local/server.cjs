/** Servidor exclusivo de localhost. Não expõe arquivos do projeto ou credenciais. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { openStore } = require('./store.cjs');
const root = path.resolve(__dirname, '..');

function createServer(store, calendars = null) {
  return http.createServer(async (req, res) => {
    const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(body)); };
    try {
      const port = req.socket.localPort;
      const hosts = [`localhost:${port}`, `127.0.0.1:${port}`];
      // Bloqueia origens externas e DNS rebinding mesmo sem autenticação local.
      if (!hosts.includes(req.headers.host)) return json(403, { error: 'Host não permitido.' });
      if (req.headers.origin && !hosts.map(h => `http://${h}`).includes(req.headers.origin)) return json(403, { error: 'Origem não permitida.' });
      const url = new URL(req.url, `http://${req.headers.host}`);
      // Mesmo endereço de retorno da configuração; nunca aceita um host fornecido sem validação.
      const origin = `http://${req.headers.host}`;
      if (url.pathname.startsWith('/api/calendars') || url.pathname.startsWith('/api/tasks/') || url.pathname === '/oauth/google/callback') {
        if (!calendars) return json(503, { error: 'Integração de calendários indisponível neste servidor.' });
        const body = async () => {
          if (!req.headers['content-type']?.startsWith('application/json')) throw Object.assign(new Error('Envie JSON.'), { status: 415 });
          let raw = '';
          for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 500000) throw Object.assign(new Error('Arquivo ou consulta muito grande.'), { status: 413 }); }
          try { return JSON.parse(raw); } catch { throw Object.assign(new Error('JSON inválido.'), { status: 400 }); }
        };
        if (req.method === 'GET' && url.pathname === '/api/calendars/status') return json(200, calendars.status(origin));
        if (req.method === 'POST' && url.pathname === '/api/calendars/config') return json(200, calendars.configure(await body(), origin));
        if (req.method === 'POST' && url.pathname === '/api/calendars/connect') {
          const input = await body(); const attempt = calendars.begin(origin, { includeTasks: input?.includeTasks === true });
          res.setHeader('Set-Cookie', `calendar_oauth=${attempt.state}; HttpOnly; SameSite=Lax; Path=/oauth/google/callback; Max-Age=600`);
          return json(200, { url: attempt.url });
        }
        if (req.method === 'GET' && url.pathname === '/oauth/google/callback') {
          const cookie = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('calendar_oauth='))?.slice('calendar_oauth='.length);
          let location = '/calendarios?connection=success';
          try { const result = await calendars.finish(url.searchParams, cookie, origin); location = `${result.returnPath}?connection=success`; }
          catch (error) { location = `/calendarios?connection=error&reason=${encodeURIComponent(error.status ? error.message : 'Não foi possível concluir a conexão. Tente novamente.')}`; }
          // Remove código e estado da barra de endereço e impede envio deles como Referer.
          res.writeHead(303, { Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Set-Cookie': 'calendar_oauth=; HttpOnly; SameSite=Lax; Path=/oauth/google/callback; Max-Age=0' });
          return res.end();
        }
        if (req.method === 'POST' && url.pathname === '/api/calendars/disconnect') { const input = await body(); return json(200, calendars.disconnect(input?.accountId)); }
        if (req.method === 'GET' && url.pathname === '/api/calendars/list') return json(200, await calendars.list());
        if (req.method === 'GET' && url.pathname === '/api/tasks/lists') return json(200, await calendars.tasks.lists());
        if (req.method === 'POST' && url.pathname === '/api/tasks/list') return json(200, await calendars.tasks.list(await body()));
        if (req.method === 'POST' && url.pathname === '/api/calendars/events') return json(200, await calendars.events(await body()));
      }
      const planMatch = /^\/api\/days\/(\d{4}-\d{2}-\d{2})(\/history)?$/.exec(url.pathname);
      if (planMatch && req.method === 'GET') return json(200, planMatch[2] ? {history:store.planning.history(planMatch[1])} : store.planning.get(planMatch[1]));
      if (planMatch && !planMatch[2] && req.method === 'PUT') {
        if (!req.headers['content-type']?.startsWith('application/json')) return json(415, {error:'Envie JSON.'});
        let body = '';
        for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 2000000) return json(413, {error:'Planejamento muito grande.'}); }
        let input;
        try { input = JSON.parse(body); } catch { return json(400, {error:'JSON inválido.'}); }
        return json(200, store.planning.save(planMatch[1], input));
      }
      if (req.method === 'GET' && url.pathname === '/api/routines') return json(200, { routines: store.list() });
      if (req.method === 'GET' && url.pathname === '/api/export') {
        res.setHeader('Content-Disposition', 'attachment; filename="task-tracker-backup.json"');
        return json(200, store.export());
      }
      const match = /^\/api\/routines\/([a-f0-9]{32})(\/history)?$/.exec(url.pathname);
      if (match && req.method === 'GET' && match[2]) return json(200, { history: store.history(match[1]) });
      if (match && req.method === 'PUT' && !match[2]) {
        if (!req.headers['content-type']?.startsWith('application/json')) return json(415, { error: 'Envie JSON.' });
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (Buffer.byteLength(body) > 20000) return json(413, { error: 'Conteúdo muito grande.' });
        }
        let input;
        try { input = JSON.parse(body); } catch { return json(400, { error: 'JSON inválido.' }); }
        return json(200, { routine: store.update(match[1], input) });
      }
      const files = { '/': ['dia.html', 'text/html'], '/dia.js': ['dia.js', 'text/javascript'], '/dia.css': ['dia.css', 'text/css'], '/tarefas': ['tarefas.html', 'text/html'], '/tarefas.js': ['tarefas.js', 'text/javascript'], '/calendarios': ['calendarios.html', 'text/html'], '/calendarios.js': ['calendarios.js', 'text/javascript'], '/calendarios.css': ['calendarios.css', 'text/css'], '/revisao': ['revisao.html', 'text/html'], '/revisao.js': ['revisao.js', 'text/javascript'], '/revisao.css': ['revisao.css', 'text/css'] };
      if (req.method === 'GET' && files[url.pathname]) {
        const [file, mime] = files[url.pathname];
        res.writeHead(200, { 'Content-Type': `${mime}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'" });
        return res.end(fs.readFileSync(path.join(root, 'site', file)));
      }
      json(404, { error: 'Página não encontrada.' });
    } catch (error) { json(error.status || 500, { error: error.status ? error.message : 'Não foi possível salvar ou carregar. Tente novamente.' }); }
  });
}
if (require.main === module) {
  const store = openStore(path.join(root, 'dados-locais', 'task-tracker.sqlite'), path.join(root, 'dados-locais', 'rotinas', 'inventario.json'));
  const calendars = require('./calendars.cjs').openCalendars(path.join(root, 'dados-locais', 'google-private.sqlite'));
  const server = createServer(store, calendars);
  server.listen(Number(process.env.PORT || 3210), '127.0.0.1', () => console.log(`Task Tracker: http://localhost:${server.address().port}`));
  server.on('error', error => { console.error(error.message); store.close(); calendars.close(); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { store.close(); calendars.close(); process.exit(0); }));
}
module.exports = { createServer };
