# Meta Integration — Embedded Signup + WhatsApp Cloud (Multi-Tenant)

Escopo enorme. Vou dividir em **6 fases entregáveis**, cada uma testável de ponta a ponta. Confirme as fases antes de eu começar a codar.

## Arquitetura central

**Meta Connector SDK** (`src/lib/meta-connector/`): único ponto de saída para a Graph API. Todo módulo (CRM, IA, campanhas, webhooks) consome o SDK — nada chama a Meta diretamente.

```text
src/lib/meta-connector/
├── client.ts          graphFetch + retry + rate limit
├── crypto.ts          AES-256-GCM (tokens encrypted at rest)
├── businesses.ts      connect / disconnect / list
├── waba.ts            list WABAs, subscribe, info
├── phones.ts          list, register, verify, display name
├── templates.ts       CRUD + sync
├── messages.ts        send (text/template/media/interactive)
├── media.ts           upload/download
├── webhooks.ts        verify + dispatch
├── tokens.ts          refresh, expiration, rotate
└── types.ts
```

**Multi-tenant**: tudo escopado por `company_id` (= tenant). RLS força isolamento — nenhuma query cross-tenant possível mesmo via bug.

## Modelo de dados (Fase 0)

Novas tabelas (cada uma com RLS por `company_id` via `user_companies`):

- `companies` — tenant raiz (id, name, slug, created_at)
- `user_companies` — N:N usuário ↔ tenant + role (`meta_admin`/`meta_manager`/`meta_viewer`)
- `meta_businesses` — Business Portfolio Meta conectado
- `meta_whatsapp_accounts` — WABA (waba_id, business_id, status)
- `meta_phone_numbers` — números (phone_number_id, display_name, quality, limit, verified)
- `meta_tokens` — access/refresh token **encriptado**, expires_at, scopes, system_user_id
- `meta_webhooks` — config webhook por tenant (verify_token, status, last_event_at)
- `meta_webhook_events` — log bruto de eventos recebidos (para reprocessar)
- `meta_templates` — templates sincronizados (estende `whatsapp_cloud_templates`)
- `meta_logs` — auditoria (signup, token refresh, webhook, falhas)

Migração das tabelas atuais (`whatsapp_cloud_accounts`) para o novo modelo via script de backfill.

Novo enum `app_role`: adiciona `meta_admin`, `meta_manager`, `meta_viewer` ao existente.

Função `has_company_role(company_id, role)` SECURITY DEFINER — usada em todas as policies.

## Fases

### Fase 1 — Fundação multi-tenant + SDK base
- Migração: `companies`, `user_companies`, RLS, função `current_company_id()` (cookie ou seleção UI).
- SDK Meta Connector skeleton (`client.ts`, `crypto.ts`, `tokens.ts`).
- Secret `META_TOKEN_ENCRYPTION_KEY` (32 bytes) gerado.
- Seletor de tenant no header (se usuário ∈ múltiplos).

### Fase 2 — Embedded Signup + persistência
- Botão **Conectar WhatsApp** carrega `fb-sdk.js` e dispara `FB.login` com `config_id` (Solution ID já cadastrado em `META_LOGIN_CONFIG_ID`).
- Callback recebe `code` + `signup data` → server fn `exchangeSignupCode`:
  - Troca por long-lived token (60d).
  - Cria System User token (permanente).
  - Lê `/debug_token`, lista WABAs, números.
  - Persiste em `meta_businesses` + `meta_whatsapp_accounts` + `meta_phone_numbers` + `meta_tokens` (encriptado).
  - Subscribe app ao WABA (`POST /{waba-id}/subscribed_apps`).
  - Registra `display_phone_number` + PIN (se número novo).
- Tela **Visão Geral** com status + botões Reconectar/Atualizar/Desconectar.

### Fase 3 — Webhooks multi-tenant + Templates
- Rota pública `/api/public/webhooks/meta` (já existe `meta-whatsapp.ts`) refatorada:
  - Valida assinatura `x-hub-signature-256` com `META_APP_SECRET`.
  - Roteia evento por `entry[].id` (= WABA id) → resolve `company_id`.
  - Persiste em `meta_webhook_events`, dispara handlers por tipo.
  - Eventos: `messages`, `message_status`, `template_status_update`, `phone_number_name_update`, `account_update`, `quality_update`.
- UI **Webhooks**: status, último evento, reprocessar, erros.
- UI **Templates**: lista, sincronizar, criar (visual builder simples), editar, deletar.
- UI **Números**: lista, qualidade, limite, registrar novo.

### Fase 4 — Mensagens + Mídia + CRM auto-provisioning
- SDK `messages.ts`: `sendText`, `sendTemplate`, `sendMedia`, `sendInteractive`.
- SDK `media.ts`: upload (resumable), download (com auth).
- Auto-criação ao conectar: inbox padrão, fila, primeiro operador, contato webhook.
- Sync de status (sent/delivered/read/failed) na tabela `messages` existente.

### Fase 5 — Tokens, Logs, IA, Admin
- Job (cron via `/api/public/cron/refresh-tokens`) renova tokens < 7d antes de expirar.
- Tela **Tokens**: gerado, expira, escopos, renovar manual.
- Tela **Logs** com filtro por tipo/severidade.
- Configuração de IA por tenant (assistente, prompt, modelo, KB) — reusa `ai_bot_configs`.
- Tela **Meta Administration** (role `admin` global): todas empresas, WABAs, números, tokens, eventos.

### Fase 6 — Wizard + Sandbox + Monitoramento
- Wizard 5 passos: empresa → conectar Meta → Embedded Signup → IA → concluir.
- Modo Sandbox (toggle): usa número de teste Meta, isolado de produção.
- Dashboard de monitoramento: conexões ativas, msg/dia, falhas, tokens expirando, qualidade.

## Detalhes técnicos

**Criptografia de tokens**: AES-256-GCM com chave em `META_TOKEN_ENCRYPTION_KEY`. Funções `encryptToken()`/`decryptToken()` em `crypto.ts`. Tokens **nunca** retornados ao client — apenas flag `has_token` + `expires_at`.

**graphFetch helper** (assinatura):
```ts
graphFetch(companyId, path, { method, body, useSystemUser? })
```
Carrega token do tenant, decripta, faz request, trata 401 (token expirado → tenta refresh → retry), 4xx (loga em `meta_logs`), 5xx (retry com backoff).

**Rotas/arquivos novos principais**:
```text
src/lib/meta-connector/...
src/lib/meta.functions.ts          // server fns expostas ao client
src/routes/_authenticated.meta.tsx                   // layout + sidebar
src/routes/_authenticated.meta.overview.tsx
src/routes/_authenticated.meta.connect.tsx
src/routes/_authenticated.meta.numbers.tsx
src/routes/_authenticated.meta.businesses.tsx
src/routes/_authenticated.meta.tokens.tsx
src/routes/_authenticated.meta.templates.tsx
src/routes/_authenticated.meta.webhooks.tsx
src/routes/_authenticated.meta.logs.tsx
src/routes/_authenticated.meta.settings.tsx
src/routes/_authenticated.meta.admin.tsx             // role admin
src/components/meta/EmbeddedSignupButton.tsx
src/components/meta/ConnectionStatusCard.tsx
src/components/meta/TemplateEditor.tsx
src/components/meta/Wizard.tsx
```

**Secrets necessários** (já presentes: `META_APP_ID`, `META_APP_SECRET`, `META_LOGIN_CONFIG_ID`, `META_WEBHOOK_VERIFY_TOKEN`). Vou gerar:
- `META_TOKEN_ENCRYPTION_KEY` (32 bytes — `generate_secret`)

**Tabelas existentes a preservar/migrar**: `whatsapp_cloud_accounts`, `whatsapp_cloud_templates`, `whatsapp_cloud_events`, `messages`, `contacts`, `conversations`. Não dropar — adapter mantém compat enquanto migramos.

## Tamanho e estratégia de entrega

Cada fase é ~1-2k linhas + 1 migração. **Não dá pra entregar tudo num turno só** sem virar um patch ingovernável. Sugiro:

1. Eu implemento **Fase 1 + Fase 2** agora (fundação + signup funcionando ponta a ponta). Você testa o Embedded Signup real.
2. Depois confirmamos cada fase seguinte.

## Pergunta antes de começar

1. **Multi-tenancy hoje**: o app atual não tem `companies` — todos os usuários compartilham dados. Posso introduzir `companies` agora com migração que coloca todo mundo numa company default "Padrão", ou você prefere que isso fique pra fase posterior e Fase 1/2 sigam single-tenant?
2. **Manter tabelas `whatsapp_cloud_*`** atuais como legado (adapter) ou refatorar in-place renomeando pra `meta_*`?

Responda 1 e 2 que eu já parto pra Fase 1 + 2.