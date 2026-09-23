-- Cut per-request payload for public serving (Vercel Fluid Active CPU incident, Sep 2026).
-- site_config was ~13MB (every page stored twice — draft + published — each with html AND a
-- duplicate `blocks` copy). Public routes downloaded + JSON.parsed all of it per request.
-- These two RPCs return only what serving needs; callers fall back to the old path if absent.

-- 1) Whole-site shell for blog / Ayuda / sitemap / robots / llms / favicon routes.
--    Drops published_pages, messages, media, versions; strips `blocks` from every draft page;
--    keeps a page's `html` only for p_html_slug (a slug, '*' = all pages, NULL = none).
--    No jsonb_strip_nulls: generateRobots distinguishes inMenu null vs missing.
CREATE OR REPLACE FUNCTION public.get_site_config_lite(p_slug text, p_html_slug text DEFAULT NULL)
RETURNS TABLE(id uuid, name text, custom_domain text, config jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.name,
    p.custom_domain,
    (COALESCE(p.site_config, '{}'::jsonb)
      - 'published_pages' - 'pages' - 'messages' - 'media' - 'versions')
    || jsonb_build_object('pages', COALESCE((
         SELECT jsonb_agg(
                  CASE WHEN p_html_slug = '*' OR e->>'slug' = p_html_slug
                       THEN e - 'blocks'
                       ELSE e - 'blocks' - 'html' END
                  ORDER BY t.ord)
         FROM jsonb_array_elements(COALESCE(p.site_config->'pages', '[]'::jsonb)) WITH ORDINALITY AS t(e, ord)
       ), '[]'::jsonb))
  FROM projects p
  WHERE p.slug = p_slug
    AND p.deleted_at IS NULL
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_site_config_lite(text, text) TO service_role;

-- 2) One published page for servePublished (www / custom domains).
--    Same keys as get_published_site, but published_pages carries html ONLY for p_page;
--    every other entry keeps its metadata (slug, name, megaMenu…) for nav/mega menus,
--    redirects and knownSlugs. `blocks` always stripped (builder-only).
CREATE OR REPLACE FUNCTION public.get_published_page(p_slug text, p_page text)
RETURNS TABLE(name text, config jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.name,
    jsonb_strip_nulls(jsonb_build_object(
      'published_pages', COALESCE((
         SELECT jsonb_agg(
                  CASE WHEN e->>'slug' = p_page
                       THEN e - 'blocks'
                       ELSE e - 'blocks' - 'html' END
                  ORDER BY t.ord)
         FROM jsonb_array_elements(COALESCE(p.site_config->'published_pages', '[]'::jsonb)) WITH ORDINALITY AS t(e, ord)
       ), '[]'::jsonb),
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

GRANT EXECUTE ON FUNCTION public.get_published_page(text, text) TO service_role;
