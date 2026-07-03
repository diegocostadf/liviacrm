ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS last_inbound_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_contacts_last_inbound_at ON public.contacts(last_inbound_at);