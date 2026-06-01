## Fase 4 — Sistema Vendedor com IA Generativa

Implementar o fluxo do diagrama dentro do Lívia CRM, com 3 pontos de IA integrados, mantendo CRM e landing externos via webhook.

### Mapeamento do fluxo para o sistema

```text
Camada 1 disparo          → módulo Campanhas (CSV + template + IA personaliza)
Camada 2 bot Júlia        → IA conversacional (RAG) responde no Inbox automaticamente
Camada 3 dois caminhos    → Bot envia link A (grupo WA) ou B (landing) conforme intenção
Camada 4 rastreio UTM     → utm_source/medium/content gerados por lead no link
Camada 5 CRM externo      → webhook outbound pra ActiveCampaign/RD/Sheets via Zapier
Camada 6 confirmação      → webhook inbound (landing/grupo) marca INSCRITO
Saída LEAD_QUENTE         → IA pontua conversa, fila prioritária no Inbox
```

### Módulos a construir

**1. Base de conhecimento (RAG)** — `/knowledge`
- Upload de PDFs/docs do produto (curso Russomano, FAQ, objeções).
- Chunking automático (500–1000 chars com overlap), embeddings via Lovable AI (`google/gemini-embedding-001`).
- Armazenamento em pgvector pra busca semântica.
- Lista de docs indexados, status de processamento, reindexar/excluir.

**2. Configuração do Bot Júlia** — `/settings/ai-bot`
- Persona, objetivo, tom de voz, idioma.
- Instância WhatsApp que o bot atende (escolhe da lista existente).
- Modo: só responde / responde + classifica / desligado.
- Regras de roteamento: "se intenção = inscrever → envia link A (grupo)" ou "link B (landing)".
- Templates dos dois links com placeholders UTM.
- Horário de atendimento e mensagem fora do horário.
- Handoff: gatilhos pra transferir pra humano (palavras-chave, score alto, pedido explícito).

**3. Campanhas de disparo** — `/campaigns`
- Lista de campanhas com status (rascunho/agendada/em execução/concluída).
- Nova campanha: nome, instância, upload CSV (telefone + nome + campos custom), template base de mensagem.
- IA gera variação personalizada por contato usando nome + campos custom + tom da persona.
- Preview lado a lado (template → mensagem final renderizada).
- Throttling configurável (ex: 1 msg a cada 8–15s aleatório) e janela de envio (evita madrugada).
- Execução em fila com job worker: cada disparo cria/atualiza `contacts` + `conversations` e dispara via Evolution.
- Dashboard da campanha: enviadas, entregues, respondidas, taxa de resposta, opt-out.

**4. Bot conversacional automático no Inbox**
- Quando chega mensagem nova (webhook Evolution), se a conversa estiver em modo bot e a instância tiver bot ativo:
  - Server fn busca histórico da conversa + contexto via RAG (top-k chunks da base de conhecimento).
  - Chama Lovable AI (`google/gemini-3-flash-preview`) com persona + histórico + contexto + tools.
  - Tools disponíveis ao modelo: `enviar_link_grupo`, `enviar_link_landing`, `marcar_intencao`, `transferir_humano`, `agendar_followup`.
  - Resposta enviada pela Evolution; mensagem marcada `sent_by=bot` no DB.
- Inbox mostra badge "🤖 Bot" nas conversas automáticas; botão "Assumir conversa" pausa o bot.

**5. Scoring de lead quente**
- A cada N mensagens (ou ao detectar intenção forte), server fn roda classificação com Gemini retornando JSON estruturado (tool calling):
  - `temperatura`: frio/morno/quente
  - `intencao`: curioso/interessado/pronto_pra_comprar/objeção
  - `proximo_passo` sugerido
  - `resumo` curto da conversa
- Salva em `lead_intent_events`. Quando vira `quente`, conversa pula pra topo do Inbox com tag visual.
- Filtro no Inbox: "Fila prioritária (quente)".

**6. Webhooks externos (Camada 5 e 6)**
- **Outbound** (sistema → CRM): a cada mudança relevante (lead novo, intenção atualizada, virou quente, INSCRITO) dispara POST configurável pro Zapier/ActiveCampaign/RD com payload padrão `{telefone, nome, email, utm_*, origem, intencao, score, timestamp}`.
- **Inbound** (landing/grupo → sistema): rotas públicas:
  - `/api/public/webhooks/landing-submit` recebe form da landing (telefone + email + UTM) → marca contato como `INSCRITO`.
  - `/api/public/webhooks/wa-group-join` recebe evento "membro entrou no grupo" do Evolution → marca contato como `INSCRITO`.
- Tela `/settings/integrations`: URLs do webhook de saída, secret de assinatura, log das últimas chamadas (sucesso/erro).

**7. Links UTM por lead**
- Função interna `buildTrackedLink(contact_id, destino)` gera URL com `utm_source=whatsapp&utm_medium=bot&utm_content={telefone}`.
- Bot e templates de campanha usam essa função; armazenamos o link gerado em `messages.metadata` pra correlação posterior com inbound.

### Banco de dados — novas tabelas

- `campaigns` — id, name, instance_id, template, ai_personalize (bool), throttle_min/max, window_start/end, status, created_by, created_at
- `campaign_targets` — id, campaign_id, contact_id, rendered_message, sent_at, status (pending/sent/failed/replied), error
- `knowledge_documents` — id, name, mime, size, status (processing/ready/error), uploaded_by, created_at
- `knowledge_chunks` — id, document_id, content, embedding vector(3072), token_count, ord
- `ai_bot_configs` — id, instance_id (unique), persona, goal, tone, language, enabled, rules (jsonb com roteamento + handoff), business_hours (jsonb), updated_at
- `lead_intent_events` — id, conversation_id, contact_id, temperatura, intencao, score, summary, suggested_next, created_at
- `webhook_endpoints` — id, name, url, secret, events (text[]), active, last_status, last_called_at
- `webhook_deliveries` — id, endpoint_id, event, payload, response_status, response_body, attempt, created_at

Colunas adicionadas:
- `messages.sent_by` (`human|bot|system`), `messages.metadata` (jsonb com link UTM, tool calls).
- `conversations.bot_active` (bool default true quando vem de campanha), `conversations.intent_temperature` (cached do último evento).
- `contacts.utm_content`, `contacts.lead_status` (`novo|engajado|inscrito|perdido`), `contacts.last_score_at`.

RLS em todas, mesmo padrão atual (authenticated lê, service_role full).

### Stack técnica

- **IA**: Lovable AI Gateway. Chat = `google/gemini-3-flash-preview` (rápido + baratos pra resposta de bot). Classificação/scoring = mesmo modelo via tool calling pra JSON estruturado. Embeddings = `google/gemini-embedding-001` (3072 dims).
- **RAG**: pgvector + HNSW index. Top-k=5 chunks por query, incluídos como contexto no system prompt.
- **Server functions** (`createServerFn`) pra: ingestão de doc, embed+chunk, query RAG, gerar resposta do bot, scoring, render personalizado de campanha.
- **Worker de disparo**: server fn agendada via setInterval no servidor + lock em campaign_targets pra evitar duplicação; throttle por instância respeitando janela.
- **Webhooks inbound/outbound**: rotas em `src/routes/api/public/*` com verificação de assinatura HMAC.
- **Realtime**: já existente para `messages`/`conversations`; adicionar canal pra `lead_intent_events` atualizar o Inbox quando score muda.

### Telas novas (sidebar)

- 📢 **Campanhas** — listar, criar, monitorar disparos.
- 📚 **Base de conhecimento** — upload e gestão de documentos.
- 🤖 **Bot Júlia** (em Configurações) — persona, regras, instância, links.
- 🔗 **Integrações** (em Configurações) — webhooks in/out, secrets, logs.

Inbox ganha: badge "🤖 Bot", filtro "Fila quente", botão "Assumir/Devolver pro bot", painel lateral mostra último score + intenção + resumo da IA.

### Ordem de entrega sugerida

1. Migrations das tabelas novas + colunas extras.
2. Base de conhecimento (upload + chunk + embed + busca) — fundação do RAG.
3. Bot Júlia conversacional no Inbox (responde automaticamente com RAG, tools básicas).
4. Scoring de lead quente + fila prioritária.
5. Campanhas de disparo com personalização IA.
6. Webhooks inbound/outbound + tela de integrações.
7. Polimento: dashboard de campanha, métricas no painel principal, logs de IA.

### Secrets

Tudo já configurado: `LOVABLE_API_KEY`, `EVOLUTION_*`, Supabase. Nada novo a pedir agora.

### Fora do escopo desta fase

- Landing page hospedada no sistema (continua externa).
- CRM completo com pipeline kanban (continua externo via webhook).
- Voz/áudio gerado por IA, chamadas, agendamento de reuniões.
- Multi-tenant / múltiplos produtos por workspace.
