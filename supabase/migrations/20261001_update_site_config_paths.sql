-- Step 3.3 of the Supabase load plan (Oct 2026): partial site_config updates.
-- Settings saves used to read the whole site_config (~7MB) client-side, change one key
-- and write it all back — heavy, and a lost-update race (the later writer overwrote
-- everything the other had saved meanwhile). This applies a list of path/value sets
-- inside Postgres under a row lock, so concurrent saves compose.
--
-- p_sets: [{"path": ["components_config","crm_form"], "value": {...}}, ...]
--         [{"path": ["legacy_key"], "delete": true}]  removes a key
-- Missing intermediate objects are created; non-object intermediates are replaced by {}.
-- SECURITY INVOKER (default): runs as the caller, so the projects RLS policies apply —
-- a signed-in user can only patch their own project; the service role bypasses RLS.

CREATE OR REPLACE FUNCTION public.update_site_config_paths(p_id uuid, p_sets jsonb)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  cfg  jsonb;
  item jsonb;
  path text[];
  n    int;
  i    int;
BEGIN
  SELECT COALESCE(site_config, '{}'::jsonb) INTO cfg
  FROM projects WHERE id = p_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'project % not found or not accessible', p_id;
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_sets) LOOP
    path := ARRAY(SELECT jsonb_array_elements_text(item->'path'));
    n := coalesce(array_length(path, 1), 0);
    CONTINUE WHEN n = 0;
    IF COALESCE((item->>'delete')::boolean, false) THEN
      cfg := cfg #- path;
      CONTINUE;
    END IF;
    FOR i IN 1..(n - 1) LOOP
      IF jsonb_typeof(cfg #> path[1:i]) IS DISTINCT FROM 'object' THEN
        cfg := jsonb_set(cfg, path[1:i], '{}'::jsonb, true);
      END IF;
    END LOOP;
    cfg := jsonb_set(cfg, path, COALESCE(item->'value', 'null'::jsonb), true);
  END LOOP;

  UPDATE projects SET site_config = cfg, updated_at = now() WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_site_config_paths(uuid, jsonb) TO authenticated, service_role;
