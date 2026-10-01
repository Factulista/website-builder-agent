-- Phase 2.0 of the Supabase load plan (Oct 2026): the builder opens a project with
-- site_config MINUS published_pages (~3.3MB the editor never reads — the public site
-- is served from published_snapshots). SECURITY INVOKER: projects RLS applies, so a
-- user only gets their own project. The builder falls back to the plain select if
-- this function is missing.
CREATE OR REPLACE FUNCTION public.get_builder_project(p_id uuid)
RETURNS TABLE (name text, slug text, site_config jsonb, custom_domain text, custom_domain_status text)
LANGUAGE sql STABLE
AS $$
  SELECT p.name::text, p.slug::text, p.site_config - 'published_pages', p.custom_domain::text, p.custom_domain_status::text
  FROM projects p
  WHERE p.id = p_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_builder_project(uuid) TO authenticated, service_role;
