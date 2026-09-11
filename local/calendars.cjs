/** Integração Google de leitura. Credenciais ficam em banco privado, separado dos backups pessoais. */
const { DatabaseSync } = require('node:sqlite');
const { randomBytes, createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.calendarlist.readonly', 'https://www.googleapis.com/auth/calendar.events.readonly'];
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/calendar/v3';
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const dateOK = date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;

/** Injeta somente o transporte para testes com respostas simuladas, nunca com contas reais. */
function openCalendars(filename, { fetch: request = globalThis.fetch, now = () => Date.now() } = {}) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS config (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, data TEXT NOT NULL);`);
  const pending = new Map(), refreshing = new Map();
  const config = () => { const row = db.prepare('SELECT data FROM config WHERE id=1').get(); return row ? JSON.parse(row.data) : null; };
  const accounts = () => db.prepare('SELECT id,data FROM accounts ORDER BY id').all().map(row => ({ id: row.id, ...JSON.parse(row.data) }));
  const account = id => { if (typeof id !== 'string' || !id.startsWith('google:')) fail('Identidade da conta inválida.'); const row = db.prepare('SELECT data FROM accounts WHERE id=?').get(id); if (!row) fail('Conta não conectada. Atualize a lista.', 404); return { id, ...JSON.parse(row.data) }; };
  const writeAccount = value => db.prepare('INSERT INTO accounts VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(value.id, JSON.stringify(value));
  const requireConfig = () => { const value = config(); if (!value) fail('Configure o projeto Google antes de conectar uma conta.', 409); return value; };
  const redirect = origin => `${origin}/oauth/google/callback`;

  /** Nunca devolve respostas brutas do provedor: podem conter códigos ou dados de autenticação. */
  async function remote(url, options = {}) {
    let response, data;
    try { response = await request(url, { ...options, signal: AbortSignal.timeout(20000), redirect: 'error' }); data = await response.json(); }
    catch { fail('O Google não respondeu. Verifique a conexão e tente novamente.', 502); }
    if (!response.ok) {
      if (response.status === 401 || data.error === 'invalid_grant') fail('A autorização expirou ou foi revogada. Conecte esta conta novamente.', 401);
      if (response.status === 403) fail('O Google negou a consulta. Confira a API ativada e as permissões concedidas.', 403);
      if (response.status === 429) fail('Limite de consultas do Google atingido. Aguarde e atualize novamente.', 429);
      fail('Não foi possível consultar o Google. Confira a configuração e tente novamente.', 502);
    }
    return data;
  }
  async function tokenRequest(params) {
    const c = requireConfig();
    return remote(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: c.client_id, client_secret: c.client_secret, ...params }).toString() });
  }
  async function access(id, force = false) {
    const current = account(id);
    if (!force && current.expiresAt > now() + 60000) return current.accessToken;
    if (!refreshing.has(id)) {
      refreshing.set(id, (async () => {
        if (!current.refreshToken) fail('Conecte a conta novamente para renovar a autorização.', 401);
        const tokens = await tokenRequest({ grant_type: 'refresh_token', refresh_token: current.refreshToken });
        const latest = account(id);
        // Uma resposta atrasada não pode desfazer uma reconexão nem recriar conta desconectada.
        if (latest.accessToken !== current.accessToken) return latest.accessToken;
        if (!tokens.access_token || !Number.isFinite(tokens.expires_in)) fail('Resposta de autorização incompleta. Reconecte a conta.', 502);
        const next = { ...latest, accessToken: tokens.access_token, refreshToken: tokens.refresh_token || latest.refreshToken, expiresAt: now() + tokens.expires_in * 1000 };
        writeAccount(next); return next.accessToken;
      })().finally(() => refreshing.delete(id)));
    }
    return refreshing.get(id);
  }
  async function google(id, endpoint, params) {
    const url = `${API}${endpoint}?${new URLSearchParams(params)}`;
    try { return await remote(url, { headers: { Authorization: `Bearer ${await access(id)}` } }); }
    catch (error) {
      if (error.status !== 401) throw error;
      return remote(url, { headers: { Authorization: `Bearer ${await access(id, true)}` } });
    }
  }
  async function pages(id, endpoint, params) {
    const items = [], seen = new Set(); let pageToken;
    do {
      const data = await google(id, endpoint, { ...params, ...(pageToken ? { pageToken } : {}) });
      items.push(...(data.items || [])); pageToken = data.nextPageToken;
      if (pageToken && (seen.has(pageToken) || seen.size >= 50)) fail('Consulta muito grande. Reduza o período ou a quantidade de calendários.', 422);
      if (pageToken) seen.add(pageToken);
    } while (pageToken);
    return items;
  }
  return {
    close: () => db.close(),
    status: origin => ({ configured: Boolean(config()), redirectUri: redirect(origin), accounts: accounts().map(a => ({ id: a.id, email: a.email, connectedAt: a.connectedAt, provider: 'google' })) }),
    configure: (input, origin) => {
      for (const [key, value] of pending) if (value.expiresAt < now()) pending.delete(key);
      if (accounts().length || pending.size) fail('Desconecte as contas e finalize as tentativas de conexão antes de trocar o projeto Google.', 409);
      const c = input?.web;
      if (!c || typeof c.client_id !== 'string' || !/^[a-zA-Z0-9._-]+\.apps\.googleusercontent\.com$/.test(c.client_id) || typeof c.client_secret !== 'string' || !c.client_secret || c.client_secret.length > 1000) fail('Escolha o JSON de um cliente OAuth do tipo Aplicativo da Web.');
      if (!Array.isArray(c.redirect_uris) || !c.redirect_uris.includes(redirect(origin))) fail(`Adicione ${redirect(origin)} aos URIs de redirecionamento e baixe o JSON atualizado.`);
      db.prepare('INSERT INTO config VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(JSON.stringify({ client_id: c.client_id, client_secret: c.client_secret, redirect_uris: c.redirect_uris.filter(v => typeof v === 'string') }));
      return { configured: true };
    },
    begin: origin => {
      const c = requireConfig();
      if (!c.redirect_uris.includes(redirect(origin))) fail('Abra o site pelo mesmo endereço usado na configuração do projeto Google.', 409);
      for (const [key, value] of pending) if (value.expiresAt < now()) pending.delete(key);
      if (pending.size >= 20) fail('Há muitas tentativas de conexão abertas. Aguarde dez minutos.', 429);
      const state = randomBytes(32).toString('hex'), verifier = randomBytes(32).toString('base64url');
      pending.set(state, { expiresAt: now() + 600000, verifier, origin, configuration: JSON.stringify(c) });
      const params = new URLSearchParams({ client_id: c.client_id, redirect_uri: redirect(origin), response_type: 'code', scope: SCOPES.join(' '), access_type: 'offline', prompt: 'consent select_account', state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
      return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`, state };
    },
    finish: async (params, cookie, origin) => {
      const state = params.get('state'), attempt = pending.get(state);
      if (!attempt || attempt.expiresAt < now() || cookie !== state || attempt.origin !== origin) fail('Tentativa de conexão inválida ou expirada. Inicie novamente.', 400);
      pending.delete(state);
      if (params.has('error')) fail('A conexão não foi autorizada. Você pode tentar novamente.', 400);
      if (attempt.configuration !== JSON.stringify(requireConfig())) fail('A configuração mudou. Inicie a conexão novamente.', 409);
      const code = params.get('code'); if (!code || code.length > 4096) fail('Código de autorização ausente ou inválido.');
      const tokens = await tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: redirect(origin), code_verifier: attempt.verifier });
      const granted = new Set((tokens.scope || '').split(' '));
      if (!tokens.access_token || !Number.isFinite(tokens.expires_in) || !SCOPES.slice(2).every(scope => granted.has(scope))) fail('Autorize a leitura dos calendários e dos eventos para concluir a conexão.', 403);
      // Identidade vem do endpoint autenticado; e-mail é rótulo, nunca chave de integração.
      const profile = await remote('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
      if (typeof profile.sub !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(profile.sub) || typeof profile.email !== 'string' || profile.email_verified !== true) fail('Não foi possível confirmar a identidade da conta Google.', 403);
      const id = `google:${profile.sub}`, existing = accounts().find(a => a.id === id);
      if (!tokens.refresh_token && !existing?.refreshToken) fail('Não foi concedida autorização para renovar a conexão. Tente conectar novamente.', 409);
      if (attempt.configuration !== JSON.stringify(requireConfig())) fail('A configuração mudou durante a autorização. Conecte novamente.', 409);
      writeAccount({ id, email: profile.email, accessToken: tokens.access_token, refreshToken: tokens.refresh_token || existing.refreshToken, expiresAt: now() + tokens.expires_in * 1000, connectedAt: new Date(now()).toISOString() });
      return { id, email: profile.email };
    },
    disconnect: id => { account(id); db.prepare('DELETE FROM accounts WHERE id=?').run(id); return { disconnected: true }; },
    list: async () => {
      const calendars = [], errors = [];
      // Falha de uma conta não oculta os resultados autorizados das outras.
      for (const a of accounts()) {
        try {
          const values = await pages(a.id, '/users/me/calendarList', { maxResults: '250' });
          calendars.push(...values.filter(c => !c.deleted).map(c => ({ accountId: a.id, accountEmail: a.email, id: c.id, title: c.summaryOverride || c.summary || 'Sem nome', primary: Boolean(c.primary), selected: Boolean(c.selected), timeZone: c.timeZone || '', accessRole: c.accessRole })));
        } catch (error) { errors.push({ accountId: a.id, accountEmail: a.email, message: error.message }); }
      }
      return { calendars, errors };
    },
    events: async input => {
      if (!input || !dateOK(input.from) || !dateOK(input.to) || input.from > input.to || (Date.parse(input.to) - Date.parse(input.from)) / 86400000 > 30) fail('Escolha um período de até 31 dias, com início e fim válidos.');
      if (!Array.isArray(input.calendars) || !input.calendars.length || input.calendars.length > 20) fail('Selecione de 1 a 20 calendários.');
      const selected = [], keys = new Set();
      for (const c of input.calendars) {
        if (!c || typeof c.accountId !== 'string' || typeof c.id !== 'string' || !c.id || c.id.length > 1024) fail('Calendário inválido.');
        account(c.accountId); const key = JSON.stringify([c.accountId, c.id]);
        if (!keys.has(key)) { keys.add(key); selected.push(c); }
      }
      const events = [], errors = [];
      const end = new Date(Date.parse(input.to) + 86400000).toISOString().slice(0, 10);
      for (const c of selected) {
        try {
          const values = await pages(c.accountId, `/calendars/${encodeURIComponent(c.id)}/events`, { timeMin: `${input.from}T00:00:00-03:00`, timeMax: `${end}T00:00:00-03:00`, singleEvents: 'true', showDeleted: 'false', orderBy: 'startTime', maxResults: '2500', timeZone: 'America/Sao_Paulo' });
          const seen = new Set();
          for (const event of values) {
            if (event.status === 'cancelled' || !event.start || seen.has(event.id)) continue;
            seen.add(event.id);
            events.push({ key: JSON.stringify([c.accountId, c.id, event.id]), accountId: c.accountId, accountEmail: account(c.accountId).email, calendarId: c.id, id: event.id, title: event.summary || 'Ocupado / sem título', start: event.start, end: event.end, allDay: Boolean(event.start.date), location: event.location || '', description: event.description || '', htmlLink: typeof event.htmlLink === 'string' && event.htmlLink.startsWith('https://calendar.google.com/') ? event.htmlLink : '', status: event.status, recurringEventId: event.recurringEventId || null, originalStartTime: event.originalStartTime || null });
          }
        } catch (error) { errors.push({ accountId: c.accountId, calendarId: c.id, message: error.message }); }
      }
      events.sort((a, b) => (a.start.date || a.start.dateTime).localeCompare(b.start.date || b.start.dateTime) || a.key.localeCompare(b.key));
      return { events, errors, fetchedAt: new Date(now()).toISOString(), from: input.from, to: input.to };
    }
  };
}
module.exports = { openCalendars, SCOPES };
