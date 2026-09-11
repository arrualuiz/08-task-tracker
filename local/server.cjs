/** Servidor exclusivo de localhost. Não expõe arquivos do projeto ou credenciais. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { openStore } = require('./store.cjs');
const root = path.resolve(__dirname, '..');

function createServer(store) {
  return http.createServer(async (req, res) => {
    const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(body)); };
    try {
      const port = req.socket.localPort;
      const hosts = [`localhost:${port}`, `127.0.0.1:${port}`];
      // Bloqueia origens externas e DNS rebinding mesmo sem autenticação local.
      if (!hosts.includes(req.headers.host)) return json(403, { error: 'Host não permitido.' });
      if (req.headers.origin && !hosts.map(h => `http://${h}`).includes(req.headers.origin)) return json(403, { error: 'Origem não permitida.' });
      const url = new URL(req.url, `http://${req.headers.host}`);
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
      const files = { '/': ['dia.html', 'text/html'], '/dia.js': ['dia.js', 'text/javascript'], '/dia.css': ['dia.css', 'text/css'], '/revisao': ['revisao.html', 'text/html'], '/revisao.js': ['revisao.js', 'text/javascript'], '/revisao.css': ['revisao.css', 'text/css'] };
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
  const server = createServer(store);
  server.listen(Number(process.env.PORT || 3210), '127.0.0.1', () => console.log(`Task Tracker: http://localhost:${server.address().port}`));
  server.on('error', error => { console.error(error.message); store.close(); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { store.close(); process.exit(0); }));
}
module.exports = { createServer };
