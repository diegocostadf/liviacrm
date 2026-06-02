-- Enum de filtro de público de cada disparo
DO $$ BEGIN
  CREATE TYPE public.campaign_step_audience AS ENUM (
    'all',
    'not_responded_step',
    'responded_step',
    'not_subscribed',
    'subscribed',
    'tag_any'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Enum de status do disparo
DO $$ BEGIN
  CREATE TYPE public.campaign_step_status AS ENUM (
    'draft','scheduled','sending','completed','paused','failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Enum de status do envio individual por (step, target)
DO $$ BEGIN
  CREATE TYPE public.campaign_step_send_status AS ENUM (
    'pending','sent','failed','skipped','replied'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Campos extras em campaigns (sequência + opt-out)
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS event_date timestamptz,
  ADD COLUMN IF NOT EXISTS opt_out_keywords text[] NOT NULL DEFAULT ARRAY['sair','parar','não','nao','remover','cancelar']::text[],
  ADD COLUMN IF NOT EXISTS opt_out_reply text DEFAULT 'Tudo bem! Você não receberá mais mensagens deste número. 🙏';

-- Sequência: disparos
CREATE TABLE IF NOT EXISTS public.campaign_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  ord integer NOT NULL DEFAULT 1,
  label text,                                 -- ex.: "D-10"
  name text NOT NULL,                         -- ex.: "Disparo 1 — Convite inicial"
  scheduled_at timestamptz,                   -- data/hora de envio
  template text NOT NULL DEFAULT '',
  audience public.campaign_step_audience NOT NULL DEFAULT 'all',
  audience_step_id uuid,                      -- referência usada em not_responded_step/responded_step
  audience_tags text[] NOT NULL DEFAULT '{}'::text[], -- usado em tag_any
  status public.campaign_step_status NOT NULL DEFAULT 'draft',
  total_count integer NOT NULL DEFAULT 0,
  sent_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  materialized_at timestamptz,                -- quando os step_sends foram criados
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_steps TO authenticated;
GRANT ALL ON public.campaign_steps TO service_role;

ALTER TABLE public.campaign_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY cs_select_all ON public.campaign_steps
  FOR SELECT TO authenticated USING (true);

CREATE POLICY cs_write_admin ON public.campaign_steps
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'gestor'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'gestor'::app_role));

CREATE INDEX IF NOT EXISTS idx_campaign_steps_campaign ON public.campaign_steps(campaign_id, ord);
CREATE INDEX IF NOT EXISTS idx_campaign_steps_due ON public.campaign_steps(status, scheduled_at);

CREATE TRIGGER trg_campaign_steps_updated_at
  BEFORE UPDATE ON public.campaign_steps
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Envios por (disparo, contato)
CREATE TABLE IF NOT EXISTS public.campaign_step_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  step_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  target_id uuid NOT NULL,                    -- referência a campaign_targets
  contact_id uuid,
  phone text NOT NULL,
  status public.campaign_step_send_status NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  rendered_message text,
  wa_message_id text,
  error text,
  locked_until timestamptz,
  sent_at timestamptz,
  replied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(step_id, target_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_step_sends TO authenticated;
GRANT ALL ON public.campaign_step_sends TO service_role;

ALTER TABLE public.campaign_step_sends ENABLE ROW LEVEL SECURITY;

CREATE POLICY css_select_all ON public.campaign_step_sends
  FOR SELECT TO authenticated USING (true);

CREATE POLICY css_write_admin ON public.campaign_step_sends
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'gestor'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'gestor'::app_role));

CREATE INDEX IF NOT EXISTS idx_step_sends_step ON public.campaign_step_sends(step_id, status);
CREATE INDEX IF NOT EXISTS idx_step_sends_pending ON public.campaign_step_sends(status, locked_until);

CREATE TRIGGER trg_step_sends_updated_at
  BEFORE UPDATE ON public.campaign_step_sends
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Opt-out LGPD em contacts
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS opted_out boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS opted_out_at timestamptz,
  ADD COLUMN IF NOT EXISTS opt_out_reason text;