-- RPC: save_inline_pages
-- Fast-path save for the inline editor (high-frequency content edits).
--
-- The previous path (saveState → buildSiteConfig) did TWO full SELECTs of
-- site_config (~4MB each) plus a full UPDATE (~4MB) on every autosave —
-- ~12MB of I/O per inline-edit pause. This was the dominant remaining cost.
--
-- This RPC updates ONLY the keys the inline editor can change:
--   pages, shared_nav_html, shared_footer_html
-- via jsonb_set, entirely inside Postgres. The full site_config never
-- crosses the network: only the new pages array (~1-2MB) is sent up.
--
-- SAFETY: jsonb_set replaces only the named keys, so published_pages,
-- keywords, messages, media, favicon_url, context, inject_points, shared_css
-- are all preserved automatically. This is SAFER than the previous full-blob
-- overwrite (which could clobber concurrent changes to other keys).
--
-- NULL-safe: if p_shared_nav / p_shared_footer is NULL (home has no nav/footer),
-- COALESCE keeps the existing value (or JSON null) so jsonb_set never receives
-- a SQL NULL (which would nullify the whole site_config).
--
-- SECURITY INVOKER (default): runs as the calling user, so the existing RLS
-- UPDATE policy on `projects` applies — a user can only update their own project.

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
          jsonb_set(COALESCE(site_config, '{}'::jsonb), '{pages}', p_pages),
          '{shared_nav_html}',
          COALESCE(p_shared_nav, site_config->'shared_nav_html', 'null'::jsonb)
        ),
        '{shared_footer_html}',
        COALESCE(p_shared_footer, site_config->'shared_footer_html', 'null'::jsonb)
      ),
      updated_at = now()
  WHERE id = p_id;
$$;

GRANT EXECUTE ON FUNCTION public.save_inline_pages(uuid, jsonb, jsonb, jsonb) TO authenticated;
-- Also used by server routes (seo-fix) that operate via the service role.
GRANT EXECUTE ON FUNCTION public.save_inline_pages(uuid, jsonb, jsonb, jsonb) TO service_role;
