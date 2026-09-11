/** Toda comunicação Google é simulada e todos os bancos são temporários. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openCalendars, SCOPES, TASKS_SCOPE, MAX_CALENDARS } = require('./calendars.cjs');
const { openStore } = require('./store.cjs');
const { createServer } = require('./server.cjs');
const origin = 'http://localhost:3210';
const configuration = address => ({ web: { client_id: 'test-client.apps.googleusercontent.com', client_secret: 'fake-test-secret', redirect_uris: [`${address}/oauth/google/callback`] } });

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'task-tracker-calendars-'));
  const filename = path.join(directory, 'google.sqlite');
  let instant = Date.parse('2026-09-11T09:00:00Z');
  const calls = [], options = { failAccount: '', omitScope: false, duplicatePage: false, grantTasks: false, active: 0, maxActive: 0, delayEvents: false };
  const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  const transport = async (input, init) => {
    const url = new URL(input); calls.push({ url, init });
    if (url.hostname === 'oauth2.googleapis.com') {
      const params = new URLSearchParams(init.body), id = params.get('code') || params.get('refresh_token')?.replace('fake-refresh-', '');
      return reply({ access_token: `fake-access-${id}`, refresh_token: `fake-refresh-${id}`, expires_in: 3600, scope: options.omitScope ? 'openid email' : [...SCOPES, ...(options.grantTasks ? [TASKS_SCOPE] : [])].join(' ') });
    }
    const id = init.headers.Authorization.replace('Bearer fake-access-', '');
    if (url.hostname === 'openidconnect.googleapis.com') return reply({ sub: id, email: `${id}@example.test`, email_verified: true });
    if (url.hostname === 'tasks.googleapis.com') {
      assert.equal(init.method, undefined, 'Google Tasks somente leitura');
      if (options.failAccount === id) return reply({ error: {} }, 403);
      if (url.pathname.endsWith('/users/@me/lists')) return reply({ items: [{ id: url.searchParams.has('pageToken') ? 'list-2' : 'list-1', title: 'Mesmo nome' }], ...(url.searchParams.has('pageToken') ? {} : { nextPageToken: 'lists-next' }) });
      assert.ok(url.pathname.endsWith('/tasks'));
      if (!url.searchParams.has('pageToken')) return reply({ items: [{ id: 'parent', title: '<script>texto</script>', status: 'needsAction', due: '2026-09-11T00:00:00.000Z', notes: 'Comentário original', position: '1', webViewLink: 'javascript:alert(1)' }, { id: 'deleted', deleted: true, status: 'needsAction' }], nextPageToken: 'tasks-next' });
      return reply({ items: [{ id: 'child', parent: 'parent', title: 'Subtarefa sem data', status: 'needsAction', position: '2' }, { id: 'done', title: 'Concluída', status: 'completed', hidden: true, position: '3' }, { id: 'parent', title: 'Duplicata', status: 'needsAction' }] });
    }
    assert.equal(url.hostname, 'www.googleapis.com');
    assert.equal(init.method, undefined, 'API de calendário somente leitura');
    if (options.failAccount === id) return reply({ error: { message: 'Não expor mensagem bruta nem segredos' } }, 403);
    if (url.pathname.endsWith('/calendarList')) return reply({ items: [{ id: url.searchParams.has('pageToken') ? 'secondary@example.test' : 'primary@example.test', summary: 'Mesmo nome', primary: !url.searchParams.has('pageToken'), accessRole: 'owner' }], ...(url.searchParams.has('pageToken') ? {} : { nextPageToken: 'page-2' }) });
    assert.ok(url.pathname.endsWith('/events'));
    if (options.delayEvents) { options.active++; options.maxActive = Math.max(options.active, options.maxActive); await new Promise(resolve => setTimeout(resolve, 1)); options.active--; }
    if (!url.searchParams.has('pageToken')) return reply({ items: [{ id: 'all-day', summary: '<script>não executar</script>', start: { date: '2026-09-11' }, end: { date: '2026-09-13' }, htmlLink: 'javascript:alert(1)' }, { id: 'cancelled', status: 'cancelled', start: { date: '2026-09-11' } }], nextPageToken: 'event-page-2' });
    return reply({ items: [{ id: 'instance-1', summary: 'Exceção da série', recurringEventId: 'series-1', originalStartTime: { dateTime: '2026-09-11T10:00:00-03:00' }, start: { dateTime: '2026-09-11T14:00:00-03:00' }, end: { dateTime: '2026-09-11T15:00:00-03:00' }, htmlLink: 'https://calendar.google.com/calendar/event?eid=test' }], ...(options.duplicatePage ? { nextPageToken: 'event-page-2' } : {}) });
  };
  let calendars = openCalendars(filename, { fetch: transport, now: () => instant });
  // No Windows, encerra servidor e bancos antes de remover a pasta temporária.
  const cleanups = [];
  t.after(async () => { for (const cleanup of cleanups) await cleanup(); calendars.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { directory, calls, options, cleanups, get calendars() { return calendars; }, advance(ms) { instant += ms; }, restart() { calendars.close(); calendars = openCalendars(filename, { fetch: transport, now: () => instant }); } };
}
async function connect(calendars, id = 'a', address = origin, includeTasks = false) {
  const attempt = calendars.begin(address, { includeTasks });
  await calendars.finish(new URLSearchParams({ state: attempt.state, code: id }), attempt.state, address);
  return attempt;
}

test('configuração, OAuth vinculado ao navegador e contas estáveis sem vazar tokens', async t => {
  const f = fixture(t), c = f.calendars;
  assert.equal(c.status(origin).configured, false);
  assert.throws(() => c.begin(origin), { status: 409 });
  assert.throws(() => c.configure({ installed: configuration(origin).web }, origin), { status: 400 });
  assert.throws(() => c.configure(configuration('http://localhost:9999'), origin), { status: 400 });
  c.configure(configuration(origin), origin);
  const attempt = c.begin(origin), auth = new URL(attempt.url);
  assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
  assert.deepEqual(auth.searchParams.get('scope').split(' '), SCOPES);
  assert.ok(!auth.searchParams.has('client_secret'));
  await assert.rejects(c.finish(new URLSearchParams({ state: attempt.state, code: 'a' }), 'wrong-cookie', origin), { status: 400 });
  assert.equal(f.calls.length, 0);
  await c.finish(new URLSearchParams({ state: attempt.state, code: 'a' }), attempt.state, origin);
  await assert.rejects(c.finish(new URLSearchParams({ state: attempt.state, code: 'a' }), attempt.state, origin), { status: 400 });
  await connect(c, 'a'); await connect(c, 'b');
  assert.equal(c.status(origin).accounts.length, 2);
  assert.doesNotMatch(JSON.stringify(c.status(origin)), /fake-access|fake-refresh|fake-test-secret/);
  assert.throws(() => c.configure(configuration(origin), origin), { status: 409 });
  f.restart();
  assert.deepEqual(f.calendars.status(origin).accounts.map(a => a.id), ['google:a', 'google:b']);
  f.calendars.disconnect('google:a');
  assert.equal(f.calendars.status(origin).accounts.length, 1);
});

test('recusa estado expirado, cancelamento e autorização parcial', async t => {
  const f = fixture(t), c = f.calendars; c.configure(configuration(origin), origin);
  const old = c.begin(origin); f.advance(600001);
  await assert.rejects(c.finish(new URLSearchParams({ state: old.state, code: 'a' }), old.state, origin), { status: 400 });
  const cancel = c.begin(origin);
  await assert.rejects(c.finish(new URLSearchParams({ state: cancel.state, error: 'access_denied' }), cancel.state, origin), { status: 400 });
  f.options.omitScope = true;
  await assert.rejects(connect(c), { status: 403 });
  assert.equal(c.status(origin).accounts.length, 0);
});

test('paginação, identidade por conta/calendário, dia inteiro e exceções reais do Google', async t => {
  const f = fixture(t), c = f.calendars; c.configure(configuration(origin), origin); await connect(c, 'a'); await connect(c, 'b');
  const list = await c.list(); assert.equal(list.calendars.length, 4); assert.equal(list.errors.length, 0);
  const input = { from: '2026-09-11', to: '2026-09-12', calendars: [{ accountId: 'google:a', id: 'primary@example.test' }, { accountId: 'google:b', id: 'primary@example.test' }] };
  const result = await c.events(input);
  assert.equal(result.events.length, 4); assert.equal(new Set(result.events.map(e => e.key)).size, 4);
  assert.equal(result.events.find(e => e.allDay).start.date, '2026-09-11');
  assert.equal(result.events.find(e => e.allDay).end.date, '2026-09-13');
  assert.equal(result.events.find(e => e.allDay).htmlLink, '');
  assert.equal(result.events.find(e => e.recurringEventId).originalStartTime.dateTime, '2026-09-11T10:00:00-03:00');
  const query = f.calls.find(c => c.url.pathname.endsWith('/events')).url.searchParams;
  assert.equal(query.get('singleEvents'), 'true'); assert.equal(query.get('timeMin'), '2026-09-11T00:00:00-03:00'); assert.equal(query.get('timeMax'), '2026-09-13T00:00:00-03:00');
  assert.equal((await c.events({ ...input, calendars: [input.calendars[0], input.calendars[0]] })).events.length, 2);
  await assert.rejects(c.events({ ...input, from: '2026-02-30' }), { status: 400 });
  await assert.rejects(c.events({ ...input, to: '2026-12-31' }), { status: 400 });
  await assert.rejects(c.events({ ...input, calendars: [{ accountId: 'google:unknown', id: 'primary' }] }), { status: 404 });
  f.options.failAccount = 'b';
  const partial = await c.events(input); assert.equal(partial.events.length, 2); assert.equal(partial.errors.length, 1); assert.doesNotMatch(partial.errors[0].message, /mensagem bruta/);
  f.options.duplicatePage = true;
  const looping = await c.events({ ...input, calendars: [input.calendars[0]] }); assert.equal(looping.events.length, 0); assert.equal(looping.errors.length, 1);
});

test('renova autorização uma vez entre consultas simultâneas', async t => {
  const f = fixture(t), c = f.calendars; c.configure(configuration(origin), origin); await connect(c);
  f.advance(3600000);
  await Promise.all([c.list(), c.list()]);
  assert.equal(f.calls.filter(v => v.url.hostname === 'oauth2.googleapis.com' && new URLSearchParams(v.init.body).get('grant_type') === 'refresh_token').length, 1);
});

test('consulta 200 calendários com no máximo cinco fontes simultâneas e recusa excesso', async t => {
  const f = fixture(t), c = f.calendars; c.configure(configuration(origin), origin); await connect(c);
  f.options.delayEvents = true;
  const calendars = Array.from({ length: MAX_CALENDARS }, (_, i) => ({ accountId: 'google:a', id: `calendar-${i}` }));
  const result = await c.events({ from: '2026-09-11', to: '2026-09-11', calendars });
  assert.equal(result.events.length, 400); assert.equal(result.errors.length, 0);
  assert.ok(f.options.maxActive > 1 && f.options.maxActive <= 5);
  await assert.rejects(c.events({ from: '2026-09-11', to: '2026-09-11', calendars: [...calendars, { accountId: 'google:a', id: 'extra' }] }), { status: 400 });
});

test('Tasks exige autorização adicional, preserva calendários e não duplica conta ao autorizar', async t => {
  const f = fixture(t), c = f.calendars; c.configure(configuration(origin), origin); await connect(c);
  assert.equal(c.status(origin).accounts[0].tasksAuthorized, false);
  const missing = await c.tasks.lists(); assert.equal(missing.errors.length, 1); assert.equal(missing.lists.length, 0);
  assert.equal(f.calls.filter(call => call.url.hostname === 'tasks.googleapis.com').length, 0);
  await assert.rejects(connect(c, 'a', origin, true), { status: 403 });
  assert.equal((await c.list()).calendars.length, 2);
  f.options.grantTasks = true;
  const attempt = await connect(c, 'a', origin, true);
  assert.ok(new URL(attempt.url).searchParams.get('scope').split(' ').includes(TASKS_SCOPE));
  assert.equal(c.status(origin).accounts.length, 1); assert.equal(c.status(origin).accounts[0].tasksAuthorized, true);
  f.restart(); assert.equal(f.calendars.status(origin).accounts[0].tasksAuthorized, true);
});

test('Tasks pagina listas e tarefas por conta, preserva datas, notas, subtarefas e falhas parciais', async t => {
  const f = fixture(t), c = f.calendars; c.configure(configuration(origin), origin); f.options.grantTasks = true;
  await connect(c, 'a', origin, true); await connect(c, 'b', origin, true);
  assert.equal((await c.tasks.lists()).lists.length, 4);
  const lists = [{ accountId: 'google:a', id: 'list-1' }, { accountId: 'google:b', id: 'list-1' }];
  const all = await c.tasks.list({ lists, status: 'all' });
  assert.equal(all.tasks.length, 6); assert.equal(new Set(all.tasks.map(task => task.key)).size, 6);
  assert.equal(all.tasks.find(task => task.id === 'parent').date, '2026-09-11');
  assert.equal(all.tasks.find(task => task.id === 'parent').notes, 'Comentário original');
  assert.equal(all.tasks.find(task => task.id === 'parent').webViewLink, '');
  assert.equal(all.tasks.find(task => task.id === 'child').date, '');
  assert.equal(all.tasks.find(task => task.id === 'child').parentId, 'parent');
  assert.equal((await c.tasks.list({ lists, status: 'pending' })).tasks.length, 4);
  assert.equal((await c.tasks.list({ lists, status: 'completed' })).tasks.length, 2);
  assert.equal((await c.tasks.list({ lists: [lists[0], lists[0]], status: 'all' })).tasks.length, 3);
  const params = f.calls.find(call => call.url.pathname.endsWith('/tasks')).url.searchParams;
  assert.equal(params.get('maxResults'), '100'); assert.equal(params.get('showCompleted'), 'true'); assert.equal(params.get('showHidden'), 'true'); assert.equal(params.get('showAssigned'), 'true');
  await assert.rejects(c.tasks.list({ lists, status: 'invalid' }), { status: 400 });
  f.options.failAccount = 'b';
  const partial = await c.tasks.list({ lists, status: 'all' }); assert.equal(partial.tasks.length, 3); assert.equal(partial.errors.length, 1);
});

test('rotas locais protegem credenciais, callback, origem e backup', async t => {
  const f = fixture(t); const inventory = path.join(f.directory, 'inventory.json');
  fs.writeFileSync(inventory, JSON.stringify({ calendario: 'Teste', eventos: [] }));
  const store = openStore(path.join(f.directory, 'data.sqlite'), inventory), server = createServer(store, f.calendars);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  f.cleanups.push(async () => { await new Promise(resolve => server.close(resolve)); store.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (route, value, headers = {}) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value) });
  assert.equal((await fetch(base + '/calendarios')).status, 200);
  assert.equal((await fetch(base + '/tarefas')).status, 200);
  assert.equal((await fetch(base + '/tarefas.js')).status, 200);
  assert.equal((await post('/api/calendars/config', configuration(base), { Origin: 'https://external.example' })).status, 403);
  assert.equal((await post('/api/calendars/config', configuration(base))).status, 200);
  const start = await post('/api/calendars/connect', {}), auth = new URL((await start.json()).url);
  const cookie = start.headers.get('set-cookie').split(';')[0];
  assert.match(start.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
  const callback = await fetch(`${base}/oauth/google/callback?code=a&state=${auth.searchParams.get('state')}`, { headers: { Cookie: cookie }, redirect: 'manual' });
  assert.equal(callback.status, 303); assert.equal(callback.headers.get('location'), '/calendarios?connection=success');
  assert.equal(callback.headers.get('referrer-policy'), 'no-referrer');
  assert.equal((await (await fetch(base + '/api/tasks/lists')).json()).errors.length, 1);
  f.options.grantTasks = true;
  const tasksStart = await post('/api/calendars/connect', { includeTasks: true }), tasksAuth = new URL((await tasksStart.json()).url);
  const tasksCookie = tasksStart.headers.get('set-cookie').split(';')[0];
  const tasksCallback = await fetch(`${base}/oauth/google/callback?code=a&state=${tasksAuth.searchParams.get('state')}`, { headers: { Cookie: tasksCookie }, redirect: 'manual' });
  assert.equal(tasksCallback.headers.get('location'), '/tarefas?connection=success');
  assert.equal((await (await fetch(base + '/api/tasks/lists')).json()).lists.length, 2);
  assert.equal((await post('/api/tasks/list', { lists: [{ accountId: 'google:a', id: 'list-1' }], status: 'all' })).status, 200);
  assert.equal((await post('/api/tasks/list', { lists: [], status: 'all' }, { Origin: 'https://external.example' })).status, 403);
  assert.doesNotMatch(await (await fetch(base + '/api/calendars/status')).text(), /fake-access|fake-refresh|fake-test-secret/);
  assert.doesNotMatch(await (await fetch(base + '/api/export')).text(), /fake-access|fake-refresh|fake-test-secret/);
  for (const privatePath of ['/dados-locais/google-private.sqlite', '/google-private.sqlite', '/local/calendars.cjs']) assert.equal((await fetch(base + privatePath)).status, 404);
  assert.equal((await post('/api/calendars/disconnect', { accountId: 'google:a' })).status, 200);
});
