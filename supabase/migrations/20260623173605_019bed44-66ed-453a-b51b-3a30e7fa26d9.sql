-- =====================================================================
-- META INTEGRATION — Fase 1: tabelas base do Meta Connector (single-tenant)
-- =====================================================================
-- Todas as tabelas são admin-only por enquanto (single-tenant).
-- Tokens são armazenados encriptados (AES-256-GCM) em meta_tokens.token_encrypted.
-- Não usamos foreign keys para auth.users porque o acesso é gerido por role.

-- ---------- meta_businesses (Business Portfolio Meta) ----------
CREATE TABLE public.meta_businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meta_business_id TEXT NOT NULL UNIQUE,
  business_name TEXT NOT NULL,
  portfolio_id TEXT,
  status TEXT NOT NULL DEFAULT 'connected',
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  disconnected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meta_businesses TO authenticated;
GRANT ALL ON public.meta_businesses TO service_role;
ALTER TABLE public.meta_businesses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage meta_businesses" ON public.meta_businesses
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ---------- meta_whatsapp_accounts (WABA) ----------
CREATE TABLE public.meta_whatsapp_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.meta_businesses(id) ON DELETE CASCADE,
  waba_id TEXT NOT NULL UNIQUE,
  name TEXT,
  currency TEXT,
  timezone_id TEXT,
  message_template_namespace TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  subscribed BOOLEAN NOT NULL DEFAULT false,
  subscribed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meta_whatsapp_accounts TO authenticated;
GRANT ALL ON public.meta_whatsapp_accounts TO service_role;
ALTER TABLE public.meta_whatsapp_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage meta_whatsapp_accounts" ON public.meta_whatsapp_accounts
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ---------- meta_phone_numbers ----------
CREATE TABLE public.meta_phone_numbers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  waba_id UUID NOT NULL REFERENCES public.meta_whatsapp_accounts(id) ON DELETE CASCADE,
  phone_number_id TEXT NOT NULL UNIQUE,
  display_phone_number TEXT NOT NULL,
  verified_name TEXT,
  quality_rating TEXT,
  messaging_limit TEXT,
  status TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  registered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meta_phone_numbers TO authenticated;
GRANT ALL ON public.meta_phone_numbers TO service_role;
ALTER TABLE public.meta_phone_numbers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage meta_phone_numbers" ON public.meta_phone_numbers
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ---------- meta_tokens (encrypted) ----------
-- token_encrypted format: base64(iv) || ':' || base64(ciphertext) || ':' || base64(authTag)
CREATE TABLE public.meta_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.meta_businesses(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'business' CHECK (kind IN ('business','system_user')),
  token_encrypted TEXT NOT NULL,
  scopes TEXT[],
  system_user_id TEXT,
  expires_at TIMESTAMPTZ,
  last_refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX meta_tokens_business_idx ON public.meta_tokens(business_id, is_active);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meta_tokens TO authenticated;
GRANT ALL ON public.meta_tokens TO service_role;
ALTER TABLE public.meta_tokens ENABLE ROW LEVEL SECURITY;
-- Admins can see metadata, but never the encrypted blob in app code (server fn projects safe cols).
CREATE POLICY "admins manage meta_tokens" ON public.meta_tokens
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ---------- meta_webhooks ----------
CREATE TABLE public.meta_webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  waba_id UUID NOT NULL REFERENCES public.meta_whatsapp_accounts(id) ON DELETE CASCADE,
  callback_url TEXT NOT NULL,
  verify_token TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  last_event_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meta_webhooks TO authenticated;
GRANT ALL ON public.meta_webhooks TO service_role;
ALTER TABLE public.meta_webhooks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage meta_webhooks" ON public.meta_webhooks
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ---------- meta_webhook_events (event log) ----------
CREATE TABLE public.meta_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  waba_id TEXT,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  processed BOOLEAN NOT NULL DEFAULT false,
  processed_at TIMESTAMPTZ,
  error TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX meta_webhook_events_received_idx ON public.meta_webhook_events(received_at DESC);
CREATE INDEX meta_webhook_events_waba_idx ON public.meta_webhook_events(waba_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meta_webhook_events TO authenticated;
GRANT ALL ON public.meta_webhook_events TO service_role;
ALTER TABLE public.meta_webhook_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read meta_webhook_events" ON public.meta_webhook_events
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ---------- meta_logs (audit) ----------
CREATE TABLE public.meta_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info','warn','error')),
  message TEXT NOT NULL,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX meta_logs_created_idx ON public.meta_logs(created_at DESC);
CREATE INDEX meta_logs_kind_idx ON public.meta_logs(kind);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meta_logs TO authenticated;
GRANT ALL ON public.meta_logs TO service_role;
ALTER TABLE public.meta_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read meta_logs" ON public.meta_logs
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ---------- updated_at triggers ----------
CREATE TRIGGER meta_businesses_updated BEFORE UPDATE ON public.meta_businesses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER meta_whatsapp_accounts_updated BEFORE UPDATE ON public.meta_whatsapp_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER meta_phone_numbers_updated BEFORE UPDATE ON public.meta_phone_numbers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER meta_tokens_updated BEFORE UPDATE ON public.meta_tokens
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER meta_webhooks_updated BEFORE UPDATE ON public.meta_webhooks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();