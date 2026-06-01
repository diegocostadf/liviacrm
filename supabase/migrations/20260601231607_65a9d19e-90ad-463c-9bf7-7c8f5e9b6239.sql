ALTER TABLE public.ai_bot_configs
  ADD COLUMN IF NOT EXISTS system_prompt_md text;