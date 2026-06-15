-- RPC: get_published_site
-- Returns ONLY the fields needed to serve a published page, extracted server-side
-- inside Postgres. This avoids transferring the full site_config blob (which includes
-- draft `pages`, `blocks`, `messages`, `media`, `keywords` — all builder-only and can
-- be several MB) over the wire on every public page request.
--
-- Egress impact: full site_config (~3-4MB) → only published_pages + 9 small config
-- fields (~1MB or less). Combined with CDN s-maxage caching, this drastically cuts
-- Supabase egress for www.factulista.com traffic.
--
-- The returned `config` JSONB has the EXACT same key names/shape that servePublished
-- already reads, so the TypeScript code works unchanged.

CREATE OR REPLACE FUNCTION public.get_published_site(p_slug text)
RETURNS TABLE(name text, config jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.name,
    jsonb_strip_nulls(jsonb_build_object(
      'published_pages',    p.site_config->'published_pages',
      'redirects',          p.site_config->'redirects',
      'favicon_url',        p.site_config->'favicon_url',
      'default_og_image',   p.site_config->'default_og_image',
      'inject_points',      p.site_config->'inject_points',
      'shared_css',         p.site_config->'shared_css',
      'shared_nav_html',    p.site_config->'shared_nav_html',
      'shared_footer_html', p.site_config->'shared_footer_html',
      'context',            p.site_config->'context',
      'software',           p.site_config->'software'
    )) AS config
  FROM projects p
  WHERE p.slug = p_slug
    AND p.deleted_at IS NULL
  LIMIT 1;
$$;

-- Allow the service role (used by the Next.js server) to call it.
GRANT EXECUTE ON FUNCTION public.get_published_site(text) TO service_role;
