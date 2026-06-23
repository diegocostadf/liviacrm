# WhatsApp Cloud — Tech Provider (Embedded Signup, multi-tenant)

Evoluir o módulo atual para um conector Meta completo onde cada tenant conecta seu próprio WABA via Embedded Signup, e o app passa a operar como Tech Provider (Solution Partner).

## Entregáveis por fase

### Fase 1 — Multi-tenant + Embedded Signup
- Schema: estender `whatsapp_cloud_accounts` para guardar por tenant: `waba_id`, `phone_number_id`, `business_id`, `display_phone_number`, `verified_name`, `access_token_encrypted` (token de longa duração do cliente), `token_expires_at`, `solution_id`, `installed_by_user_id`, `status` (`pending|connected|revoked|error`), `last_error`. RLS por `tenant_id` (já existe coluna).
- Secret novo: `META_SOLUTION_ID` (você fornece). Reaproveita `META_APP_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`.
- Botão **Conectar WhatsApp** dispara `FB.login` com `config_id` (Embedded Signup), `extras.feature: 'whatsapp_embedded_signup'`, `extras.setup.solutionID`.
- Escuta `message` event do popup com `phone_number_id`, `waba_id`.
- Server fn `exchangeSignupCode`: troca `code` por **system user access token de longa duração** do cliente via `/oauth/access_token` + `/{waba_id}/subscribed_apps` para assinar o app no WABA.
- Criptografia simples do token em repouso (AES-GCM com `WHATSAPP_TOKEN_ENC_KEY` gerada).
- UI: card "WhatsApp Cloud" com estado (Conectado / Pendente / Erro), número exibido, botão Desconectar.

### Fase 2 — Webhooks multi-tenant + Phone Numbers + WABA
- Webhook `meta-whatsapp.ts` já existe → resolver `whatsapp_business_account_id` do payload e rotear pro tenant correto.
- Server fns: `listPhoneNumbers(waba_id)`, `getPhoneNumber(id)` (display_phone_number, quality_rating, throughput, messaging_limit_tier), `requestVerificationCode`, `verifyCode`, `register` (registro do número no Cloud API), `setTwoStepPin`.
- Página `/settings/whatsapp-cloud/numbers`: lista, status, ações de registro/verificação.
- WABA info: nome, business_id, on-behalf-of, on-call status.

### Fase 3 — Templates avançados + Media
- Estender `whatsapp_cloud_templates`: `category`, `language`, `components_json` (header/body/footer/buttons), `example_json`.
- CRUD: criar/editar/excluir via `/{waba_id}/message_templates` (com header IMAGE/VIDEO/DOCUMENT + handle de upload).
- Upload de mídia para template: `/{app_id}/uploads` (resumable upload sessions) → handle `h:...`.
- Upload de mídia para envio: `/{phone_number_id}/media` → `media_id`.
- Editor visual de template com preview e variáveis.
- Submeter para aprovação + sincronizar status via webhook `message_template_status_update`.

### Fase 4 — Messages + Contacts
- Enviar template, texto, mídia, interativos (botões/listas) via broker.
- Sincronizar `messages` (status: sent/delivered/read/failed + error code).
- Auto-popular `contacts` de mensagens recebidas (já parcialmente feito).
- Janela 24h: indicador na UI de "fora da janela → só template".

### Fase 5 — Billing + Conversation Analytics + Tokens
- `/{waba_id}/conversation_analytics`: custo por categoria (marketing/utility/auth/service), volume, países.
- Dashboard de billing por tenant.
- Painel de tokens: ver `token_expires_at`, alerta de expiração, botão "Reconectar".
- Auditoria: log de eventos do conector (instalado, revogado, número adicionado, template aprovado/reprovado).

## Detalhes técnicos

### Embedded Signup — fluxo
```
Cliente clica "Conectar WhatsApp"
  └─ FB.login({ config_id: META_LOGIN_CONFIG_ID, response_type:'code',
                override_default_response_type:true,
                extras:{ feature:'whatsapp_embedded_signup',
                         setup:{ solutionID: META_SOLUTION_ID } } })
  └─ window.addEventListener('message') captura { phone_number_id, waba_id }
  └─ POST /api/whatsapp-cloud/embedded-signup { code, phone_number_id, waba_id }
        ├─ GET graph.facebook.com/v21.0/oauth/access_token?client_id&client_secret&code  → access_token (longa duração)
        ├─ POST /{waba_id}/subscribed_apps  (Authorization: Bearer <client_token>)
        ├─ POST /{phone_number_id}/register (pin)
        └─ INSERT/UPDATE whatsapp_cloud_accounts (token criptografado)
```

### Criptografia de tokens
`WHATSAPP_TOKEN_ENC_KEY` (32 bytes random, gerada via generate_secret). AES-256-GCM com IV aleatório por linha. Helpers em `src/lib/whatsapp-cloud.server.ts`.

### Helper Graph API por tenant
`graphFetch(account, path, init)`:
- decripta token
- monta `https://graph.facebook.com/v21.0{path}`
- adiciona `Authorization: Bearer <decrypted>`
- trata erro `190` (token inválido) → marca account `status='revoked'` e exige reconexão

### Estrutura de arquivos novos/alterados
```
src/
├── lib/
│   ├── whatsapp-cloud.server.ts          # estender: graphFetch(account), token enc/dec, exchangeCode
│   ├── whatsapp-cloud-crypto.server.ts   # NOVO — AES-GCM helpers
│   └── whatsapp-cloud.functions.ts       # NOVO — server fns chamadas do front
├── routes/
│   ├── _authenticated.settings.whatsapp-cloud.tsx     # reescrever UI (multi-tenant)
│   ├── _authenticated.settings.whatsapp-numbers.tsx   # F2
│   ├── _authenticated.settings.whatsapp-billing.tsx   # F5
│   └── api/
│       ├── public/webhooks/meta-whatsapp.ts           # roteamento por waba_id
│       └── -whatsapp-cloud-*.server.ts                # handlers internos
```

### Migrações
1. F1: alterar `whatsapp_cloud_accounts` (colunas novas, unique em `(tenant_id, waba_id)`), criar tabela `whatsapp_cloud_events` (audit log).
2. F3: estender `whatsapp_cloud_templates` (componentes JSON, example).

### Secrets
- novos: `META_SOLUTION_ID` (você cola), `WHATSAPP_TOKEN_ENC_KEY` (gerada).
- existentes reutilizados: `META_APP_ID`, `META_APP_SECRET`, `META_LOGIN_CONFIG_ID`, `META_WEBHOOK_VERIFY_TOKEN`.

### Segurança
- Token do cliente nunca volta pro front; só `status` + `display_phone_number`.
- Server fn `exchangeSignupCode` exige `requireSupabaseAuth` + `has_role` (admin do tenant).
- Webhook continua validando `x-hub-signature-256`.

## Execução proposta

Implementar **agora apenas a Fase 1** (Embedded Signup multi-tenant funcionando ponta-a-ponta). Depois você testa conectar um WABA real, e seguimos para F2–F5 incrementalmente.

Confirma a Fase 1? Vou pedir o `META_SOLUTION_ID` no próximo passo (precisa colar do Meta App Dashboard → Configurações Avançadas → Solution ID).
