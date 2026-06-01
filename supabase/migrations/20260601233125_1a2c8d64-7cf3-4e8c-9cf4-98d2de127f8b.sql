ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS history text,
  ADD COLUMN IF NOT EXISTS landing_link_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS landing_link_sent_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS journey_completed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS journey_completed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_contacts_journey_completed
  ON public.contacts (journey_completed)
  WHERE journey_completed = true;