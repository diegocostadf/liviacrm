ALTER TABLE public.ai_bot_configs
  ADD COLUMN IF NOT EXISTS model_provider text NOT NULL DEFAULT 'lovable',
  ADD COLUMN IF NOT EXISTS model_name text NOT NULL DEFAULT 'google/gemini-3-flash-preview',
  ADD COLUMN IF NOT EXISTS temperature numeric(3,2) NOT NULL DEFAULT 0.4,
  ADD COLUMN IF NOT EXISTS max_tokens integer NOT NULL DEFAULT 1024,
  ADD COLUMN IF NOT EXISTS system_extra text;