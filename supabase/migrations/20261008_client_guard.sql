-- 2026-10-07 incident: a builder tab running an OLD build (loaded before a recovery,
-- never reloaded) kept rewriting all 47 draft pages with stale content. Old builds
-- call pages_write / pages_patch / save_inline_pages WITHOUT a client marker; current
-- builds (and server code) pass p_client. The old signatures now refuse to write
-- ('client_outdated'), so a stale tab gets "salvataggio non riuscito" instead of
-- overwriting. Bump CURRENT_CLIENT here + in lib/pages-store.ts to force-retire builds.

CREATE OR REPLACE FUNCTION public._require_client(p_client text)
RETURNS void LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_client IS NULL OR p_client NOT IN ('builder-3', 'server') THEN
    RAISE EXCEPTION 'client_outdated: questa scheda del builder usa una versione vecchia — ricarica la pagina (Cmd+Shift+R)';
  END IF;
END;
$$;

-- Current implementations (new overloads with the required p_client)
CREATE OR REPLACE FUNCTION public.pages_write(p_id uuid, p_state text, p_pages jsonb, p_shared_nav jsonb, p_shared_footer jsonb, p_client text)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  in_table boolean;
  clean jsonb;
  shared jsonb;
BEGIN
  PERFORM _require_client(p_client);
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

CREATE OR REPLACE FUNCTION public.pages_patch(
  p_id uuid,
  p_state text,
  p_order jsonb,
  p_changed jsonb,
  p_deleted jsonb,
  p_shared_nav jsonb,
  p_shared_footer jsonb,
  p_client text
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
  PERFORM _require_client(p_client);
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
    PERFORM pages_write(p_id, p_state, final, p_shared_nav, p_shared_footer, p_client);
  END IF;

  RETURN jsonb_build_object('changed', n_changed, 'deleted', n_deleted, 'reordered', reordered);
END;
$$;

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
  PERFORM pages_write(p_id, 'published', drafts, NULL, NULL, 'server');
  RETURN jsonb_array_length(drafts);
END;
$$;

-- Old signatures: refuse (stale builds)
CREATE OR REPLACE FUNCTION public.pages_write(p_id uuid, p_state text, p_pages jsonb, p_shared_nav jsonb DEFAULT NULL, p_shared_footer jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM _require_client(NULL); END; $$;

CREATE OR REPLACE FUNCTION public.pages_patch(p_id uuid, p_state text, p_order jsonb, p_changed jsonb, p_deleted jsonb DEFAULT '[]'::jsonb, p_shared_nav jsonb DEFAULT NULL, p_shared_footer jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN PERFORM _require_client(NULL); RETURN NULL; END; $$;

CREATE OR REPLACE FUNCTION public.save_inline_pages(p_id uuid, p_pages jsonb, p_shared_nav jsonb DEFAULT NULL, p_shared_footer jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM _require_client(NULL); END; $$;

REVOKE ALL ON FUNCTION public.pages_write(uuid, text, jsonb, jsonb, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pages_patch(uuid, text, jsonb, jsonb, jsonb, jsonb, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._require_client(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pages_write(uuid, text, jsonb, jsonb, jsonb, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pages_patch(uuid, text, jsonb, jsonb, jsonb, jsonb, jsonb, text) TO authenticated, service_role;
