ALTER TABLE public.campaign_steps
  ADD COLUMN IF NOT EXISTS audience_states text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS audience_cities text[] NOT NULL DEFAULT '{}'::text[];