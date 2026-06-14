## WhatsApp Cloud API (Meta) — novo provedor

Adicionar a Meta Cloud API como terceiro provedor de mensageria, com gestão completa de templates e Embedded Signup.

### 1. Pré-requisitos que você precisa providenciar

Para usar **Embedded Signup oficial** da Meta, é obrigatório:

1. Um **Meta App** (developers.facebook.com) com os produtos **WhatsApp** e **Facebook Login for Business** habilitados, em modo Live e com o caso de uso "Solution Partner" aprovado.
2. Uma **Configuration ID** do Login for Business (define os escopos `whatsapp_business_management` + `whatsapp_business_messaging` e perfis WABA solicitados).
3. Os seguintes secrets que pedirei via formulário seguro:
   - `META_APP_ID`
   - `META_APP_SECRET`
   - `META_LOGIN_CONFIG_ID`
   - `META_WEBHOOK_VERIFY_TOKEN` (você inventa uma string aleatória; usaremos para validar webhook)
   - `META_SYSTEM_USER_TOKEN` (opcional, fallback quando o cliente quer pular OAuth)

Sem o Meta App aprovado pela Meta o botão "Conectar" abre o popup mas não retorna WABA — não há como o Lovable contornar isso. Implemento toda a infraestrutura mesmo assim para você plugar quando o app estiver liberado.

### 2. Banco de dados

Novo migration:

- `whatsapp_cloud_templates` — espelho local dos templates da Meta (nome, idioma, categoria, status APPROVED/PENDING/REJECTED, rejection_reason, components JSONB, last_synced_at, waba_id).
- `whatsapp_cloud_accounts` — uma linha por WABA conectada (waba_id, business_name, access_token, phone_number_id, display_phone, verified_name, webhook_subscribed).
- `app_settings.key='whatsapp_cloud'` guarda app credentials e default account.
- Estender `campaign_steps` e `campaigns` com `cloud_template_id` (uuid) e `cloud_template_variables` (jsonb) — opcionais, usados só quando provider=cloud.
- Provider enum global passa a aceitar `"evolution" | "twilio" | "cloud"`.

### 3. Backend

- `src/lib/whatsapp-cloud.server.ts` — wrapper Graph API v21 (listar templates, criar, editar, excluir, enviar mensagem template, trocar code→token, subscribe webhook na WABA).
- `src/lib/messaging-broker.server.ts` — adicionar branch `cloud` que envia via Graph com `template.name + language + components[variables]`.
- `src/routes/api/-whatsapp-cloud-settings.server.ts` (+ rota `/api/whatsapp-cloud-settings`) — admin-only: GET/save app credentials, trocar code OAuth por long-lived token, listar WABAs, escolher número, subscribe webhook.
- `src/routes/api/-whatsapp-cloud-templates.server.ts` (+ rota) — listar/sync, criar, editar, excluir templates; testar envio.
- `src/routes/api/public/webhooks/meta-whatsapp.ts` — público:
  - `GET` valida `hub.verify_token` contra `META_WEBHOOK_VERIFY_TOKEN`.
  - `POST` valida assinatura `x-hub-signature-256` com HMAC do `META_APP_SECRET`, processa eventos `message_template_status_update` (atualiza linha local) e `messages` (insere em conversations/messages como o Twilio webhook já faz).

### 4. Frontend — Configurações

- Renomear/atualizar `/settings/whatsapp` para listar 3 provedores (Evolution, Twilio, **Cloud**).
- Novo `src/routes/_authenticated.settings.whatsapp-cloud.tsx` — wizard de 5 passos:
  1. App Meta (App ID / Config ID / Verify token) — salva e mostra URL do webhook para colar no Meta App Dashboard.
  2. Conectar conta (botão Embedded Signup → carrega `connect.facebook.net/en_US/sdk.js`, chama `FB.login` com config_id, recebe code, backend troca por token, lista WABAs e números).
  3. Escolher número padrão + subscribe webhook na WABA.
  4. Testes (ping Graph, enviar template aprovado para número).
  5. Resumo + status do webhook.
- Novo `src/routes/_authenticated.settings.whatsapp-templates.tsx` — tabela de templates com filtro por status, botões Sync, Criar, Editar, Excluir.
- `CreateTemplateDialog` — formulário com header (texto/imagem opcional), body com variáveis `{{1}}…{{n}}`, footer, e até 3 botões (Quick Reply / URL / Phone). Mostra preview e categoria (MARKETING / UTILITY / AUTHENTICATION).

### 5. Frontend — Campanhas

- Em `CampaignSequence`, quando `provider==='cloud'`, mostrar seletor de template aprovado em vez do campo de texto livre, e renderizar inputs para cada variável do template (mapeáveis a campos do contato).
- Validação: bloquear publicar campanha cloud sem template APPROVED.

### 6. Menu

- Adicionar "Templates WhatsApp" sob Configurações no `app-shell`.

### Detalhes técnicos

```text
Webhook URL pública (cole no Meta App Dashboard):
  https://liviacrm.lovable.app/api/public/webhooks/meta-whatsapp

Endpoints Graph usados (v21.0):
  POST /oauth/access_token                              → troca code por token
  GET  /{waba_id}/message_templates                     → listar
  POST /{waba_id}/message_templates                     → criar
  POST /{template_id}                                   → editar
  DEL  /{waba_id}/message_templates?hsm_id=...          → excluir
  POST /{phone_number_id}/messages                      → enviar
  POST /{waba_id}/subscribed_apps                       → subscribe webhook
```

Status de templates são atualizados em tempo real via webhook `message_template_status_update`; o botão Sync força um pull manual via Graph.

### Fora de escopo (posso fazer depois se quiser)

- Catálogo / produtos / fluxos interativos avançados (list / button messages com payload).
- Templates de mídia com upload direto pro Resumable Upload da Meta (faço só URL pública no primeiro corte).
- Migração automática de campanhas Twilio → Cloud.
