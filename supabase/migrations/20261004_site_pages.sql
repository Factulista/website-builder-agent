-- Phase 2.2 of the Oct 2026 Supabase load plan: pages move out of the single
-- projects.site_config jsonb into site_pages (one row per page and state).
--
-- Per-project switch projects.pages_in_table (default false = today's behaviour).
-- Every page read/write goes through the functions below, which pick the source
-- from the switch server-side — so the app never needs to know the mode, and an old
-- open builder tab calling save_inline_pages still writes to the right place.
--
-- Switch on : SELECT pages_migrate_to_table('<project id>');   (copies + verifies, atomic)
-- Switch off: SELECT pages_migrate_to_config('<project id>');  (rebuilds the arrays in
--             site_config from the table, including every edit made meanwhile)
-- While on, site_config.pages / published_pages are stale leftovers (removed in 2.4).

ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS pages_in_table boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.site_pages (
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  state      text NOT NULL CHECK (state IN ('draft', 'published')),
  position   int  NOT NULL,
  slug       text,
  html       text,                       -- NULL when the page has no string html (then it stays in meta)
  meta       jsonb NOT NULL DEFAULT '{}', -- every other page field, exactly as stored before
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, state, position)
);
CREATE INDEX IF NOT EXISTS site_pages_slug_idx ON public.site_pages (project_id, state, slug);

-- Same visibility as the project row itself (the subquery runs under the caller's
-- projects RLS); the service role bypasses RLS.
ALTER TABLE public.site_pages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS site_pages_via_project ON public.site_pages;
CREATE POLICY site_pages_via_project ON public.site_pages FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = site_pages.project_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = site_pages.project_id));

-- ── Internal helpers ──────────────────────────────────────────────────────────

-- Pages of one state as a jsonb array (blocks stripped, in order).
-- p_html_slug: '*' = html for all pages, NULL = none, a slug = only that page.
-- p_source: NULL = follow the project's switch, or force 'config' / 'table'.
CREATE OR REPLACE FUNCTION public._pages_json(p_id uuid, p_state text, p_html_slug text DEFAULT '*', p_source text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
DECLARE
  src text := p_source;
  arr jsonb;
BEGIN
  IF src IS NULL THEN
    SELECT CASE WHEN pages_in_table THEN 'table' ELSE 'config' END INTO src FROM projects WHERE id = p_id;
    IF src IS NULL THEN RETURN NULL; END IF;
  END IF;
  IF src = 'table' THEN
    SELECT jsonb_agg(
             CASE WHEN p_html_slug = '*' OR sp.slug = p_html_slug
                  THEN CASE WHEN sp.html IS NULL THEN sp.meta ELSE sp.meta || jsonb_build_object('html', sp.html) END
                  ELSE sp.meta - 'html' END
             ORDER BY sp.position)
      INTO arr
      FROM site_pages sp
     WHERE sp.project_id = p_id AND sp.state = p_state;
  ELSE
    SELECT jsonb_agg(
             CASE WHEN p_html_slug = '*' OR t.e->>'slug' = p_html_slug
                  THEN t.e - 'blocks'
                  ELSE t.e - 'blocks' - 'html' END
             ORDER BY t.ord)
      INTO arr
      FROM projects p,
           jsonb_array_elements(
             CASE WHEN jsonb_typeof(p.site_config->(CASE WHEN p_state = 'draft' THEN 'pages' ELSE 'published_pages' END)) = 'array'
                  THEN p.site_config->(CASE WHEN p_state = 'draft' THEN 'pages' ELSE 'published_pages' END)
                  ELSE '[]'::jsonb END
           ) WITH ORDINALITY AS t(e, ord)
     WHERE p.id = p_id;
  END IF;
  RETURN COALESCE(arr, '[]'::jsonb);
END;
$$;

-- Make the table rows of one state equal to p_pages (already block-free). Only rows
-- whose content actually changed are rewritten; extra trailing rows are deleted.
CREATE OR REPLACE FUNCTION public._site_pages_put(p_id uuid, p_state text, p_pages jsonb)
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
  INSERT INTO site_pages AS sp (project_id, state, position, slug, html, meta, updated_at)
  SELECT p_id, p_state, (t.ord - 1)::int, t.e->>'slug',
         CASE WHEN jsonb_typeof(t.e->'html') = 'string' THEN t.e->>'html' END,
         CASE WHEN jsonb_typeof(t.e->'html') = 'string' THEN t.e - 'html' ELSE t.e END,
         now()
    FROM jsonb_array_elements(p_pages) WITH ORDINALITY AS t(e, ord)
  ON CONFLICT (project_id, state, position) DO UPDATE
     SET slug = EXCLUDED.slug, html = EXCLUDED.html, meta = EXCLUDED.meta, updated_at = now()
   WHERE sp.slug IS DISTINCT FROM EXCLUDED.slug
      OR sp.html IS DISTINCT FROM EXCLUDED.html
      OR sp.meta IS DISTINCT FROM EXCLUDED.meta;
  DELETE FROM site_pages
   WHERE project_id = p_id AND state = p_state AND position >= jsonb_array_length(p_pages);
$$;

-- ── App API (SECURITY INVOKER: RLS applies to signed-in users) ────────────────

CREATE OR REPLACE FUNCTION public.pages_read(p_id uuid, p_state text)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
DECLARE r jsonb;
BEGIN
  r := _pages_json(p_id, p_state, '*');
  IF r IS NULL THEN RAISE EXCEPTION 'project % not found or not accessible', p_id; END IF;
  RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION public.pages_read_all(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
DECLARE d jsonb;
BEGIN
  d := _pages_json(p_id, 'draft', '*');
  IF d IS NULL THEN RAISE EXCEPTION 'project % not found or not accessible', p_id; END IF;
  RETURN jsonb_build_object('draft', d, 'published', _pages_json(p_id, 'published', '*'));
END;
$$;

-- Replace the page list of one state (blocks stripped). For drafts, p_shared_nav /
-- p_shared_footer (NULL = keep) update the shared nav/footer in the same transaction.
CREATE OR REPLACE FUNCTION public.pages_write(p_id uuid, p_state text, p_pages jsonb, p_shared_nav jsonb DEFAULT NULL, p_shared_footer jsonb DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  in_table boolean;
  clean jsonb;
  shared jsonb;
BEGIN
  IF p_state NOT IN ('draft', 'published') THEN RAISE EXCEPTION 'bad state %', p_state; END IF;
  IF jsonb_typeof(p_pages) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'p_pages must be a json array'; END IF;
  SELECT pages_in_table INTO in_table FROM projects WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'project % not found or not accessible', p_id; END IF;

  SELECT COALESCE(jsonb_agg(t.e - 'blocks' ORDER BY t.ord), '[]'::jsonb) INTO clean
    FROM jsonb_array_elements(p_pages) WITH ORDINALITY AS t(e, ord);
  shared := jsonb_strip_nulls(jsonb_build_object('shared_nav_html', p_shared_nav, 'shared_footer_html', p_shared_footer));

  IF in_table THEN
    PERFORM _site_pages_put(p_id, p_state, clean);
    UPDATE projects
       SET site_config = CASE WHEN shared = '{}'::jsonb THEN site_config ELSE COALESCE(site_config, '{}'::jsonb) || shared END,
           updated_at = now()
     WHERE id = p_id;
  ELSE
    UPDATE projects
       SET site_config = jsonb_set(COALESCE(site_config, '{}'::jsonb),
                                   ARRAY[CASE WHEN p_state = 'draft' THEN 'pages' ELSE 'published_pages' END],
                                   clean) || shared,
           updated_at = now()
     WHERE id = p_id;
  END IF;
END;
$$;

-- Publish: published := drafts, atomically. Returns the number of pages.
CREATE OR REPLACE FUNCTION public.pages_publish(p_id uuid)
RETURNS int
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE drafts jsonb;
BEGIN
  PERFORM 1 FROM projects WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'project % not found or not accessible', p_id; END IF;
  drafts := _pages_json(p_id, 'draft', '*');
  IF jsonb_array_length(drafts) = 0 THEN RAISE EXCEPTION 'Nessuna pagina da pubblicare'; END IF;
  PERFORM pages_write(p_id, 'published', drafts);
  RETURN jsonb_array_length(drafts);
END;
$$;

-- Old builder tabs still call this: same signature, now mode-aware.
CREATE OR REPLACE FUNCTION public.save_inline_pages(p_id uuid, p_pages jsonb, p_shared_nav jsonb DEFAULT NULL, p_shared_footer jsonb DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM pages_write(p_id, 'draft', p_pages, p_shared_nav, p_shared_footer);
END;
$$;

-- ── Switch (service role only) ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.pages_migrate_to_table(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  flag boolean;
  d_cfg jsonb; p_cfg jsonb;
BEGIN
  SELECT pages_in_table INTO flag FROM projects WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'project % not found', p_id; END IF;
  IF flag THEN RETURN jsonb_build_object('already', 'table'); END IF;
  d_cfg := _pages_json(p_id, 'draft', '*', 'config');
  p_cfg := _pages_json(p_id, 'published', '*', 'config');
  DELETE FROM site_pages WHERE project_id = p_id;
  PERFORM _site_pages_put(p_id, 'draft', d_cfg);
  PERFORM _site_pages_put(p_id, 'published', p_cfg);
  -- Verify the table rebuilds exactly the same arrays; any difference aborts the
  -- whole transaction (nothing copied, switch untouched).
  IF _pages_json(p_id, 'draft', '*', 'table') IS DISTINCT FROM d_cfg
     OR _pages_json(p_id, 'published', '*', 'table') IS DISTINCT FROM p_cfg THEN
    RAISE EXCEPTION 'verification failed for project %: table copy differs from site_config', p_id;
  END IF;
  UPDATE projects SET pages_in_table = true WHERE id = p_id;
  RETURN jsonb_build_object('mode', 'table', 'draft', jsonb_array_length(d_cfg), 'published', jsonb_array_length(p_cfg), 'verified', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.pages_migrate_to_config(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  flag boolean;
  d_tab jsonb; p_tab jsonb;
BEGIN
  SELECT pages_in_table INTO flag FROM projects WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'project % not found', p_id; END IF;
  IF NOT flag THEN RETURN jsonb_build_object('already', 'config'); END IF;
  d_tab := _pages_json(p_id, 'draft', '*', 'table');
  p_tab := _pages_json(p_id, 'published', '*', 'table');
  UPDATE projects
     SET site_config = jsonb_set(jsonb_set(COALESCE(site_config, '{}'::jsonb), '{pages}', d_tab), '{published_pages}', p_tab),
         pages_in_table = false,
         updated_at = now()
   WHERE id = p_id;
  RETURN jsonb_build_object('mode', 'config', 'draft', jsonb_array_length(d_tab), 'published', jsonb_array_length(p_tab));
END;
$$;

-- ── Existing readers, now mode-aware (same signatures and output shape) ───────

CREATE OR REPLACE FUNCTION public.get_published_site(p_slug text)
RETURNS TABLE(name text, config jsonb)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.name,
    jsonb_strip_nulls(jsonb_build_object(
      'published_pages',    _pages_json(p.id, 'published', '*'),
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

CREATE OR REPLACE FUNCTION public.get_published_page(p_slug text, p_page text)
RETURNS TABLE(name text, config jsonb)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.name,
    jsonb_strip_nulls(jsonb_build_object(
      'published_pages',    _pages_json(p.id, 'published', p_page),
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

CREATE OR REPLACE FUNCTION public.get_site_config_lite(p_slug text, p_html_slug text DEFAULT NULL)
RETURNS TABLE(id uuid, name text, custom_domain text, config jsonb)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.name,
    p.custom_domain,
    (COALESCE(p.site_config, '{}'::jsonb)
      - 'published_pages' - 'pages' - 'messages' - 'media' - 'versions')
    || jsonb_build_object('pages', _pages_json(p.id, 'draft', p_html_slug))
  FROM projects p
  WHERE p.slug = p_slug
    AND p.deleted_at IS NULL
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_builder_project(p_id uuid)
RETURNS TABLE (name text, slug text, site_config jsonb, custom_domain text, custom_domain_status text)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT p.name::text, p.slug::text,
         (COALESCE(p.site_config, '{}'::jsonb) - 'published_pages' - 'pages')
           || jsonb_build_object('pages', _pages_json(p.id, 'draft', '*')),
         p.custom_domain::text, p.custom_domain_status::text
  FROM projects p
  WHERE p.id = p_id;
$$;

-- ── Grants ────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public._pages_json(uuid, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._site_pages_put(uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pages_read(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pages_read_all(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pages_write(uuid, text, jsonb, jsonb, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pages_publish(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pages_migrate_to_table(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pages_migrate_to_config(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._pages_json(uuid, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._site_pages_put(uuid, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pages_read(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pages_read_all(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pages_write(uuid, text, jsonb, jsonb, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pages_publish(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pages_migrate_to_table(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.pages_migrate_to_config(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_inline_pages(uuid, jsonb, jsonb, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_builder_project(uuid) TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_pages TO authenticated, service_role;
