ALTER TABLE public.campaign_step_sends
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS read_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_css_wa_message_id ON public.campaign_step_sends (wa_message_id) WHERE wa_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_wa_message_id ON public.messages (wa_message_id) WHERE wa_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_css_step_status ON public.campaign_step_sends (step_id, status);
CREATE INDEX IF NOT EXISTS idx_css_campaign_status ON public.campaign_step_sends (campaign_id, status);

-- Defaults para novas campanhas: 100/hora distribuído (cadência ~36s)
ALTER TABLE public.campaigns
  ALTER COLUMN max_per_hour SET DEFAULT 100,
  ALTER COLUMN throttle_min_seconds SET DEFAULT 30,
  ALTER COLUMN throttle_max_seconds SET DEFAULT 45;