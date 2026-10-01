-- Phase 2.4 of the Oct 2026 Supabase load plan: for projects whose pages live in
-- site_pages (pages_in_table = true), the old site_config.pages / published_pages
-- arrays are stale leftovers nobody reads. Remove them so site_config shrinks from
-- ~7MB to a few hundred KB (every settings read/write gets that much lighter).
--
-- Safety: 1) full backup of those rows first; 2) the function refuses projects not in
-- table mode; 3) rollback still works — pages_migrate_to_config rebuilds both arrays
-- from the table.

CREATE SCHEMA IF NOT EXISTS backups;
CREATE TABLE IF NOT EXISTS backups.site_config_20261006 AS
  SELECT id, site_config, now() AS backed_up_at FROM public.projects WHERE pages_in_table;

CREATE OR REPLACE FUNCTION public.pages_drop_config_copies(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  flag boolean;
  before_bytes int;
  after_bytes int;
BEGIN
  SELECT pages_in_table, pg_column_size(site_config) INTO flag, before_bytes FROM projects WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'project % not found', p_id; END IF;
  IF NOT flag THEN RAISE EXCEPTION 'project % is not in table mode — refusing to drop its pages', p_id; END IF;
  UPDATE projects SET site_config = site_config - 'pages' - 'published_pages' WHERE id = p_id;
  SELECT pg_column_size(site_config) INTO after_bytes FROM projects WHERE id = p_id;
  RETURN jsonb_build_object('project', p_id, 'bytes_before', before_bytes, 'bytes_after', after_bytes);
END;
$$;

REVOKE ALL ON FUNCTION public.pages_drop_config_copies(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pages_drop_config_copies(uuid) TO service_role;

-- Run it for every project already in table mode (today: factulista).
SELECT public.pages_drop_config_copies(id) FROM public.projects WHERE pages_in_table;
