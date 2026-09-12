/** Fonte de verdade local: cada alteração e seu histórico são uma transação SQLite. */
const { DatabaseSync } = require('node:sqlite');
const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const property = (e, name) => e.propriedades[name]?.[0]?.value || '';
const days = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };

/** Converte datas UTC da exportação para o fuso de revisão, sem alterar a origem. */
function localStart(raw) {
  if (!raw) return { date: '', time: '' };
  const iso = raw.slice(0, 4) + '-' + raw.slice(4, 6) + '-' + raw.slice(6, 8);
  if (!raw.endsWith('Z')) return { date: iso, time: raw.includes('T') ? raw.slice(9, 11) + ':' + raw.slice(11, 13) : '' };
  const date = new Date(`${iso}T${raw.slice(9, 11)}:${raw.slice(11, 13)}:${raw.slice(13, 15)}Z`);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** Editamos apenas frequências presentes no inventário; a origem ICS fica integral. */
function recurrence(raw) {
  const rule = Object.fromEntries(raw.split(';').filter(Boolean).map(p => p.split('=')));
  const ordinal = /^([1-5])([A-Z]{2})$/.exec(rule.BYDAY || '');
  return { frequency: rule.FREQ || 'ONCE', days: rule.FREQ === 'WEEKLY' ? (rule.BYDAY || '').split(',').filter(Boolean) : [], monthDay: Number(rule.BYMONTHDAY || 1), ordinal: ordinal ? Number(ordinal[1]) : 1, weekday: ordinal?.[2] || 'MO', monthlyMode: ordinal ? 'weekday' : 'date' };
}

/** Sinalizações descrevem o arquivo recebido; revisão não corrige silenciosamente. */
function warnings(e) {
  const title = e.titulo, rule = property(e, 'RRULE'), result = [];
  if (/1º Sem\/2026/.test(title) && rule && !/UNTIL|COUNT/.test(rule)) result.push('Aula do 1º semestre sem término na origem.');
  if (property(e, 'DTSTART') === property(e, 'DTEND')) result.push('Origem sem duração: definir se precisa de horário.');
  if (/Tirar Lixo/.test(title)) result.push('Título diz sábado; repetição original inclui sexta.');
  if (/Quinzenal/.test(title)) result.push('Título diz quinzenal; repetição original é mensal.');
  if (/Academia aberta/.test(title)) result.push('Horário de funcionamento; sugerido como informação.');
  if (e.propriedades.EXDATE) result.push('A origem contém uma data excluída.');
  if (!rule) result.push('Evento avulso antigo: revisar data antes de aprovar.');
  return result;
}

function validate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Registro inválido.');
  for (const key of ['title', 'category', 'account']) {
    if (typeof value[key] !== 'string' || !value[key].trim() || value[key].length > 300) fail(`Preencha ${key} (até 300 caracteres).`);
  }
  if (!['pending', 'approved', 'paused'].includes(value.status)) fail('Situação inválida.');
  if (!['task', 'appointment', 'info'].includes(value.kind)) fail('Tipo inválido.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.date) || Number.isNaN(Date.parse(value.date)) || new Date(value.date).toISOString().slice(0, 10) !== value.date) fail('Data inválida.');
  if (value.time !== '' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time)) fail('Horário inválido.');
  if (!Number.isInteger(value.duration) || value.duration < 0 || value.duration > 10080) fail('Duração deve ser de 0 a 10080 minutos.');
  if (typeof value.notes !== 'string' || value.notes.length > 5000) fail('Observação muito longa.');
  const r = value.recurrence;
  if (!r || !['ONCE', 'DAILY', 'WEEKLY', 'MONTHLY'].includes(r.frequency)) fail('Frequência inválida.');
  if (!Array.isArray(r.days) || r.days.some(d => !days.includes(d)) || new Set(r.days).size !== r.days.length || (r.frequency === 'WEEKLY' && !r.days.length)) fail('Escolha os dias da semana.');
  if (!['date', 'weekday'].includes(r.monthlyMode) || !Number.isInteger(r.monthDay) || r.monthDay < 1 || r.monthDay > 31 || !Number.isInteger(r.ordinal) || r.ordinal < 1 || r.ordinal > 5 || !days.includes(r.weekday)) fail('Repetição mensal inválida.');
  const validPurposes = ['improvement', 'moral_debt', 'maintenance'];
  const purpose = value.purpose || 'maintenance';
  if (!validPurposes.includes(purpose)) fail('Classificação de propósito inválida (escolha melhoria, dívida moral ou manutenção).');
  // Lista explícita impede alteração dos IDs, origem e histórico via API.
  return {
    ...Object.fromEntries(['title', 'category', 'account', 'status', 'kind', 'date', 'time', 'duration', 'notes', 'recurrence'].map(key => [key, value[key]])),
    purpose
  };
}

function openStore(filename, inventoryFile) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  // Migração inicial versionada. Versões futuras acrescentam migrações, sem reset.
  if (db.prepare('PRAGMA user_version').get().user_version === 0) {
    db.exec(`BEGIN;
      CREATE TABLE routines (id TEXT PRIMARY KEY, data TEXT NOT NULL, source TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL);
      CREATE TABLE history (id INTEGER PRIMARY KEY, routine_id TEXT REFERENCES routines(id), action TEXT NOT NULL, before_json TEXT, after_json TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX history_routine ON history(routine_id, id);
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      PRAGMA user_version=1;
      COMMIT;`);
  }
  const transaction = fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  // A semente é lida uma única vez. Reiniciar nunca sobrescreve revisões do usuário.
  if (!db.prepare("SELECT value FROM metadata WHERE key='imported'").get()) {
    if (!inventoryFile || !fs.existsSync(inventoryFile)) { db.close(); fail('Inventário ausente. Execute o mapeamento do ICS antes de iniciar.', 503); }
    const inventory = JSON.parse(fs.readFileSync(inventoryFile, 'utf8'));
    transaction(() => {
      const now = new Date().toISOString();
      for (const e of inventory.eventos.filter(e => e.tipoRegistro !== 'excecao')) {
        const start = localStart(property(e, 'DTSTART')), end = localStart(property(e, 'DTEND'));
        const duration = start.time && end.time ? Math.max(0, Math.round((Date.parse(`${end.date}T${end.time}:00Z`) - Date.parse(`${start.date}T${start.time}:00Z`)) / 60000)) : 0;
        const id = createHash('sha256').update(JSON.stringify([inventory.calendario, e.uid])).digest('hex').slice(0, 32);
        const data = { title: e.titulo.trim(), category: e.categoriaSugerida, account: 'Rotinas · conta a vincular', status: 'pending', kind: /Academia aberta/.test(e.titulo) ? 'info' : /1º Sem|Trabalhar|UFPR/.test(e.titulo) ? 'appointment' : 'task', date: start.date, time: start.time, duration, notes: '', recurrence: recurrence(property(e, 'RRULE')) };
        const source = { calendar: inventory.calendario, event: e, exceptions: inventory.eventos.filter(x => x.uid === e.uid && x.tipoRegistro === 'excecao'), warnings: warnings(e) };
        db.prepare('INSERT INTO routines(id,data,source,updated_at) VALUES(?,?,?,?)').run(id, JSON.stringify(data), JSON.stringify(source), now);
        db.prepare("INSERT INTO history(routine_id,action,after_json,created_at) VALUES(?,'import',?,?)").run(id, JSON.stringify(data), now);
      }
      db.prepare("INSERT INTO metadata VALUES('imported',?)").run(now);
      db.prepare("INSERT INTO metadata VALUES('instance',?)").run(randomUUID());
    });
  }
  const unpack = row => {
    if (!row) return null;
    const data = JSON.parse(row.data);
    return { id: row.id, ...data, purpose: data.purpose || 'maintenance', source: JSON.parse(row.source), version: row.version, updatedAt: row.updated_at };
  };
  const get = id => unpack(db.prepare('SELECT * FROM routines WHERE id=?').get(id));
  const planning = require('./planner.cjs').planner(db, transaction);
  return {
    planning,
    close: () => db.close(),
    list: () => db.prepare('SELECT * FROM routines ORDER BY id').all().map(unpack),
    get,
    history: id => db.prepare('SELECT * FROM history WHERE routine_id=? ORDER BY id DESC').all(id).map(row => ({ ...row, before: JSON.parse(row.before_json || 'null'), after: JSON.parse(row.after_json), before_json: undefined, after_json: undefined })),
    export: () => ({ schemaVersion: 2, exportedAt: new Date().toISOString(), routines: db.prepare('SELECT * FROM routines ORDER BY id').all().map(unpack), history: db.prepare('SELECT * FROM history ORDER BY id').all(), planning: planning.export() }),
    update: (id, input) => transaction(() => {
      const current = get(id);
      if (!current) fail('Rotina não encontrada.', 404);
      if (input.version !== current.version) fail('Esta rotina mudou em outra aba. Recarregue antes de salvar.', 409);
      const data = validate(input);
      const before = validate(current);
      if (JSON.stringify(data) === JSON.stringify(before)) return current;
      const now = new Date().toISOString();
      db.prepare('UPDATE routines SET data=?,version=version+1,updated_at=? WHERE id=?').run(JSON.stringify(data), now, id);
      db.prepare("INSERT INTO history(routine_id,action,before_json,after_json,created_at) VALUES(?,'update',?,?,?)").run(id, JSON.stringify(before), JSON.stringify(data), now);
      return get(id);
    })
  };
}
module.exports = { openStore, validate, localStart };
