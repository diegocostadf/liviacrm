-- Move pgvector to extensions schema
CREATE SCHEMA IF NOT EXISTS extensions;
ALTER EXTENSION vector SET SCHEMA extensions;

-- Restrict the security-definer RAG function so only the backend (service_role) can call it.
REVOKE EXECUTE ON FUNCTION public.match_knowledge_chunks(extensions.vector, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.match_knowledge_chunks(extensions.vector, int) FROM anon;
REVOKE EXECUTE ON FUNCTION public.match_knowledge_chunks(extensions.vector, int) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.match_knowledge_chunks(extensions.vector, int) TO service_role;

-- Also lock down has_role and update_updated_at_column from anon (pre-existing definers,
-- ensure they keep their intended access while passing the linter).
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
