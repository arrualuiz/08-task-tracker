/**
 * Levantamento local de uma exportação ICS, sem acessar contas Google.
 * Uso: node scripts/mapear-calendario.cjs arquivo.ics pasta-de-saida
 * Preserva propriedades repetidas e exceções; não expande recorrências nem
 * importa tarefas. O parser cobre a estrutura desta exportação Google.
 */
const fs = require('node:fs');
const path = require('node:path');
const [source, output] = process.argv.slice(2);
if (!source || !output) throw new Error('Informe arquivo ICS e pasta de saída.');
const raw = fs.readFileSync(source, 'utf8');
// Linhas iniciadas por espaço/tab continuam a linha anterior, inclusive títulos.
const lines = raw.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
const events = [];
let event = null;
let depth = 0;
const metadata = {};
for (const line of lines) {
  if (line === 'BEGIN:VEVENT') { event = {}; depth = 0; continue; }
  if (line === 'END:VEVENT') { events.push(event); event = null; continue; }
  if (event && line.startsWith('BEGIN:')) { depth++; continue; }
  if (event && line.startsWith('END:')) { depth--; continue; }
  const colon = line.indexOf(':');
  if (colon < 0 || depth) continue;
  const head = line.slice(0, colon);
  const name = head.split(';')[0];
  const property = { parameters: head.slice(name.length), value: line.slice(colon + 1) };
  if (event) (event[name] ??= []).push(property);
  else if (name.startsWith('X-WR-')) metadata[name] = property.value;
}
const val = (e, key) => e[key]?.[0]?.value || '';
const decode = s => s.replace(/\\([nN,;\\])/g, (_, c) => /[nN]/.test(c) ? '\n' : c);
const cell = s => String(s).replace(/\|/g, '\\|').replace(/\n/g, '<br>');
const masters = events.filter(e => !e['RECURRENCE-ID']);
const recurring = masters.filter(e => e.RRULE);
const counts = {};
for (const e of recurring) {
  const rule = val(e, 'RRULE');
  counts[rule] = (counts[rule] || 0) + 1;
}
// Classificação sugerida, baseada no título, nunca usada para aprovar tarefas.
function category(title) {
  if (/CE30|CM310|CI240|UFPR|PUCPR|Duolingo/.test(title)) return 'Estudos';
  if (/Moto|Pneu/.test(title)) return 'Moto';
  if (/Contas|Dívidas/.test(title)) return 'Finanças';
  if (/Trabalh|Expediente/.test(title)) return 'Trabalho e deslocamento';
  if (/Roupa|Panos|Tanque/.test(title)) return 'Lavanderia';
  if (/Pano|Limpar|Varrer|Aspirador|Louça|Louças|Tênis|Lixo|Arrumar a Cama/.test(title)) return 'Casa';
  if (/Barba|Unhas|Raspar|Cabelo|Dentes|Banho/.test(title)) return 'Cuidados pessoais';
  if (/Treinar|Academia|Consultas|Remédios/.test(title)) return 'Saúde e exercício';
  if (/Almoço|Jantar|Café|Dormir|Acordar/.test(title)) return 'Alimentação e descanso';
  return 'Organização pessoal';
}
const inventory = events.map(e => ({
  uid: val(e, 'UID'), titulo: decode(val(e, 'SUMMARY')),
  categoriaSugerida: category(decode(val(e, 'SUMMARY'))),
  tipoRegistro: e['RECURRENCE-ID'] ? 'excecao' : e.RRULE ? 'serie' : 'avulso',
  aprovado: false, propriedades: e
}));
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'inventario.json'), JSON.stringify({
  calendario: metadata, sincronizado: false, contaConfirmada: false, eventos: inventory
}, null, 2) + '\n');
const rows = inventory.map((e, i) => {
  const p = e.propriedades;
  return `| ${i + 1} | ${cell(e.titulo)} | ${e.categoriaSugerida} | ${val(p, 'DTSTART')} ${p.DTSTART?.[0].parameters || ''} | ${val(p, 'DTEND') || 'Não informado'} | ${val(p, 'RRULE') || e.tipoRegistro} |`;
});
const zero = masters.filter(e => val(e, 'DTSTART') === val(e, 'DTEND')).length;
const oldClasses = recurring.filter(e => /1º Sem\/2026/.test(val(e, 'SUMMARY')) && !/UNTIL=|COUNT=/.test(val(e, 'RRULE'))).length;
const report = [
  '# Rotinas extraídas do calendário', '',
  `Calendário: ${metadata['X-WR-CALNAME']}. Fuso declarado: ${metadata['X-WR-TIMEZONE']}.`, '',
  'Esta é uma análise da cópia ICS recebida, não uma conexão ativa. Categorias são sugestões; nenhum registro foi aprovado ou enviado ao Google.', '',
  `- ${events.length} componentes de evento; ${masters.length} registros principais.`,
  `- ${recurring.length} séries recorrentes; ${masters.length - recurring.length} eventos avulsos; ${events.length - masters.length} exceções de ocorrência.`,
  `- ${events.filter(e => e.EXDATE).length} registros com datas excluídas (EXDATE).`,
  `- ${zero} registros principais com início e fim iguais: não usar como estimativa de duração.`,
  `- ${oldClasses} séries de aulas identificadas como primeiro semestre de 2026, mas sem término na regra: revisar antes de ativar.`, '',
  '## Repetições encontradas', '',
  '| Regra original | Séries |', '| --- | --- |',
  ...Object.entries(counts).map(([r, n]) => `| ${r} | ${n} |`), '',
  'MO=segunda, TU=terça, WE=quarta, TH=quinta, FR=sexta, SA=sábado, SU=domingo; 1WE=primeira quarta, 2SA=segundo sábado. Datas com Z estão em UTC; as demais conservam os parâmetros de fuso originais.', '',
  '## Decisões para a migração', '',
  '- Preservar UID, RRULE, EXDATE e RECURRENCE-ID. Uma exceção não é uma nova rotina. O UID do ICS não deve ser presumido como eventId da API.',
  '- Associar a origem a uma conta autorizada e ao calendário antes de sincronizar. O nome da pasta de exportação não comprova propriedade do calendário.',
  '- Manter Fazer/aprovada separado de Concluída, por ocorrência e data; iniciar a importação para revisão, sem gerar tarefas automaticamente.',
  '- Tratar Academia aberta como informação de disponibilidade sugerida, não como nove ou seis horas de treino.',
  '- Revisar blocos gerais de UFPR junto com disciplinas individuais, evitando duplicar cobrança de conclusão.',
  '- Preservar itens de lavar e estender como etapas distintas; existem horários iguais que precisam de revisão, não de exclusão automática.',
  '- Revisar sobreposição de Duolingo e escovação às 13h, e das rotinas mensais às 23h. Horários atuais são os do arquivo, não uma agenda otimizada.',
  '- Regras mensais no dia 30 não equivalem a último dia do mês. Não deslocar automaticamente para fevereiro.',
  '- Confirmar a validade das aulas do primeiro semestre e do evento avulso antigo antes de incluí-los no planejamento atual.', '',
  '- Divergência: Tirar Lixo diz Seg/Ter/Sab no título, mas a regra define segunda, terça e sexta. Preservar a regra e pedir revisão.',
  '- Divergência: Agendar o Corte de Cabelo Quinzenal está configurado para a primeira quarta de cada mês, não a cada quinze dias. Preservar a regra e pedir revisão.', '',
  '## Inventário completo', '',
  '| Nº | Título original | Categoria sugerida | Início original | Fim original | Recorrência / tipo |',
  '| --- | --- | --- | --- | --- | --- |', ...rows, ''
].join('\n');
fs.writeFileSync(path.join(output, 'ROTINAS-IMPORTADAS.md'), report);
console.log(JSON.stringify({ total: events.length, principais: masters.length, series: recurring.length, avulsos: masters.length - recurring.length, excecoes: events.length - masters.length, duracaoZero: zero, aulasRevisar: oldClasses, regras: counts }, null, 2));
