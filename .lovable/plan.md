## Escopo

Single-tenant. Reaproveitar tudo que já existe em `/settings/whatsapp-cloud`, `/settings/whatsapp-templates`, tabelas `whatsapp_cloud_accounts/templates/events`, SDK `whatsapp-cloud.server.ts` e webhook `/api/public/webhooks/meta-whatsapp`. Não recriar tabelas `whatsapp_accounts/messages/contacts` — usar as já existentes (`messages`, `contacts`).

## O que já está pronto (não mexer)

- Tabela `whatsapp_cloud_accounts` com token, WABA, phone_number, is_default.
- Tabela `whatsapp_cloud_templates` (componentes, status, rejection_reason, variables_count).
- Wizard de 5 passos em `/settings/whatsapp-cloud` (App Meta → Embedded Signup → Webhook → Testes → Resumo) com fallback manual, banner de verificação de domínio e FB SDK.
- Server actions: exchange-code, list-wabas, list-phones, save-account, subscribe-webhook, sync-templates, send-test, set-default, delete.
- Webhook público valida `X-Hub-Signature-256`, processa `message_template_status_update` e `messages.statuses[]`.
- Broker (`messaging-broker.server.ts`) já suporta provider `cloud` com `sendTemplateMessage` e `sendFreeText`.

## Lacunas a fechar

### 1. Wizard (`/settings/whatsapp-cloud`)
- Adicionar passo intermediário "Templates" entre webhook e testes (sincroniza + oferece criar o primeiro).
- Salvar progresso na URL (`?step=N`) para permitir sair e voltar.
- Melhorar Step 5 (checklist visual: conta ✓ / webhook ✓ / templates aprovados X de Y / teste enviado ✓).

### 2. Construtor visual de templates (`/settings/whatsapp-templates`)
Substituir o `Dialog` atual por uma tela `/settings/whatsapp-templates/new` (e `.../:id/edit`) com layout duas colunas:
- Esquerda: formulário (name, language, category, header, body com botão "Inserir variável", exemplos, footer, botões QUICK_REPLY/URL/PHONE_NUMBER).
- Direita: **preview em tempo real** renderizando bolha WhatsApp (fundo `#e5ddd5`, bolha branca com cauda, header, body com variáveis destacadas em amarelo, footer cinza, botões azuis clicáveis).
- Ao editar template APPROVED, avisar que gera nova versão para reaprovação.
- Detalhe: exibir motivo de rejeição com dicas para correção.

### 3. Motor de envio com regras (server-side, transparente)
Novo arquivo `src/lib/messaging-rules.server.ts`:
- `assertCanSend(contactId, { templateRequired })` — busca `contacts.last_inbound_at`, `contacts.opt_in`; se fora da janela 24h e não é template → erro claro.
- `assertOptIn(contactId)` — bloqueia envio se `opt_in = false`.
- Adaptar `messaging-broker.brokerSendText` para aceitar `contactId` opcional e chamar essas checagens quando presente (não quebra chamadas de teste).
- Migration mínima: adicionar `last_inbound_at timestamptz` e `opt_in boolean default false` em `contacts` se não existirem.
- Ampliar webhook `messages` field para gravar inbound: atualizar `contacts.last_inbound_at` e inserir em `messages` (já existe estrutura).
- Idempotência: usar `meta_message_id` (`wa_message_id`) como chave — pular se já existe.

### 4. Painel de monitoramento
Nova rota `/settings/whatsapp-cloud/dashboard` (link no Step 5):
- KPIs: enviadas, entregues, lidas, falhas (últimos 7/30 dias) via `SELECT count(*) FROM messages WHERE ...`.
- Funil visual (enviado → entregue → lido).
- Tabela últimos 50 envios com status + erro.
- Filtro por período e por template.

## Fora do escopo desta rodada
- Envio em massa com fila/rate-limit — próxima rodada.
- Multi-tenant (`tenant_id` em todas as tabelas) — usuário optou por single-tenant.
- Inbox de resposta manual — já existe `/inbox`, apenas garantir que inbound do webhook alimenta ele.

## Detalhes técnicos

### Arquivos criados
- `src/lib/messaging-rules.server.ts` — regras 24h/opt-in.
- `src/components/whatsapp/template-preview.tsx` — bolha WhatsApp para preview.
- `src/routes/_authenticated.settings.whatsapp-templates.new.tsx` — construtor visual (form + preview).
- `src/routes/_authenticated.settings.whatsapp-cloud.dashboard.tsx` — painel.

### Arquivos editados
- `src/routes/_authenticated.settings.whatsapp-cloud.tsx` — Step Templates + checklist final + `?step=` na URL.
- `src/routes/_authenticated.settings.whatsapp-templates.tsx` — botão "Novo template" navega para `/new` (removendo Dialog).
- `src/routes/api/-whatsapp-cloud-templates.server.ts` — expor `get-by-id` para tela de edit.
- `src/routes/api/public/webhooks/meta-whatsapp.ts` — processar inbound: upsert `contacts.last_inbound_at`, insert em `messages` (idempotente por `wa_message_id`).
- `src/lib/messaging-broker.server.ts` — parâmetro opcional `contactId` que dispara `assertCanSend`.
- Migration: `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS last_inbound_at timestamptz, ADD COLUMN IF NOT EXISTS opt_in boolean NOT NULL DEFAULT false;` (com aprovação).

### Ordem de execução
1. Migration contacts (opt_in + last_inbound_at).
2. Regras de envio + broker.
3. Webhook inbound + idempotência.
4. Preview component + tela nova de template.
5. Wizard: passo Templates + URL state.
6. Dashboard.

Ao final: rodar tsgo e verificar build.
