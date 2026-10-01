-- Disk/WAL investigation (Oct 2026): project_versions was 37MB (36MB TOAST) for 58
-- rows — every version stored a full copy of all pages (factulista: 47 pages,
-- ~1.2MB compressed per version), created every 90s of editing + every AI change,
-- then pruned to 10. Each copy cost WAL and left dead TOAST space behind.
--
-- Now page html is stored ONCE per distinct content (page_html_blobs, keyed by
-- sha256) and a version holds only the page metadata + `html_ref` hashes. A new
-- version after a one-page edit stores one new blob (~80KB) instead of 3.3MB.
-- Blobs no longer referenced by any version are deleted when versions are pruned.
--
-- Also: published_snapshots.body_hash, so snapshot regeneration rewrites only the
-- pages whose rendered html changed.

CREATE TABLE IF NOT EXISTS public.page_html_blobs (
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  hash       text NOT NULL,          -- sha256 hex of the html (UTF-8)
  html       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, hash)
);
ALTER TABLE public.page_html_blobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS page_html_blobs_via_project ON public.page_html_blobs;
CREATE POLICY page_html_blobs_via_project ON public.page_html_blobs FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = page_html_blobs.project_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = page_html_blobs.project_id));

CREATE OR REPLACE FUNCTION public._html_hash(t text)
RETURNS text LANGUAGE sql IMMUTABLE
AS $$ SELECT encode(sha256(convert_to(t, 'UTF8')), 'hex') $$;

-- pages (html inline and/or html_ref) → pages with html_ref only; stores new blobs.
-- Raises version_missing_blobs if a referenced hash isn't stored (client resends html).
CREATE OR REPLACE FUNCTION public._version_pack(p_id uuid, p_pages jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  packed_pages jsonb := '[]'::jsonb;
  e jsonb;
  h text;
  missing text[] := '{}';
BEGIN
  FOR e IN SELECT t.e FROM jsonb_array_elements(COALESCE(p_pages, '[]'::jsonb)) WITH ORDINALITY AS t(e, o) ORDER BY t.o LOOP
    e := e - 'blocks';
    IF jsonb_typeof(e->'html') = 'string' THEN
      h := _html_hash(e->>'html');
      INSERT INTO page_html_blobs (project_id, hash, html) VALUES (p_id, h, e->>'html') ON CONFLICT DO NOTHING;
      e := (e - 'html') || jsonb_build_object('html_ref', h);
    ELSIF e ? 'html_ref' AND NOT EXISTS (SELECT 1 FROM page_html_blobs WHERE project_id = p_id AND hash = e->>'html_ref') THEN
      missing := missing || (e->>'html_ref');
    END IF;
    packed_pages := packed_pages || jsonb_build_array(e);
  END LOOP;
  IF cardinality(missing) > 0 THEN
    RAISE EXCEPTION 'version_missing_blobs: %', array_to_string(missing, ',');
  END IF;
  RETURN packed_pages;
END;
$$;

-- html_ref pages → full pages (legacy rows with inline html pass through unchanged).
CREATE OR REPLACE FUNCTION public._version_unpack(p_id uuid, p_pages jsonb)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(
           CASE WHEN t.e ? 'html_ref'
                THEN (t.e - 'html_ref') || jsonb_build_object('html', b.html)
                ELSE t.e END
           ORDER BY t.o), '[]'::jsonb)
    FROM jsonb_array_elements(COALESCE(p_pages, '[]'::jsonb)) WITH ORDINALITY AS t(e, o)
    LEFT JOIN page_html_blobs b ON b.project_id = p_id AND b.hash = t.e->>'html_ref'
$$;

-- Delete blobs no version references any more.
CREATE OR REPLACE FUNCTION public._version_gc(p_id uuid)
RETURNS int
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE n int;
BEGIN
  DELETE FROM page_html_blobs b
   WHERE b.project_id = p_id
     AND NOT EXISTS (
       SELECT 1 FROM project_versions v CROSS JOIN LATERAL jsonb_array_elements(v.pages) e
        WHERE v.project_id = p_id AND e->>'html_ref' = b.hash);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- Create a version (+ prune to p_keep + blob GC). Serialized per project via the
-- project row lock, so a concurrent GC can never drop a blob a new version uses.
CREATE OR REPLACE FUNCTION public.version_create(p_id uuid, p_summary text, p_pages jsonb, p_keep int DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  packed jsonb;
  vid uuid;
  vat timestamptz;
BEGIN
  PERFORM 1 FROM projects WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'project % not found or not accessible', p_id; END IF;
  packed := _version_pack(p_id, p_pages);
  INSERT INTO project_versions (project_id, summary, pages)
  VALUES (p_id, COALESCE(p_summary, ''), packed)
  RETURNING id, created_at INTO vid, vat;
  DELETE FROM project_versions
   WHERE project_id = p_id
     AND id NOT IN (SELECT id FROM project_versions WHERE project_id = p_id ORDER BY created_at DESC LIMIT GREATEST(p_keep, 1));
  PERFORM _version_gc(p_id);
  RETURN jsonb_build_object('id', vid, 'created_at', vat);
END;
$$;

-- Full pages of one version (null if not visible / not found).
CREATE OR REPLACE FUNCTION public.version_get(p_version_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT _version_unpack(v.project_id, v.pages) FROM project_versions v WHERE v.id = p_version_id
$$;

-- Stored blob hashes of a project (the builder skips sending html the DB already has).
CREATE OR REPLACE FUNCTION public.version_blob_hashes(p_id uuid)
RETURNS SETOF text
LANGUAGE sql STABLE
SET search_path = public
AS $$ SELECT hash FROM page_html_blobs WHERE project_id = p_id $$;

-- ── Convert existing versions (verified: each unpacks to exactly the old pages) ──
DO $$
DECLARE
  r record;
  orig jsonb;
  packed jsonb;
BEGIN
  FOR r IN SELECT id, project_id, pages FROM project_versions
            WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(pages) e WHERE jsonb_typeof(e->'html') = 'string')
  LOOP
    SELECT COALESCE(jsonb_agg(t.e - 'blocks' ORDER BY t.o), '[]'::jsonb) INTO orig
      FROM jsonb_array_elements(r.pages) WITH ORDINALITY AS t(e, o);
    packed := _version_pack(r.project_id, r.pages);
    IF _version_unpack(r.project_id, packed) IS DISTINCT FROM orig THEN
      RAISE EXCEPTION 'version % does not round-trip — nothing converted', r.id;
    END IF;
    UPDATE project_versions SET pages = packed WHERE id = r.id;
  END LOOP;
END;
$$;

-- ── Snapshot regeneration: write only changed rows ──
ALTER TABLE public.published_snapshots ADD COLUMN IF NOT EXISTS body_hash text;

-- ── Old backups (data verified many times since; the 2026-10-06 one is kept) ──
DROP TABLE IF EXISTS backups.site_config_20260924;
DROP TABLE IF EXISTS backups.site_config_20261001;

-- ── Grants ──
REVOKE ALL ON FUNCTION public._version_pack(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._version_unpack(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._version_gc(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.version_create(uuid, text, jsonb, int) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.version_get(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.version_blob_hashes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._html_hash(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._version_pack(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._version_unpack(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._version_gc(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.version_create(uuid, text, jsonb, int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.version_get(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.version_blob_hashes(uuid) TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.page_html_blobs TO authenticated, service_role;

-- AFTER this script, run SEPARATELY (VACUUM can't run inside a script/transaction):
--   VACUUM FULL public.project_versions, public.projects, public.published_snapshots;
