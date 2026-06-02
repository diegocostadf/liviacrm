# Auditoria + Regras de Disparo + Classificação na Importação

## Parte 1 — Auditoria viva (revisão + testes)

Vou abrir cada serverFn/route do sistema, ler linha a linha e cruzar com testes ao vivo (invocar endpoints, ler logs do Supabase/preview). Áreas cobertas:

| Módulo | Arquivos | O que vou validar |
|---|---|---|
| Auth / Users | `auth.functions.ts`, `users.functions.ts`, `users.server.ts` | RLS, criar/editar/remover, primeiro admin |
| Conversas / Inbox | `inbox.functions.ts`, webhook Evolution | Recebimento, ordenação, unread, atribuição |
| Bot (Lívia) | `ai-bot.server.ts`, `ai-bot.functions.ts`, `ai.server.ts` | Tool call, CRM enrichment, handoff, /resetar, RAG |
| Campanhas | `campaigns.*`, `campaign-steps.*`, `tick.ts` | Materialize, throttle, janela, opt-out, replies |
| Knowledge | `knowledge.*` | Upload, chunking, embedding, busca |
| Leads | `leads.functions.ts` | Filtros, agregações, histórico |
| Dashboard | `dashboard.functions.ts` | Queries, performance |
| Webhooks | `webhooks.functions.ts`, `api/public/webhooks/evolution.ts`, `api/public/campaigns/tick.ts` | Auth, idempotência, payload validation |
| Evolution | `evolution.*` | Erros de rede, retry, sendText/presence |

Entrego um **relatório por módulo** com: status (OK / atenção / quebrado), bug encontrado, risco e correção sugerida. Bugs críticos (que travam fluxo) eu corrijo na mesma rodada. Os de polimento ficam listados para você priorizar.

## Parte 2 — Regras de disparo (campanha + override por step)

### Campos novos em `campaigns` (default global)

| Campo | Tipo | Default | Significado |
|---|---|---|---|
| `allowed_weekdays` | `int[]` | `{1,2,3,4,5}` | Dias da semana permitidos (0=dom, 6=sáb) |
| `max_per_hour` | `int` | `60` | Teto de mensagens por hora por instância |
| `max_per_day` | `int` | `500` | Teto por dia por instância |
| `pause_on_reply` | `bool` | `true` | Para próximos steps se contato já respondeu |
| `dedupe_skip_days` | `int` | `0` | 0 = desligado. Se >0, pula contato que recebeu mensagem em outra campanha nos últimos N dias |
| `allowed_instance_ids` | `uuid[]` | `{}` (vazio = só `instance_id`) | Pool de instâncias para round-robin |
| `retry_max_attempts` | `int` | `3` | Tentativas em caso de falha |
| `retry_backoff_seconds` | `int` | `120` | Espera entre tentativas (cresce exponencial) |

### Override em `campaign_steps` (todos `null` = herda da campanha)

`allowed_weekdays`, `max_per_hour`, `max_per_day`, `pause_on_reply`, `dedupe_skip_days`, `allowed_instance_ids`, `retry_max_attempts`, `retry_backoff_seconds`. Helper `effectiveRules(step, campaign)` resolve a herança numa função só.

### Lógica no tick (`campaign-steps.server.ts → tickStep`)

1. Carrega regras efetivas.
2. Checa janela: dia atual em `allowed_weekdays` E hora atual em `window_start_hour..window_end_hour`. Senão, retorna `{waited: true}`.
3. Conta envios nas últimas 1h e 24h por instância (query em `campaign_step_sends.sent_at`). Se estourou, pula a instância; se todas estouraram, retorna.
4. Para cada `pending`:
   - se `pause_on_reply` e contato tem `replied_at` em qualquer step da campanha → marca `skipped_replied`.
   - se `dedupe_skip_days>0` e contato recebeu de qualquer campanha em <N dias → marca `skipped_dedupe`.
   - escolhe próxima instância pelo round-robin (state em memória + persistido em `campaigns.last_instance_idx`).
   - envia. Em falha, se `attempts < retry_max_attempts` reagenda `locked_until = now + backoff * 2^attempts`. Senão marca `failed`.
5. Throttle entre envios respeita `throttle_min/max_seconds` existente.

### Novos status em `campaign_step_send_status`

Adicionar: `skipped_replied`, `skipped_dedupe`. (já existem: `pending`, `sent`, `failed`, `replied`)

### UI

- Dialog atual de step → nova seção "Regras avançadas (opcional)" colapsada; campos com placeholder mostrando o valor herdado da campanha.
- Tela da campanha → painel "Regras de disparo" com todos os defaults + multi-select de instâncias (lista das `whatsapp_instances` connected).

## Parte 3 — Importação CSV com classificação

### Mudanças

1. No dialog de upload de CSV (`_authenticated.campaigns.$id.tsx` → CSV import) adicionar **antes** do parse:
   - `<Select>` "Classificação inicial dos leads" com as 7 opções: INTERESSADO, INSCRITO, OBJECAO, SEM_INTERESSE, SILENCIO (default), FORA_ESCOPO, LEAD_QUENTE.
   - Checkbox "Sobrescrever classificação se o contato já existir" (default desligado).
2. Função `importCsvAsTargetsAndContacts` agora:
   - upsert em `contacts` (por phone normalizado).
   - se contato é novo OU checkbox marcado: grava `lead_intent_events` inicial com `intent = <escolhido>`, `score=0`, `temperature='frio'` (ou 'quente' se LEAD_QUENTE), `model='import:csv'`.
   - atualiza `contacts.lead_status` derivado da intent (mesma lógica `leadStatusFor` do bot).
   - cria `campaign_targets` normalmente.
3. `contacts` ganha coluna `last_intent` (`lead_intent` enum, nullable) para evitar JOIN toda vez na listagem de leads (denormalização leve, sincronizada por trigger).

## Detalhes técnicos

- **Migration 1**: colunas em `campaigns` + `campaign_steps`, novos valores no enum `campaign_step_send_status`, coluna `last_intent` em `contacts` + trigger que copia o último `lead_intent_events.intent`.
- **Migration 2**: backfill — popula `last_intent` para contatos existentes a partir do evento mais recente.
- `effectiveRules()` em `campaign-steps.server.ts` centraliza a herança step→campanha.
- Round-robin de instância: persistido em `campaigns.last_instance_idx` (`int default 0`); atomic update via `... SET last_instance_idx = (last_instance_idx + 1) % N RETURNING ...`.
- Contagem hora/dia: query `count(*) from campaign_step_sends where status='sent' and sent_at > now() - interval` por instância (gravar `instance_id_used` na linha).
- Coluna nova em `campaign_step_sends`: `instance_id_used uuid` para auditoria + contagem.
- Backoff retry: `locked_until = now + retry_backoff_seconds * 2^(attempts-1)` capado em 1h.
- Sem rate-limiting no endpoint público de tick (continua com token atual `EVOLUTION_WEBHOOK_TOKEN`).
- Validação de CSV continua usando o parser atual (papaparse), só adiciono a etapa de classificação inicial antes do submit.

## Ordem de execução

1. Migration (estrutura + enum + trigger).
2. `effectiveRules` + lógica nova no `tickStep`.
3. UI da campanha (painel de regras + multi-instância).
4. UI do step (override colapsável).
5. Upload CSV com classificação inicial.
6. **Auditoria viva** rodada no final, batendo cada módulo + relatório no chat.

Pergunta única antes de seguir: ok manter `silencio` como default de import (quem nunca falou conosco)?
