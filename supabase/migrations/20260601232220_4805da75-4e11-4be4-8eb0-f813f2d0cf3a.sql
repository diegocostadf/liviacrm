ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS bot_context_reset_at timestamptz;