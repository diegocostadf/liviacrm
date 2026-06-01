DROP POLICY IF EXISTS "contacts_insert_auth" ON public.contacts;
CREATE POLICY "contacts_insert_staff" ON public.contacts FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'gestor'::public.app_role)
    OR public.has_role(auth.uid(), 'atendimento'::public.app_role)
  );