# Histórico do projeto

## 2026-09-11 — Mais calendários e consulta Google Tasks

- Limite ampliado de 20 para 200 calendários, seleção em lote e até cinco fontes simultâneas por consulta.
- Nova aba Google Tasks com listas por conta, filtros de situação, busca, notas, datas e subtarefas.
- Autorização adicional de leitura Tasks por conta, reaproveitando o JSON e preservando as conexões existentes.
- Paginação, deduplicação por IDs e avisos de falhas parciais.
- Quatorze testes simulados aprovados; nenhuma tarefa real criada, concluída ou excluída.
- Uso real de Tasks depende da ativação da API e consentimento do usuário. Sem push.

## 2026-09-11 — Calendários e autorização Google por conta

- Navegação entre Meu dia, Calendários e Revisão de rotinas.
- Página de consulta de eventos por período, calendário e conta, com busca e identificação da origem.
- Configuração guiada do cliente OAuth e autorização de leitura separada para cada conta Google.
- Credenciais privadas fora do Git, pasta pública e backups; estado/cookie OAuth de uso único e renovação no servidor.
- Paginação, recorrências expandidas pelo Google, eventos de dia inteiro, exceções e avisos de falha parcial.
- Desconexão local sem excluir eventos; planejamento diário e revisões preservados.
- Onze testes isolados aprovados. Conexão real pendente de configuração e consentimento do usuário; sem publicação ou push.

## 2026-09-10 — Meu dia: planejamento por blocos

- Nova tela principal com data, sugestões filtráveis por conta e busca, priorizando rotinas aprovadas.
- Tarefas livres, comentários, horário opcional, duração e reservas de tempo com aviso de sobreposição.
- Organização por manhã, tarde, noite ou sem bloco; movimentação por arraste, setas e seletor acessível ao toque.
- Remoção do planejamento e conclusão/reabertura independentes da aprovação da rotina.
- Persistência diária no SQLite, histórico atômico, proteção contra conflito, salvamento idempotente e backup completo versão 2.
- Revisão original mantida em `/revisao`; dados pessoais preservados, sem sincronização Google ou push.
- Sintaxe validada e seis testes isolados aprovados. Sugestões são indicativas: expansão integral das exceções e regras ICS continua planejada.

## 2026-09-08 — Revisão local com persistência

- Página de revisão com dados reais do calendário, busca e filtros por categoria, situação e conta de destino.
- Edição de título, tipo, repetição, data, horário, duração, aprovação e observações.
- SQLite como fonte de verdade, importação inicial única e histórico transacional antes/depois.
- Proteção contra conflito entre abas e exportação de backup JSON.
- Servidor restrito a localhost, sem operações Google.
- Testes isolados de persistência, reinício, exceções, validação e API.

## 2026-09-08 — Mapeamento inicial

- Mapa da arquitetura existente e requisitos de várias contas, iPhone web e Android futuro.
- Inventário das rotinas do ICS preservando recorrências e exceções.
- Orientações para comentários em português e manutenção do projeto.
