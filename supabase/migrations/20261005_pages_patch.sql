-- Phase 2.3 of the Oct 2026 Supabase load plan: the builder sends only the pages it
-- changed. pages_patch applies a diff to one state's page list:
--   p_order   : the client's page slugs, in order (json array of strings)
--   p_changed : full page objects the client changed or added (blocks are stripped)
--   p_deleted : slugs the client removed (deleted / renamed away)
-- Pages in the DB that the client doesn't know about (added by another session) are
-- kept, after the client's pages, in their current order — the same collaborative
-- merge the builder used to do client-side, now without downloading every page.
--
-- If the client's view is stale (an unchanged page in p_order no longer exists, or
-- the list has duplicate / missing slugs) it raises 'pages_patch_stale: …' and
-- changes nothing; the builder then falls back to a full write (pages_write).
-- Table mode touches only changed rows (plus positions when the order changed);
-- config mode rebuilds the array and delegates to pages_write.

CREATE OR REPLACE FUNCTION public.pages_patch(
  p_id uuid,
  p_state text,
  p_order jsonb,
  p_changed jsonb,
  p_deleted jsonb DEFAULT '[]'::jsonb,
  p_shared_nav jsonb DEFAULT NULL,
  p_shared_footer jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  in_table boolean;
  changed_map jsonb;
  deleted jsonb := COALESCE(p_deleted, '[]'::jsonb);
  final_slugs text[];
  cur jsonb;
  final jsonb;
  missing text[];
  e jsonb;
  s text;
  h text;
  m jsonb;
  pos int;
  n_changed int := 0;
  n_deleted int := 0;
  reordered boolean := false;
  shared jsonb;
BEGIN
  IF p_state NOT IN ('draft', 'published') THEN RAISE EXCEPTION 'bad state %', p_state; END IF;
  IF jsonb_typeof(p_order) IS DISTINCT FROM 'array' OR jsonb_typeof(p_changed) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'p_order and p_changed must be json arrays';
  END IF;
  SELECT pages_in_table INTO in_table FROM projects WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'project % not found or not accessible', p_id; END IF;

  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_order) o WHERE jsonb_typeof(o) <> 'string')
     OR (SELECT count(*) FROM jsonb_array_elements_text(p_order)) <> (SELECT count(DISTINCT o) FROM jsonb_array_elements_text(p_order) o) THEN
    RAISE EXCEPTION 'pages_patch_stale: bad or duplicate slugs in p_order';
  END IF;
  SELECT COALESCE(jsonb_object_agg(c->>'slug', c - 'blocks'), '{}'::jsonb) INTO changed_map
    FROM jsonb_array_elements(p_changed) c;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(changed_map) k WHERE NOT (p_order ? k)) THEN
    RAISE EXCEPTION 'pages_patch_stale: changed page not in p_order';
  END IF;

  IF in_table THEN
    IF EXISTS (SELECT 1 FROM site_pages WHERE project_id = p_id AND state = p_state
                GROUP BY slug HAVING count(*) > 1 OR slug IS NULL) THEN
      RAISE EXCEPTION 'pages_patch_stale: stored list has duplicate or empty slugs';
    END IF;
    SELECT array_agg(o) INTO missing FROM jsonb_array_elements_text(p_order) o
     WHERE NOT changed_map ? o
       AND NOT EXISTS (SELECT 1 FROM site_pages sp WHERE sp.project_id = p_id AND sp.state = p_state AND sp.slug = o);
    IF missing IS NOT NULL THEN RAISE EXCEPTION 'pages_patch_stale: unknown unchanged pages %', missing; END IF;

    final_slugs := ARRAY(
      SELECT x.slug FROM (
        SELECT o AS slug, i::bigint AS k FROM jsonb_array_elements_text(p_order) WITH ORDINALITY AS t(o, i)
        UNION ALL
        SELECT sp.slug, 1000000 + sp.position FROM site_pages sp
         WHERE sp.project_id = p_id AND sp.state = p_state
           AND NOT (p_order ? sp.slug) AND NOT (deleted ? sp.slug)
      ) x ORDER BY x.k);

    DELETE FROM site_pages WHERE project_id = p_id AND state = p_state AND NOT (slug = ANY(final_slugs));
    GET DIAGNOSTICS n_deleted = ROW_COUNT;

    -- Re-number only when some surviving row is not already at its target position
    -- (two steps: positions are the primary key). Only the small row tuples are
    -- rewritten — html stays in place (unchanged TOAST values are not copied).
    IF EXISTS (SELECT 1 FROM site_pages sp WHERE sp.project_id = p_id AND sp.state = p_state
                AND sp.position <> array_position(final_slugs, sp.slug) - 1) THEN
      UPDATE site_pages SET position = -1 - position WHERE project_id = p_id AND state = p_state;
      UPDATE site_pages sp SET position = array_position(final_slugs, sp.slug) - 1
       WHERE sp.project_id = p_id AND sp.state = p_state;
      reordered := true;
    END IF;

    FOR e IN SELECT value FROM jsonb_each(changed_map) LOOP
      s := e->>'slug';
      pos := array_position(final_slugs, s) - 1;
      h := CASE WHEN jsonb_typeof(e->'html') = 'string' THEN e->>'html' END;
      m := CASE WHEN jsonb_typeof(e->'html') = 'string' THEN e - 'html' ELSE e END;
      UPDATE site_pages SET html = h, meta = m, updated_at = now()
       WHERE project_id = p_id AND state = p_state AND slug = s
         AND (html IS DISTINCT FROM h OR meta IS DISTINCT FROM m);
      IF FOUND THEN
        n_changed := n_changed + 1;
      ELSIF NOT EXISTS (SELECT 1 FROM site_pages WHERE project_id = p_id AND state = p_state AND slug = s) THEN
        INSERT INTO site_pages (project_id, state, position, slug, html, meta, updated_at)
        VALUES (p_id, p_state, pos, s, h, m, now());
        n_changed := n_changed + 1;
      END IF;
    END LOOP;

    shared := jsonb_strip_nulls(jsonb_build_object('shared_nav_html', p_shared_nav, 'shared_footer_html', p_shared_footer));
    UPDATE projects
       SET site_config = CASE WHEN shared = '{}'::jsonb THEN site_config ELSE COALESCE(site_config, '{}'::jsonb) || shared END,
           updated_at = now()
     WHERE id = p_id;
  ELSE
    cur := _pages_json(p_id, p_state, '*', 'config');
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(cur) c GROUP BY c->>'slug' HAVING count(*) > 1 OR c->>'slug' IS NULL) THEN
      RAISE EXCEPTION 'pages_patch_stale: stored list has duplicate or empty slugs';
    END IF;
    SELECT array_agg(o) INTO missing FROM jsonb_array_elements_text(p_order) o
     WHERE NOT changed_map ? o
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(cur) c WHERE c->>'slug' = o);
    IF missing IS NOT NULL THEN RAISE EXCEPTION 'pages_patch_stale: unknown unchanged pages %', missing; END IF;

    SELECT COALESCE(jsonb_agg(x.page ORDER BY x.k), '[]'::jsonb) INTO final FROM (
      SELECT COALESCE(changed_map->o, (SELECT c FROM jsonb_array_elements(cur) c WHERE c->>'slug' = o LIMIT 1)) AS page,
             i::bigint AS k
        FROM jsonb_array_elements_text(p_order) WITH ORDINALITY AS t(o, i)
      UNION ALL
      SELECT c, 1000000 + ci FROM jsonb_array_elements(cur) WITH ORDINALITY AS u(c, ci)
       WHERE NOT (p_order ? (c->>'slug')) AND NOT (deleted ? (c->>'slug'))
    ) x;
    n_changed := (SELECT count(*) FROM jsonb_object_keys(changed_map));
    n_deleted := (SELECT count(*) FROM jsonb_array_elements(cur) c
                   WHERE NOT (p_order ? (c->>'slug')) AND deleted ? (c->>'slug'));
    PERFORM pages_write(p_id, p_state, final, p_shared_nav, p_shared_footer);
  END IF;

  RETURN jsonb_build_object('changed', n_changed, 'deleted', n_deleted, 'reordered', reordered);
END;
$$;

REVOKE ALL ON FUNCTION public.pages_patch(uuid, text, jsonb, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pages_patch(uuid, text, jsonb, jsonb, jsonb, jsonb, jsonb) TO authenticated, service_role;
