# Histórico do projeto

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
