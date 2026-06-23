
-- Fase 1: estender whatsapp_cloud_accounts e adicionar audit log

ALTER TABLE public.whatsapp_cloud_accounts
  ADD COLUMN IF NOT EXISTS business_id text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'connected',
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS solution_id text,
  ADD COLUMN IF NOT EXISTS installed_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_token_refresh_at timestamptz;

CREATE TABLE IF NOT EXISTS public.whatsapp_cloud_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES public.whatsapp_cloud_accounts(id) ON DELETE CASCADE,
  waba_id text,
  event_type text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.whatsapp_cloud_events TO authenticated;
GRANT ALL ON public.whatsapp_cloud_events TO service_role;

ALTER TABLE public.whatsapp_cloud_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wcloud_events_admin_select"
  ON public.whatsapp_cloud_events
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS idx_wcloud_events_account ON public.whatsapp_cloud_events(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wcloud_events_waba ON public.whatsapp_cloud_events(waba_id, created_at DESC);
