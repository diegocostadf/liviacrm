-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Enums
CREATE TYPE public.message_sender AS ENUM ('human', 'bot', 'system');
CREATE TYPE public.lead_status AS ENUM ('novo', 'engajado', 'inscrito', 'perdido');
CREATE TYPE public.intent_temperature AS ENUM ('frio', 'morno', 'quente');
CREATE TYPE public.intent_label AS ENUM ('curioso', 'interessado', 'pronto_pra_comprar', 'objecao', 'desinteressado');
CREATE TYPE public.kb_doc_status AS ENUM ('processing', 'ready', 'error');
CREATE TYPE public.campaign_status AS ENUM ('draft', 'scheduled', 'running', 'paused', 'completed', 'failed');
CREATE TYPE public.campaign_target_status AS ENUM ('pending', 'sent', 'failed', 'replied', 'opt_out');

-- Add columns to existing tables
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS sent_by public.message_sender;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS bot_active boolean NOT NULL DEFAULT false;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS intent_temperature public.intent_temperature;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS utm_content text;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS lead_status public.lead_status NOT NULL DEFAULT 'novo';
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS last_score_at timestamptz;

-- =========================================================
-- knowledge_documents
-- =========================================================
CREATE TABLE public.knowledge_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  mime text,
  size_bytes integer,
  source_text text,
  status public.kb_doc_status NOT NULL DEFAULT 'processing',
  error text,
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.knowledge_documents TO authenticated;
GRANT ALL ON public.knowledge_documents TO service_role;

ALTER TABLE public.knowledge_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY kd_select_all ON public.knowledge_documents
  FOR SELECT TO authenticated USING (true);
CREATE POLICY kd_write_admin ON public.knowledge_documents
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gestor'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gestor'));

CREATE TRIGGER kd_set_updated_at BEFORE UPDATE ON public.knowledge_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- knowledge_chunks (vector store)
-- Using 1536 dims (request Gemini embeddings with dimensions=1536)
-- so we can use a standard HNSW index (max 2000 dims).
-- =========================================================
CREATE TABLE public.knowledge_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.knowledge_documents(id) ON DELETE CASCADE,
  ord integer NOT NULL,
  content text NOT NULL,
  token_count integer,
  embedding vector(1536),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.knowledge_chunks TO authenticated;
GRANT ALL ON public.knowledge_chunks TO service_role;

ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY kc_select_all ON public.knowledge_chunks
  FOR SELECT TO authenticated USING (true);
CREATE POLICY kc_write_admin ON public.knowledge_chunks
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gestor'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gestor'));

CREATE INDEX knowledge_chunks_document_id_idx ON public.knowledge_chunks(document_id);
CREATE INDEX knowledge_chunks_embedding_idx ON public.knowledge_chunks
  USING hnsw (embedding vector_cosine_ops);

-- RAG search function
CREATE OR REPLACE FUNCTION public.match_knowledge_chunks(
  query_embedding vector(1536),
  match_count int DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  document_id uuid,
  content text,
  similarity float
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    c.id,
    c.document_id,
    c.content,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM public.knowledge_chunks c
  WHERE c.embedding IS NOT NULL
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- =========================================================
-- ai_bot_configs
-- =========================================================
CREATE TABLE public.ai_bot_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id uuid NOT NULL UNIQUE REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  persona text NOT NULL DEFAULT 'Voce e Julia, assistente de vendas amigavel e direta.',
  goal text NOT NULL DEFAULT 'Qualificar o lead e enviar o link certo para conversao.',
  tone text NOT NULL DEFAULT 'amigavel, breve, sem jargao',
  language text NOT NULL DEFAULT 'pt-BR',
  group_link text,
  landing_link text,
  rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  business_hours jsonb NOT NULL DEFAULT '{}'::jsonb,
  out_of_hours_message text,
  handoff_keywords text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_bot_configs TO authenticated;
GRANT ALL ON public.ai_bot_configs TO service_role;

ALTER TABLE public.ai_bot_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY abc_select_all ON public.ai_bot_configs
  FOR SELECT TO authenticated USING (true);
CREATE POLICY abc_write_admin ON public.ai_bot_configs
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gestor'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gestor'));

CREATE TRIGGER abc_set_updated_at BEFORE UPDATE ON public.ai_bot_configs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- campaigns
-- =========================================================
CREATE TABLE public.campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  instance_id uuid NOT NULL REFERENCES public.whatsapp_instances(id),
  template text NOT NULL,
  ai_personalize boolean NOT NULL DEFAULT true,
  throttle_min_seconds integer NOT NULL DEFAULT 8,
  throttle_max_seconds integer NOT NULL DEFAULT 20,
  window_start_hour integer NOT NULL DEFAULT 8,
  window_end_hour integer NOT NULL DEFAULT 21,
  status public.campaign_status NOT NULL DEFAULT 'draft',
  created_by uuid,
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  total_count integer NOT NULL DEFAULT 0,
  sent_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  replied_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaigns TO authenticated;
GRANT ALL ON public.campaigns TO service_role;

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY camp_select_all ON public.campaigns
  FOR SELECT TO authenticated USING (true);
CREATE POLICY camp_write_admin ON public.campaigns
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gestor'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gestor'));

CREATE TRIGGER camp_set_updated_at BEFORE UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- campaign_targets
-- =========================================================
CREATE TABLE public.campaign_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  phone text NOT NULL,
  name text,
  custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  rendered_message text,
  status public.campaign_target_status NOT NULL DEFAULT 'pending',
  sent_at timestamptz,
  wa_message_id text,
  error text,
  attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_targets TO authenticated;
GRANT ALL ON public.campaign_targets TO service_role;

ALTER TABLE public.campaign_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY ct_select_all ON public.campaign_targets
  FOR SELECT TO authenticated USING (true);
CREATE POLICY ct_write_admin ON public.campaign_targets
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gestor'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gestor'));

CREATE INDEX campaign_targets_campaign_id_idx ON public.campaign_targets(campaign_id);
CREATE INDEX campaign_targets_status_idx ON public.campaign_targets(status);

CREATE TRIGGER ct_set_updated_at BEFORE UPDATE ON public.campaign_targets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- lead_intent_events
-- =========================================================
CREATE TABLE public.lead_intent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  temperature public.intent_temperature NOT NULL,
  intent public.intent_label NOT NULL,
  score integer NOT NULL DEFAULT 0,
  summary text,
  suggested_next text,
  model text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_intent_events TO authenticated;
GRANT ALL ON public.lead_intent_events TO service_role;

ALTER TABLE public.lead_intent_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY lie_select_all ON public.lead_intent_events
  FOR SELECT TO authenticated USING (true);
CREATE POLICY lie_write_staff ON public.lead_intent_events
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'gestor')
    OR public.has_role(auth.uid(), 'atendimento')
  );

CREATE INDEX lead_intent_events_conv_idx ON public.lead_intent_events(conversation_id, created_at DESC);
CREATE INDEX lead_intent_events_contact_idx ON public.lead_intent_events(contact_id, created_at DESC);

-- =========================================================
-- webhook_endpoints
-- =========================================================
CREATE TABLE public.webhook_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  url text NOT NULL,
  secret text,
  events text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  last_status integer,
  last_called_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.webhook_endpoints TO authenticated;
GRANT ALL ON public.webhook_endpoints TO service_role;

ALTER TABLE public.webhook_endpoints ENABLE ROW LEVEL SECURITY;

CREATE POLICY we_admin_all ON public.webhook_endpoints
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gestor'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gestor'));

CREATE TRIGGER we_set_updated_at BEFORE UPDATE ON public.webhook_endpoints
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- webhook_deliveries
-- =========================================================
CREATE TABLE public.webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id uuid NOT NULL REFERENCES public.webhook_endpoints(id) ON DELETE CASCADE,
  event text NOT NULL,
  payload jsonb NOT NULL,
  response_status integer,
  response_body text,
  attempt integer NOT NULL DEFAULT 1,
  succeeded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.webhook_deliveries TO authenticated;
GRANT ALL ON public.webhook_deliveries TO service_role;

ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY wd_admin_all ON public.webhook_deliveries
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gestor'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gestor'));

CREATE INDEX webhook_deliveries_endpoint_idx ON public.webhook_deliveries(endpoint_id, created_at DESC);
