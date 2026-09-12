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
    const items = row ? JSON.parse(row.data).map(i => ({ ...i, purpose: i.purpose || 'maintenance' })) : [];
    return { date, version: row?.version || 0, items };
  };

  /** Resumo agregado de itens para estatísticas de progresso e visão de calendário. */
  function summarize(items) {
    const total = items.length;
    const completed = items.filter(i => i.done).length;
    const improvements = items.filter(i => i.purpose === 'improvement').length;
    const improvementsDone = items.filter(i => i.purpose === 'improvement' && i.done).length;
    const moralDebts = items.filter(i => i.purpose === 'moral_debt').length;
    const moralDebtsDone = items.filter(i => i.purpose === 'moral_debt' && i.done).length;
    return {
      total,
      completed,
      pending: total - completed,
      completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
      improvements,
      improvementsDone,
      moralDebts,
      moralDebtsDone
    };
  }

  /** Recupera rotinas ativas para projeção no calendário quando não há plano salvo no dia. */
  function getActiveRoutines() {
    try {
      const rows = db.prepare('SELECT id, data FROM routines').all();
      return rows.map(r => {
        const d = JSON.parse(r.data);
        return { id: r.id, ...d, purpose: d.purpose || 'maintenance' };
      }).filter(r => r.status !== 'paused' && r.kind !== 'info');
    } catch {
      return [];
    }
  }

  /**
   * Avalia afinidade de uma regra de repetição com uma data específica.
   * Entrada: rotina e data 'YYYY-MM-DD'.
   * Regra de negócio: DAILY repete todo dia; WEEKLY confere dias da semana;
   * MONTHLY confere dia fixo do mês ou dia da semana ordinal (ex: 2ª quarta).
   */
  function fitsRoutine(r, targetDateStr) {
    if (r.status === 'paused' || r.kind === 'info') return false;
    if (r.date && r.date > targetDateStr) return false;
    const d = new Date(`${targetDateStr}T12:00:00`);
    const dayKey = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][d.getDay()];
    const rec = r.recurrence;
    if (!rec) return false;
    if (rec.frequency === 'ONCE') return r.date === targetDateStr;
    if (rec.frequency === 'DAILY') return true;
    if (rec.frequency === 'WEEKLY') return Array.isArray(rec.days) && rec.days.includes(dayKey);
    if (rec.frequency === 'MONTHLY') {
      if (rec.monthlyMode === 'date') return rec.monthDay === d.getDate();
      return rec.weekday === dayKey && rec.ordinal === Math.ceil(d.getDate() / 7);
    }
    return false;
  }

  /**
   * Constrói os dados de um dia com rotinas projetadas ou itens salvos no banco.
   * Preserva a regra: dias sem plano mostram a projeção da rotina diária sem contar como concluídos.
   */
  function buildDayInfo(dateStr, planData, activeRoutines) {
    const dt = new Date(`${dateStr}T12:00:00`);
    const dayOfWeek = dt.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const dayNumber = Number(dateStr.slice(8, 10));
    const periodicMilestones = [5, 10, 15, 20, 25, 30];
    const weekdaysNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const weekdaysKeys = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

    if (planData) {
      return {
        date: dateStr,
        day: dayNumber,
        weekdayKey: weekdaysKeys[dayOfWeek],
        weekdayName: weekdaysNames[dayOfWeek],
        isWeekend,
        isPeriodicMilestone: periodicMilestones.includes(dayNumber),
        hasPlan: true,
        stats: planData.stats,
        items: planData.items.map(i => ({
          id: i.id,
          routineId: i.routineId || null,
          title: i.title,
          block: i.block,
          kind: i.kind,
          done: i.done,
          purpose: i.purpose,
          time: i.time,
          duration: i.duration,
          account: i.account || '',
          isProjected: false
        }))
      };
    }

    // Projetar rotinas recorrentes ativas para o dia não salvo
    const projectedItems = activeRoutines
      .filter(r => fitsRoutine(r, dateStr))
      .sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99') || a.title.localeCompare(b.title))
      .map(r => ({
        id: r.id,
        routineId: r.id,
        title: r.title,
        block: r.time ? (r.time < '12:00' ? 'morning' : r.time < '18:00' ? 'afternoon' : 'evening') : 'anytime',
        kind: r.kind || 'task',
        done: false,
        purpose: r.purpose || 'maintenance',
        time: r.time || '',
        duration: r.duration || 0,
        account: r.account || '',
        isProjected: true
      }));

    const improvements = projectedItems.filter(i => i.purpose === 'improvement').length;
    const moralDebts = projectedItems.filter(i => i.purpose === 'moral_debt').length;

    return {
      date: dateStr,
      day: dayNumber,
      weekdayKey: weekdaysKeys[dayOfWeek],
      weekdayName: weekdaysNames[dayOfWeek],
      isWeekend,
      isPeriodicMilestone: periodicMilestones.includes(dayNumber),
      hasPlan: false,
      stats: {
        total: projectedItems.length,
        completed: 0,
        pending: projectedItems.length,
        completionRate: 0,
        improvements,
        improvementsDone: 0,
        moralDebts,
        moralDebtsDone: 0
      },
      items: projectedItems
    };
  }

  return {
    get,
    history: date => { get(date); return db.prepare('SELECT * FROM plan_history WHERE date=? ORDER BY id DESC').all(date); },
    export: () => ({ days: db.prepare('SELECT * FROM plans ORDER BY date').all(), history: db.prepare('SELECT * FROM plan_history ORDER BY id').all() }),

    /** Consulta planos salvos em um intervalo de datas com métricas calculadas. */
    range: (startDate, endDate) => {
      if (!validDate(startDate) || !validDate(endDate)) invalid('Datas de início e fim devem ser válidas.');
      if (startDate > endDate) invalid('A data inicial deve ser anterior ou igual à final.');
      const rows = db.prepare('SELECT date, data, version FROM plans WHERE date >= ? AND date <= ? ORDER BY date ASC').all(startDate, endDate);
      return rows.map(r => {
        const items = JSON.parse(r.data).map(i => ({ ...i, purpose: i.purpose || 'maintenance' }));
        return { date: r.date, version: r.version, stats: summarize(items), items };
      });
    },

    /** Visão completa do mês com destaques nos marcos 05, 10, 15, 20, 25 e 30 e rotinas diárias projetadas. */
    month: (year, monthStr) => {
      const y = Number(year), m = Number(monthStr);
      if (!Number.isInteger(y) || y < 2000 || y > 2100 || !Number.isInteger(m) || m < 1 || m > 12) {
        invalid('Ano e mês devem ser válidos.');
      }
      const formattedMonth = String(m).padStart(2, '0');
      const lastDay = new Date(y, m, 0).getDate();
      const start = `${y}-${formattedMonth}-01`;
      const end = `${y}-${formattedMonth}-${String(lastDay).padStart(2, '0')}`;
      const saved = new Map();
      const rows = db.prepare('SELECT date, data, version FROM plans WHERE date >= ? AND date <= ?').all(start, end);
      for (const r of rows) {
        const items = JSON.parse(r.data).map(i => ({ ...i, purpose: i.purpose || 'maintenance' }));
        saved.set(r.date, { version: r.version, stats: summarize(items), items });
      }

      const activeRoutines = getActiveRoutines();
      const daysList = [];
      for (let d = 1; d <= lastDay; d++) {
        const dateStr = `${y}-${formattedMonth}-${String(d).padStart(2, '0')}`;
        daysList.push(buildDayInfo(dateStr, saved.get(dateStr), activeRoutines));
      }
      return { year: y, month: m, formattedMonth, totalDays: lastDay, days: daysList };
    },

    /**
     * Visão semanal com colunas por dia e rotinas detalhadas.
     * Suporta semana começando na Segunda ('MO') ou Domingo ('SU').
     */
    week: (referenceDate = null, weekStart = 'MO') => {
      let ref = referenceDate;
      if (!ref) {
        const d = new Date();
        ref = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }
      if (!validDate(ref)) invalid('Data de referência inválida.');

      const refDt = new Date(`${ref}T12:00:00`);
      const refDayOfWeek = refDt.getDay(); // 0 = Domingo, 1 = Segunda, ...

      // Calcular offset para o início da semana
      let offsetToStart = 0;
      if (weekStart === 'MO') {
        // Segunda-feira como dia 0 da semana
        offsetToStart = (refDayOfWeek + 6) % 7;
      } else {
        // Domingo como dia 0 da semana
        offsetToStart = refDayOfWeek;
      }

      const startDt = new Date(refDt.getTime() - offsetToStart * 86400000);
      const daysList = [];
      const activeRoutines = getActiveRoutines();

      // Buscar planos salvos no intervalo da semana
      const weekDates = [];
      for (let i = 0; i < 7; i++) {
        const curDt = new Date(startDt.getTime() + i * 86400000);
        weekDates.push(`${curDt.getFullYear()}-${String(curDt.getMonth() + 1).padStart(2, '0')}-${String(curDt.getDate()).padStart(2, '0')}`);
      }

      const startDateStr = weekDates[0];
      const endDateStr = weekDates[6];

      const saved = new Map();
      const rows = db.prepare('SELECT date, data, version FROM plans WHERE date >= ? AND date <= ?').all(startDateStr, endDateStr);
      for (const r of rows) {
        const items = JSON.parse(r.data).map(i => ({ ...i, purpose: i.purpose || 'maintenance' }));
        saved.set(r.date, { version: r.version, stats: summarize(items), items });
      }

      for (const dateStr of weekDates) {
        daysList.push(buildDayInfo(dateStr, saved.get(dateStr), activeRoutines));
      }

      return {
        referenceDate: ref,
        weekStart,
        startDate: startDateStr,
        endDate: endDateStr,
        days: daysList
      };
    },

    /** Calcula avanço dos últimos N dias: taxa de cumprimento, dívidas morais quitadas e melhorias. */
    progress: (daysCount = 14, referenceDate = null) => {
      const count = Number(daysCount);
      if (!Number.isInteger(count) || count < 1 || count > 90) invalid('A quantidade de dias deve ser entre 1 e 90.');
      let ref = referenceDate;
      if (!ref) {
        const d = new Date();
        ref = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      }
      if (!validDate(ref)) invalid('Data de referência inválida.');

      const refDt = new Date(`${ref}T12:00:00`);
      const startDt = new Date(refDt.getTime() - (count - 1) * 86400000);
      const startStr = `${startDt.getFullYear()}-${String(startDt.getMonth()+1).padStart(2,'0')}-${String(startDt.getDate()).padStart(2,'0')}`;

      const rows = db.prepare('SELECT date, data, version FROM plans WHERE date >= ? AND date <= ? ORDER BY date ASC').all(startStr, ref);
      const plansMap = new Map();
      for (const r of rows) {
        const items = JSON.parse(r.data).map(i => ({ ...i, purpose: i.purpose || 'maintenance' }));
        plansMap.set(r.date, { version: r.version, stats: summarize(items), items });
      }

      let totalTasks = 0, completedTasks = 0, moralDebtsTotal = 0, moralDebtsPaid = 0, improvementsTotal = 0, improvementsAchieved = 0;
      const dailyList = [];

      for (let i = count - 1; i >= 0; i--) {
        const currentDt = new Date(refDt.getTime() - i * 86400000);
        const curDate = `${currentDt.getFullYear()}-${String(currentDt.getMonth()+1).padStart(2,'0')}-${String(currentDt.getDate()).padStart(2,'0')}`;
        const planData = plansMap.get(curDate);
        if (planData) {
          totalTasks += planData.stats.total;
          completedTasks += planData.stats.completed;
          moralDebtsTotal += planData.stats.moralDebts;
          moralDebtsPaid += planData.stats.moralDebtsDone;
          improvementsTotal += planData.stats.improvements;
          improvementsAchieved += planData.stats.improvementsDone;
        }
        dailyList.push({
          date: curDate,
          hasPlan: Boolean(planData),
          stats: planData ? planData.stats : { total: 0, completed: 0, pending: 0, completionRate: 0, improvements: 0, improvementsDone: 0, moralDebts: 0, moralDebtsDone: 0 }
        });
      }

      return {
        referenceDate: ref,
        daysCount: count,
        startDate: startStr,
        totalTasks,
        completedTasks,
        completionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
        moralDebtsTotal,
        moralDebtsPaid,
        moralDebtsPending: moralDebtsTotal - moralDebtsPaid,
        improvementsTotal,
        improvementsAchieved,
        daysWithPlans: plansMap.size,
        daily: dailyList
      };
    },

    save: (date, input) => transaction(() => {
      const before = get(date);
      if (!input || !Array.isArray(input.items) || input.items.length > 300) invalid('Planejamento inválido (máximo 300 itens).');
      const ids = new Set(), sources = new Set();
      const validPurposes = ['improvement', 'moral_debt', 'maintenance'];
      const items = input.items.map(item => {
        if (!item || typeof item.id !== 'string' || !/^[a-f0-9-]{36}$/.test(item.id) || ids.has(item.id)) invalid('Identidade de item inválida ou repetida.');
        ids.add(item.id);
        if (typeof item.title !== 'string' || !item.title.trim() || item.title.length > 300) invalid('Preencha o título (até 300 caracteres).');
        if (!['morning','afternoon','evening','anytime'].includes(item.block)) invalid('Bloco do dia inválido.');
        if (!['task','block'].includes(item.kind) || typeof item.done !== 'boolean') invalid('Tipo ou conclusão inválida.');
        const purpose = item.purpose || 'maintenance';
        if (!validPurposes.includes(purpose)) invalid('Classificação de propósito inválida.');
        if (item.time !== '' && (typeof item.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.time))) invalid('Horário inválido.');
        if (!Number.isInteger(item.duration) || item.duration < 0 || item.duration > 1440) invalid('Duração inválida.');
        if (item.kind === 'block' && (!item.time || !item.duration)) invalid('Reservar um bloco exige horário e duração.');
        if (item.time && Number(item.time.slice(0,2))*60 + Number(item.time.slice(3)) + item.duration > 1440) invalid('O bloco deve terminar no mesmo dia.');
        if (typeof item.notes !== 'string' || item.notes.length > 5000 || typeof item.account !== 'string' || item.account.length > 300) invalid('Comentário ou conta inválidos.');
        if (item.routineId !== null) {
          if (typeof item.routineId !== 'string' || sources.has(item.routineId) || !db.prepare('SELECT id FROM routines WHERE id=?').get(item.routineId)) invalid('Rotina inexistente ou já selecionada neste dia.');
          sources.add(item.routineId);
        }
        return {
          id: item.id,
          routineId: item.routineId,
          title: item.title,
          block: item.block,
          kind: item.kind,
          time: item.time,
          duration: item.duration,
          notes: item.notes,
          account: item.account,
          done: item.done,
          purpose
        };
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

