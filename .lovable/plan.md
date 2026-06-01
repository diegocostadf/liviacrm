## Lívia CRM — Fase 1: Dashboard + Inbox WhatsApp

Construir o núcleo funcional: autenticação, dashboard com indicadores em tempo real e inbox omnichannel conectado à Evolution API. Estilo SaaS escuro inspirado em Linear/Pipefy.

### Stack e infraestrutura

- TanStack Start (já configurado)
- Lovable Cloud (Supabase) para banco + auth + realtime
- Evolution API via server functions (URL + API key como secrets)
- Tailwind + shadcn com tema dark customizado

### Design system

Tema escuro: fundo `oklch(0.18 0.01 260)`, superfícies elevadas, primário roxo/violeta vivo, tipografia Inter, cantos `0.5rem`, densidade alta (estilo Linear). Sidebar fixa à esquerda com ícones + labels.

### Estrutura de rotas

```text
/login                        público
/_authenticated/              layout com sidebar + header
  ├─ dashboard                indicadores e gráficos
  ├─ inbox                    lista conversas + thread + painel contato
  ├─ inbox/$conversationId    deep link
  └─ connections              instâncias WhatsApp (CRUD + QR)
```

### Banco de dados (Fase 1)

Tabelas mínimas necessárias agora; o resto entra nas próximas fases.

- `profiles` — id (FK auth.users), nome, role (admin/gestor/vendedor/atendimento), avatar
- `user_roles` — tabela separada com enum `app_role` + função `has_role()` security definer
- `whatsapp_instances` — id, nome, evolution_instance_name, status, phone_number, profile_name, profile_pic_url, last_sync_at, owner_id
- `contacts` — id, phone (único), name, profile_pic_url, city, state, tags[], assigned_to, created_at
- `conversations` — id, contact_id, instance_id, last_message_at, last_message_preview, unread_count, status (open/archived), is_favorite, assigned_to
- `messages` — id, conversation_id, direction (in/out), type (text/image/audio/video/document/location), content, media_url, status (sent/delivered/read), wa_message_id, created_at
- `quick_replies` — id, shortcut, content, owner_id
- `internal_notes` — id, conversation_id, author_id, content, created_at

RLS habilitado em todas. Single-tenant: políticas baseadas em `authenticated` + `has_role()` para ações administrativas. Realtime ativado em `messages` e `conversations`.

### Módulo 01 — Dashboard

Grid de cards com indicadores:
- Total de Leads, Leads do Dia, Conversas Ativas, Não Respondidas, Conversões, Receita, Taxa de Resposta, Tempo Médio de Resposta, Campanhas Ativas, Números Conectados

Indicadores que dependem de módulos futuros (Conversões, Receita, Campanhas) entram com valores zerados + badge "em breve" para não mentir dados.

Gráficos com Recharts:
- Conversões por período (linha) — placeholder por enquanto
- Leads por origem (pizza) — quando houver campo `source`
- Vendas por vendedor (barra) — placeholder
- Mensagens enviadas vs recebidas (área empilhada) — dados reais de `messages`

Filtros de período (hoje, 7d, 30d, custom).

### Módulo 02 — Conexão WhatsApp (Evolution API)

Tela `/connections` lista instâncias. Server functions encapsulam todas as chamadas à Evolution API:

- `createInstance(name)` → POST `/instance/create`
- `connectInstance(name)` → GET `/instance/connect/:name` (retorna QR base64)
- `disconnectInstance(name)` → DELETE `/instance/logout/:name`
- `restartInstance(name)` → POST `/instance/restart/:name`
- `deleteInstance(name)` → DELETE `/instance/delete/:name`
- `fetchInstanceInfo(name)` → status, número, foto, nome, conexão

Modal de QR com polling a cada 2s até conectar. Reconexão automática via webhook (próxima sub-fase) ou polling de status a cada 30s na lista.

Webhook receiver: server route `/api/public/webhooks/evolution` que valida assinatura (ou API key compartilhada via header), recebe eventos `messages.upsert`, `connection.update`, `qrcode.updated` e persiste em `messages`/`conversations`/`whatsapp_instances`.

### Módulo 03 — Caixa de Entrada (Inbox)

Layout 3 colunas:

```text
┌──────────┬──────────────────────┬──────────────┐
│ Lista    │ Thread de mensagens  │ Painel       │
│ convs    │                      │ contato      │
│ + busca  │ ┌────────────────┐   │ + notas      │
│ + filtro │ │ msgs           │   │ + tags       │
│          │ └────────────────┘   │ + resp.      │
│          │ [input + anexos]     │              │
└──────────┴──────────────────────┴──────────────┘
```

Lista (esquerda):
- Busca por nome/telefone
- Filtros: não lidas, favoritas, atribuídas a mim, por tag, por instância
- Ações: arquivar, favoritar, marcar como lida
- Realtime: nova mensagem traz conversa pro topo + badge unread

Thread (centro):
- Renderiza text/imagem/áudio (player)/vídeo/PDF/documento/localização (mapa estático)/contato
- Agrupamento por dia, indicador de status (✓ enviado, ✓✓ entregue, ✓✓ azul lido)
- Scroll virtualizado se >100 mensagens
- Input com: emoji picker, anexar arquivo, gravar áudio, respostas rápidas (`/atalho`), botão de nota interna (alterna modo)
- Envio via server function → Evolution API `/message/sendText|sendMedia|sendWhatsAppAudio`

Painel contato (direita):
- Foto, nome, número, cidade/estado, tags editáveis, responsável (select), funil atual (placeholder), histórico de campanhas (placeholder)
- Tab "Notas internas" + tab "Histórico de movimentações"
- Botão "Transferir atendimento" (select de usuário)

### Autenticação

- Email/senha + Google OAuth (via broker Lovable, configurado com `configure_social_auth`)
- `/login` público; tudo dentro de `/_authenticated` redireciona pra `/login` se não houver sessão
- Trigger no signup cria `profiles` automaticamente; primeiro usuário cadastrado vira `admin`

### Secrets necessários

- `EVOLUTION_API_URL` — base URL da sua instância
- `EVOLUTION_API_KEY` — global API key
- `EVOLUTION_WEBHOOK_SECRET` — pra validar webhooks de entrada

Vou pedir via `add_secret` no início da implementação.

### Detalhes técnicos

- Todas as chamadas Evolution API em `src/lib/evolution.functions.ts` (server fns) + helpers em `src/lib/evolution.server.ts`
- Cliente browser Supabase só pra realtime subscriptions de `messages`/`conversations`; reads/writes via server fns com `requireSupabaseAuth`
- Upload de mídia: server fn que recebe base64, encaminha pra Evolution, opcionalmente salva no Supabase Storage pra histórico
- Polling de status de instância: TanStack Query com `refetchInterval: 30000`
- Indicadores do dashboard: server fn agregadora com SQL count/avg, cacheada por 30s

### Fora do escopo desta fase (módulos 04–11)

CRM de Leads, Funil, Automações, Campanhas, Chatbot/IA, Tarefas, Relatórios avançados, Configurações de permissões granulares. Tudo isso será adicionado em fases seguintes sobre essa fundação.

### Entregáveis

1. Migrations das 8 tabelas + RLS + trigger profile
2. Auth (login/logout/signup com Google)
3. Layout autenticado com sidebar
4. `/connections` funcional com Evolution API real
5. Webhook `/api/public/webhooks/evolution` recebendo mensagens
6. `/inbox` com lista, thread, envio de texto/mídia, realtime
7. `/dashboard` com indicadores reais + gráficos de mensagens
