# Mapa do Task Tracker

Levantamento em 08/09/2026, sobre o commit `a5ff0ab` da branch `main`.
Repositório: https://github.com/arrualuiz/task-tracker

## Objetivo acordado

Criar e acompanhar tarefas no computador e no Chrome do iPhone 11, sem instalar app. Organizar por tipo, com atenção às rotinas diárias. Usar caixas de seleção no Google Sheets para decidir o que vira tarefa e compartilhar o estado entre as interfaces. Desenvolver o app Android em Kotlin na segunda etapa.

## O que existe no código

### Entrega atual: revisão local persistente

A página de revisão está em `site/revisao.html`, `revisao.css` e `revisao.js`. `npm start` inicia `local/server.cjs` em http://localhost:3210. `local/store.cjs` importa os 111 registros principais uma única vez e mantém `dados-locais/task-tracker.sqlite` como fonte de verdade. A exceção fica anexada à série correspondente.

É possível editar as rotinas reais, frequência, dias, data inicial, horário, categoria, nome da conta de destino, tipo, aprovação e observações. Cada edição tem histórico e controle de versão. A página oferece busca, filtros e exportação de backup JSON. [Detalhes de operação](REVISAO-LOCAL.md).

Esta entrega usa SQLite local e não o Apps Script para as revisões. Os dados do Google não são alterados. O rótulo de conta ainda não conecta credenciais; aprovação não gera ocorrências ou tarefas. As seções abaixo sobre o quadro Apps Script descrevem o comportamento anterior, preservado no código.

### Base inicial de rotinas e várias contas

O usuário quer manter rotinas em uma conta e tarefas avulsas em outra, com visão das duas no site e celular, identificadas e filtráveis por conta. Cada tarefa deve ser alterada na sua conta de origem. A integração Alexa deve usar uma conta escolhida; sua viabilidade específica ainda será investigada.

A exportação **Rotina do Dia a Dia - oluizarrua** foi analisada localmente como ponto de partida. Foram encontrados 112 componentes: 110 séries recorrentes, um evento avulso e uma exceção de ocorrência. Há 19 séries de segunda a sexta, 46 de sábado, nove de domingo e outras regras semanais/mensais. Isso conta séries, não tarefas já criadas nem ocorrências de um período.

O [inventário pessoal completo](../dados-locais/rotinas/ROTINAS-IMPORTADAS.md) e o JSON correspondente ficam em `dados-locais/rotinas/`, ignorados pelo Git. Esse link existe apenas no checkout onde a análise foi executada. O script comentado `scripts/mapear-calendario.cjs` permite repetir a extração; não expande recorrências nem sincroniza dados.

Revisar antes de ativar: 47 eventos principais com duração zero, dez séries de aulas do primeiro semestre sem término, horários simultâneos de etapas de lavanderia e blocos informativos como horário de funcionamento da academia. Categorias foram apenas sugeridas. Nenhum registro foi aprovado nem enviado ao Google.

O modelo de dados deverá incluir `accountId` e `calendarId` na origem, além de `UID` do ICS e identidade da ocorrência. O UID exportado não deve ser usado diretamente como eventId da API. A autorização da conta ainda precisa ser conectada; possuir o ICS não concede acesso à agenda.

Revisão de rotinas por conta/categoria entregue localmente, com aprovação da série. Próxima entrega: gerar ocorrências para o planejamento diário e seleção Fazer por ocorrência. Manter Concluída como ação separada e preservar o histórico entre os dias.

| Arquivo | Responsabilidade e estado atual |
| --- | --- |
| `site/index.html` | Quadro em colunas por lista, painel de listas visíveis, busca, dashboard e carregamento de Chart.js/configuração. Não possui formulário para criar tarefas. |
| `site/style.css` | Tema escuro, cores por alguns nomes de lista, cartões, sidebar e ajustes de responsividade. Ainda precisa de validação no iPhone 11. |
| `site/script.js` | Consulta a API, agrupa tarefas, permite concluir, filtra e desenha gráficos. Salva apenas a visibilidade das listas no localStorage de cada navegador. |
| `site/config.example.js` | Modelo da URL do Apps Script e token. `site/config.js` não está presente neste checkout e é ignorado pelo Git. |
| `apps-script/Code.gs` | API com `listar`, `concluir` e `dashboard`; leitura do Google Tasks e eventos de hoje; gravação de histórico no Sheets; snapshot diário opcional. |
| `apps-script/appsscript.json` | Runtime V8, fuso America/Sao_Paulo, serviço avançado Tasks e permissões. Calendar tem somente leitura. |
| `README.md` | Instruções manuais de configuração e publicação. Não comprovam que exista uma implantação funcionando. |

O quadro original é HTML/CSS/JavaScript e Google Apps Script. A revisão acrescenta backend Node.js/SQLite e testes locais. Não há app Kotlin, etapa de build, manifest PWA ou service worker neste checkout.

## Fluxo atual

1. O site chama o Apps Script por `fetch`, usando GET e token, inclusive para concluir.
2. `listar` busca tarefas pendentes de listas do Google Tasks e eventos de hoje da agenda padrão.
3. `concluir` muda o status de uma Google Task para `completed` e acrescenta uma linha na aba `Log`.
4. Para eventos, `concluir` apenas escreve o log: o evento no Calendar não é alterado e reaparece ao atualizar.
5. O dashboard agrega as linhas do log. Não existe tabela central com estado e IDs de cada tarefa.
6. A atualização ocorre ao abrir ou clicar em sincronizar. Não há atualização em tempo real entre aparelhos.

## Diferenças para o objetivo

- Criar, editar e reabrir tarefas pelo site ainda não existe.
- A planilha é histórico; suas caixas de seleção ainda não criam nem atualizam tarefas.
- A seleção de listas no site apenas oculta colunas localmente. Não aprova tarefas nem sincroniza essa preferência entre aparelhos.
- Não existe rotina de geração diária, aprovação por ocorrência ou vínculo tarefa/evento/linha da planilha.
- O Calendar não recebe criação ou atualização de eventos.
- A integração publicada e as autorizações Google não foram testadas nesta revisão.

## Fluxo proposto para a primeira etapa — ainda não implementado

O Apps Script centralizará as regras compartilhadas por site, planilha e futuro Android. O Google Tasks poderá continuar guardando as tarefas executáveis, enquanto o Sheets guarda planejamento, IDs de integração e histórico.

Separar dois controles:

- **Fazer / aprovada:** esta ocorrência entra no planejamento e gera uma tarefa.
- **Concluída:** a execução terminou; atualizar a tarefa e seu registro relacionado.

Exemplo: “Estudar inglês”, categoria Estudo, rotina diária. Marcar “Fazer” para uma data cria uma única ocorrência nesse dia. Concluir no site atualiza a Google Task e a linha correspondente no Sheets. A ocorrência de amanhã tem identidade própria e preserva o histórico de hoje.

Modelo inicial sugerido:

| Aba | Campos principais |
| --- | --- |
| Rotinas | ID da rotina, título, categoria, dias de repetição, ativa |
| Planejamento | ID da ocorrência, ID da rotina opcional, data, título, categoria, fazer, concluída, horário opcional, listId, taskId, calendarId/eventId opcionais, estado da sincronização, atualizado em |
| Log | ID da ocorrência, instante, ação, origem e resultado |

Tarefas avulsas também entram em Planejamento, sem ID de rotina. Desmarcar “Fazer” deve retirar do planejamento conforme regra a implementar, preservando histórico e sem registrar automaticamente “não feito”.

Usar gatilho instalável para edições manuais no Sheets e reconciliação periódica para alterações externas. Chamadas do site devem executar a sincronização diretamente: escritas por script/API não disparam o gatilho de edição da planilha. Referência: https://developers.google.com/apps-script/guides/triggers/installable

Google Tasks e eventos do Calendar são objetos diferentes. Eventos não têm estado nativo `completed`. Se houver bloqueio de horário por evento, manter vínculo explícito e representar conclusão por convenção visual/metadados; não prometer checkbox nativo de evento. Referência: https://developers.google.com/workspace/calendar/api/v3/reference/events

A escolha inicial é Google Calendar, porque já está integrado ao código. Validar depois se o usuário também quer visualizar pela agenda da Apple. O site deve funcionar online pelo Chrome sem depender de instalação; offline e notificações ficam fora da primeira entrega.

## Pontos encontrados para corrigir durante a evolução

- Há token fixo no backend versionado e o frontend prevê token no navegador. Migrar configuração e autenticação e substituir a credencial antes de publicar a próxima versão; ignorar config.js não remove o segredo do backend nem do histórico.
- A listagem não percorre páginas de listas/tarefas; pode omitir resultados acima do limite da API.
- Agrupamento e preferências usam títulos, que podem se repetir ou mudar. Migrar para IDs.
- O snapshot considera todas as tarefas pendentes, inclusive futuras ou sem data, e todos os eventos de hoje. Não consulta aprovações ou logs de conclusão dos eventos.
- Reexecutar snapshot/conclusão pode duplicar logs; criar gatilho diário repetidamente também cria múltiplos gatilhos.
- Conclusão no Tasks e escrita no Sheets são operações separadas: falha parcial precisa de recuperação sem duplicação.
- Tratar vencimentos como datas de calendário para evitar deslocamento ao dia anterior pelo fuso.
- Mensagens de toast interpolam texto em HTML sem escape; corrigir antes de ampliar entradas do usuário.

## Ordem de implementação

1. Configuração/autenticação, identidade dos registros e regras de aprovação/conclusão.
2. Criar e listar tarefas pelo site, visão Hoje por categoria e experiência de toque no iPhone.
3. Planejamento no Sheets com checkboxes e sincronização sem duplicatas.
4. Rotinas diárias, histórico confiável e integração de calendário conforme tipo de item.
5. Validar na conta Google e no Chrome do iPhone 11; publicar a versão web.
6. Segunda etapa: Android em Kotlin consumindo a mesma API autenticada.

## Verificação deste levantamento

Origem Git conferida; `git fetch origin` executado; `main` sem divergência de `origin/main` e sem alterações locais antes desta documentação. Revisão estática dos arquivos; nenhuma operação em tarefas, agenda ou planilha reais. As novas funcionalidades acima permanecem planejadas.
