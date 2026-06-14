
-- WhatsApp Cloud accounts (one row per WABA / phone number)
CREATE TABLE public.whatsapp_cloud_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  waba_id TEXT NOT NULL UNIQUE,
  business_name TEXT,
  phone_number_id TEXT NOT NULL,
  display_phone_number TEXT,
  verified_name TEXT,
  access_token TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ,
  webhook_subscribed BOOLEAN NOT NULL DEFAULT false,
  is_default BOOLEAN NOT NULL DEFAULT false,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_cloud_accounts TO authenticated;
GRANT ALL ON public.whatsapp_cloud_accounts TO service_role;
ALTER TABLE public.whatsapp_cloud_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wcloud_accounts_admin_select" ON public.whatsapp_cloud_accounts
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "wcloud_accounts_admin_write" ON public.whatsapp_cloud_accounts
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_wcloud_accounts_updated
  BEFORE UPDATE ON public.whatsapp_cloud_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- WhatsApp Cloud templates (mirror of Meta's template catalog)
CREATE TABLE public.whatsapp_cloud_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.whatsapp_cloud_accounts(id) ON DELETE CASCADE,
  meta_template_id TEXT,
  name TEXT NOT NULL,
  language TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  rejection_reason TEXT,
  quality_score TEXT,
  components JSONB NOT NULL DEFAULT '[]'::jsonb,
  variables_count INT NOT NULL DEFAULT 0,
  last_synced_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, name, language)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_cloud_templates TO authenticated;
GRANT ALL ON public.whatsapp_cloud_templates TO service_role;
ALTER TABLE public.whatsapp_cloud_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wcloud_templates_auth_select" ON public.whatsapp_cloud_templates
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "wcloud_templates_admin_write" ON public.whatsapp_cloud_templates
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_wcloud_templates_updated
  BEFORE UPDATE ON public.whatsapp_cloud_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX wcloud_templates_status_idx ON public.whatsapp_cloud_templates(status);
CREATE INDEX wcloud_templates_account_idx ON public.whatsapp_cloud_templates(account_id);

-- Extend campaign tables with cloud template references
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS cloud_template_id UUID REFERENCES public.whatsapp_cloud_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cloud_template_variables JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.campaign_steps
  ADD COLUMN IF NOT EXISTS cloud_template_id UUID REFERENCES public.whatsapp_cloud_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cloud_template_variables JSONB NOT NULL DEFAULT '{}'::jsonb;
