-- RPC: save_project_keywords
-- Safe, atomic update of the keywords key in site_config via jsonb_set.
-- Unlike the old select+update pattern, this NEVER risks wiping other keys
-- (published_pages, pages, context, etc.) even if called during a DB outage,
-- because jsonb_set touches only the 'keywords' key.
--
-- Keywords are stored in compressed format: {k, v, d, i} instead of
-- {keyword, volume, difficulty, intent, parentKeyword} — saving ~60% space.

CREATE OR REPLACE FUNCTION public.save_project_keywords(
  p_id uuid,
  p_keywords jsonb  -- array of {k, v, d, i} compressed objects
)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE projects
  SET site_config = jsonb_set(
        COALESCE(site_config, '{}'::jsonb),
        '{keywords}',
        p_keywords
      ),
      updated_at = now()
  WHERE id = p_id;
$$;

GRANT EXECUTE ON FUNCTION public.save_project_keywords(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_project_keywords(uuid, jsonb) TO service_role;
