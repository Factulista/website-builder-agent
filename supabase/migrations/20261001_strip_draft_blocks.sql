-- Step 3.1 of the Supabase load plan (Oct 2026): stop persisting the editor-only
-- `blocks` cache in draft pages and version snapshots. Blocks are a per-section split
-- of each page's html, regenerated from it on load (builder) and on demand (chat route);
-- their ids are random and never referenced after a reload. Persisting them doubled
-- every draft page in the ~10MB site_config blob (pages 6.45MB) and in every
-- project_versions snapshot.

-- 1) Backup (private schema, not exposed by the API)
CREATE SCHEMA IF NOT EXISTS backups;
CREATE TABLE IF NOT EXISTS backups.site_config_20261001 AS
  SELECT id, slug, site_config, now() AS backed_up_at
  FROM public.projects
  WHERE jsonb_typeof(site_config->'pages') = 'array';
ALTER TABLE backups.site_config_20261001 ENABLE ROW LEVEL SECURITY;

-- 2) Autosave RPC strips blocks server-side too — protects against builder tabs still
--    running the old client code (they keep sending blocks until reloaded).
--    Same signature/semantics as 20260610_save_inline_pages.sql; grants are preserved.
CREATE OR REPLACE FUNCTION public.save_inline_pages(
  p_id uuid,
  p_pages jsonb,
  p_shared_nav jsonb DEFAULT NULL,
  p_shared_footer jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE projects
  SET site_config = jsonb_set(
        jsonb_set(
          jsonb_set(
            COALESCE(site_config, '{}'::jsonb), '{pages}',
            CASE WHEN jsonb_typeof(p_pages) = 'array'
                 THEN COALESCE((SELECT jsonb_agg(e - 'blocks' ORDER BY t.ord)
                                FROM jsonb_array_elements(p_pages) WITH ORDINALITY AS t(e, ord)), '[]'::jsonb)
                 ELSE p_pages END
          ),
          '{shared_nav_html}',
          COALESCE(p_shared_nav, site_config->'shared_nav_html', 'null'::jsonb)
        ),
        '{shared_footer_html}',
        COALESCE(p_shared_footer, site_config->'shared_footer_html', 'null'::jsonb)
      ),
      updated_at = now()
  WHERE id = p_id;
$$;

-- 3) One-off cleanup: drafts (only the `blocks` key of each page is removed)
UPDATE public.projects
SET site_config = jsonb_set(
  site_config, '{pages}',
  (SELECT COALESCE(jsonb_agg(e - 'blocks' ORDER BY t.ord), '[]'::jsonb)
   FROM jsonb_array_elements(site_config->'pages') WITH ORDINALITY AS t(e, ord))
)
WHERE jsonb_typeof(site_config->'pages') = 'array';

-- 4) One-off cleanup: version snapshots (restore re-splits blocks client-side)
UPDATE public.project_versions
SET pages = (SELECT COALESCE(jsonb_agg(e - 'blocks' ORDER BY t.ord), '[]'::jsonb)
             FROM jsonb_array_elements(pages) WITH ORDINALITY AS t(e, ord))
WHERE jsonb_typeof(pages) = 'array';

-- 5) Check
SELECT (SELECT count(*) FROM backups.site_config_20261001) AS progetti_nel_backup,
       (SELECT count(*) FROM public.project_versions) AS versioni_pulite;
