ALTER TYPE public.campaign_step_send_status ADD VALUE IF NOT EXISTS 'skipped_replied';
ALTER TYPE public.campaign_step_send_status ADD VALUE IF NOT EXISTS 'skipped_dedupe';

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS allowed_weekdays integer[] NOT NULL DEFAULT '{1,2,3,4,5}',
  ADD COLUMN IF NOT EXISTS max_per_hour integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS max_per_day integer NOT NULL DEFAULT 500,
  ADD COLUMN IF NOT EXISTS pause_on_reply boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS dedupe_skip_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS allowed_instance_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS retry_max_attempts integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS retry_backoff_seconds integer NOT NULL DEFAULT 120,
  ADD COLUMN IF NOT EXISTS last_instance_idx integer NOT NULL DEFAULT 0;

ALTER TABLE public.campaign_steps
  ADD COLUMN IF NOT EXISTS allowed_weekdays integer[],
  ADD COLUMN IF NOT EXISTS max_per_hour integer,
  ADD COLUMN IF NOT EXISTS max_per_day integer,
  ADD COLUMN IF NOT EXISTS pause_on_reply boolean,
  ADD COLUMN IF NOT EXISTS dedupe_skip_days integer,
  ADD COLUMN IF NOT EXISTS allowed_instance_ids uuid[],
  ADD COLUMN IF NOT EXISTS retry_max_attempts integer,
  ADD COLUMN IF NOT EXISTS retry_backoff_seconds integer;

ALTER TABLE public.campaign_step_sends
  ADD COLUMN IF NOT EXISTS instance_id_used uuid;

CREATE INDEX IF NOT EXISTS idx_css_instance_sent_at
  ON public.campaign_step_sends (instance_id_used, sent_at)
  WHERE status = 'sent';

CREATE INDEX IF NOT EXISTS idx_css_contact_status
  ON public.campaign_step_sends (contact_id, status);

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS last_intent public.intent_label,
  ADD COLUMN IF NOT EXISTS last_intent_at timestamptz;

CREATE OR REPLACE FUNCTION public.sync_contact_last_intent()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.contacts
    SET last_intent = NEW.intent,
        last_intent_at = NEW.created_at
    WHERE id = NEW.contact_id
      AND (last_intent_at IS NULL OR last_intent_at <= NEW.created_at);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_contact_last_intent ON public.lead_intent_events;
CREATE TRIGGER trg_sync_contact_last_intent
AFTER INSERT ON public.lead_intent_events
FOR EACH ROW
EXECUTE FUNCTION public.sync_contact_last_intent();

UPDATE public.contacts c
SET last_intent = e.intent,
    last_intent_at = e.created_at
FROM (
  SELECT DISTINCT ON (contact_id) contact_id, intent, created_at
  FROM public.lead_intent_events
  ORDER BY contact_id, created_at DESC
) e
WHERE e.contact_id = c.id
  AND c.last_intent IS NULL;