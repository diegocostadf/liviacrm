ALTER TABLE public.ai_bot_configs
  ADD COLUMN IF NOT EXISTS handoff_phone text,
  ADD COLUMN IF NOT EXISTS typing_indicator boolean NOT NULL DEFAULT true;