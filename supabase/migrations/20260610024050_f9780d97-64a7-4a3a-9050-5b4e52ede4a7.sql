CREATE TABLE public.saved_lists (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  shared BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_lists TO authenticated;
GRANT ALL ON public.saved_lists TO service_role;
ALTER TABLE public.saved_lists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "saved_lists_select" ON public.saved_lists FOR SELECT TO authenticated USING (owner_id = auth.uid() OR shared = true);
CREATE POLICY "saved_lists_insert" ON public.saved_lists FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY "saved_lists_update" ON public.saved_lists FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "saved_lists_delete" ON public.saved_lists FOR DELETE TO authenticated USING (owner_id = auth.uid());
CREATE TRIGGER trg_saved_lists_updated_at BEFORE UPDATE ON public.saved_lists FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_saved_lists_owner ON public.saved_lists(owner_id);