# Histórico do projeto

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
