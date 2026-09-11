/** Leitura Google Tasks reutiliza autorização por conta; seleção nunca conclui uma tarefa. */
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
function createTasks({ accounts, account, pages, mapLimited, tasksScope }) {
  const authorized = id => {
    const a = account(id);
    if (!a.scopes?.includes(tasksScope)) fail('Autorize Google Tasks para esta conta na aba Google Tasks.', 403);
    return a;
  };
  return {
    lists: async () => {
      const results = await mapLimited(accounts(), async a => {
        try {
          authorized(a.id);
          const items = await pages(a.id, '/users/@me/lists', { maxResults: '1000' }, 'tasks');
          const seen = new Set();
          return { lists: items.filter(item => item.id && !seen.has(item.id) && seen.add(item.id)).map(item => ({ id: item.id, accountId: a.id, accountEmail: a.email, title: item.title || 'Lista sem nome' })) };
        } catch (error) { return { error: { accountId: a.id, accountEmail: a.email, message: error.message } }; }
      });
      return { lists: results.flatMap(r => r.lists || []), errors: results.flatMap(r => r.error ? [r.error] : []) };
    },
    list: async input => {
      if (!input || !Array.isArray(input.lists) || !input.lists.length || input.lists.length > 200 || !['pending', 'completed', 'all'].includes(input.status)) fail('Escolha de 1 a 200 listas e uma situação válida.');
      const seen = new Set(), selected = [];
      for (const list of input.lists) {
        if (!list || typeof list.accountId !== 'string' || typeof list.id !== 'string' || !list.id || list.id.length > 1024) fail('Lista inválida.');
        account(list.accountId);
        const key = JSON.stringify([list.accountId, list.id]);
        if (!seen.has(key)) { seen.add(key); selected.push(list); }
      }
      const results = await mapLimited(selected, async list => {
        try {
          const a = authorized(list.accountId), includeCompleted = input.status !== 'pending';
          // showHidden inclui as concluídas nos clientes Google; showAssigned inclui Docs/Chat.
          const values = await pages(a.id, `/lists/${encodeURIComponent(list.id)}/tasks`, { maxResults: '100', showCompleted: String(includeCompleted), showHidden: String(includeCompleted), showDeleted: 'false', showAssigned: 'true' }, 'tasks');
          const ids = new Set();
          const tasks = values.filter(t => t.id && !t.deleted && !ids.has(t.id) && ids.add(t.id) && (input.status === 'all' || (input.status === 'completed' ? t.status === 'completed' : t.status !== 'completed'))).map(t => ({
            key: JSON.stringify([a.id, list.id, t.id]), id: t.id, accountId: a.id, accountEmail: a.email, listId: list.id,
            title: t.title || 'Sem título', notes: t.notes || '', status: t.status,
            // A API fornece uma data, não o horário agendado; não aplicamos conversão de fuso.
            date: typeof t.due === 'string' ? t.due.slice(0, 10) : '', completedAt: t.completed || '',
            parentId: t.parent || null, position: t.position || '',
            webViewLink: typeof t.webViewLink === 'string' && t.webViewLink.startsWith('https://tasks.google.com/') ? t.webViewLink : ''
          }));
          return { tasks };
        } catch (error) { return { error: { accountId: list.accountId, listId: list.id, message: error.message } }; }
      });
      return { tasks: results.flatMap(r => r.tasks || []), errors: results.flatMap(r => r.error ? [r.error] : []), fetchedAt: new Date().toISOString() };
    }
  };
}
module.exports = { createTasks };
