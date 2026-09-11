/** Planejamentos independentes por data: seleção não implica conclusão nem altera a rotina. */
const invalid = message => { throw Object.assign(new Error(message), { status: 400 }); };
function validDate(date) {
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0,10) === date;
}
function planner(db, transaction) {
  // Migração aditiva preserva as revisões e a origem ICS já existentes.
  db.exec(`CREATE TABLE IF NOT EXISTS plans (date TEXT PRIMARY KEY, data TEXT NOT NULL, version INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS plan_history (id INTEGER PRIMARY KEY, date TEXT NOT NULL, before_json TEXT NOT NULL, after_json TEXT NOT NULL, created_at TEXT NOT NULL);`);
  const get = date => {
    if (!validDate(date)) invalid('Data inválida.');
    const row = db.prepare('SELECT * FROM plans WHERE date=?').get(date);
    return { date, version: row?.version || 0, items: row ? JSON.parse(row.data) : [] };
  };
  return {
    get,
    history: date => { get(date); return db.prepare('SELECT * FROM plan_history WHERE date=? ORDER BY id DESC').all(date); },
    export: () => ({ days: db.prepare('SELECT * FROM plans ORDER BY date').all(), history: db.prepare('SELECT * FROM plan_history ORDER BY id').all() }),
    save: (date, input) => transaction(() => {
      const before = get(date);
      if (!input || !Array.isArray(input.items) || input.items.length > 300) invalid('Planejamento inválido (máximo 300 itens).');
      const ids = new Set(), sources = new Set();
      const items = input.items.map(item => {
        if (!item || typeof item.id !== 'string' || !/^[a-f0-9-]{36}$/.test(item.id) || ids.has(item.id)) invalid('Identidade de item inválida ou repetida.');
        ids.add(item.id);
        if (typeof item.title !== 'string' || !item.title.trim() || item.title.length > 300) invalid('Preencha o título (até 300 caracteres).');
        if (!['morning','afternoon','evening','anytime'].includes(item.block)) invalid('Bloco do dia inválido.');
        if (!['task','block'].includes(item.kind) || typeof item.done !== 'boolean') invalid('Tipo ou conclusão inválida.');
        if (item.time !== '' && (typeof item.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.time))) invalid('Horário inválido.');
        if (!Number.isInteger(item.duration) || item.duration < 0 || item.duration > 1440) invalid('Duração inválida.');
        if (item.kind === 'block' && (!item.time || !item.duration)) invalid('Reservar um bloco exige horário e duração.');
        if (item.time && Number(item.time.slice(0,2))*60 + Number(item.time.slice(3)) + item.duration > 1440) invalid('O bloco deve terminar no mesmo dia.');
        if (typeof item.notes !== 'string' || item.notes.length > 5000 || typeof item.account !== 'string' || item.account.length > 300) invalid('Comentário ou conta inválidos.');
        if (item.routineId !== null) {
          if (typeof item.routineId !== 'string' || sources.has(item.routineId) || !db.prepare('SELECT id FROM routines WHERE id=?').get(item.routineId)) invalid('Rotina inexistente ou já selecionada neste dia.');
          sources.add(item.routineId);
        }
        return Object.fromEntries(['id','routineId','title','block','kind','time','duration','notes','account','done'].map(key => [key,item[key]]));
      });
      // Repetir o mesmo salvamento é seguro, inclusive após perda da resposta de rede.
      if (JSON.stringify(items) === JSON.stringify(before.items)) return before;
      if (input.version !== before.version) throw Object.assign(new Error('Este dia mudou em outra aba. Copie seu rascunho e recarregue antes de salvar.'), { status: 409 });
      db.prepare('INSERT INTO plans VALUES(?,?,?) ON CONFLICT(date) DO UPDATE SET data=excluded.data,version=excluded.version').run(date,JSON.stringify(items),before.version+1);
      db.prepare('INSERT INTO plan_history(date,before_json,after_json,created_at) VALUES(?,?,?,?)').run(date,JSON.stringify(before),JSON.stringify({...before,items,version:before.version+1}),new Date().toISOString());
      return get(date);
    })
  };
}
module.exports = { planner };
