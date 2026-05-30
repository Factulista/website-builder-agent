-- Project version history — moved OUT of projects.site_config.
--
-- Why: versions used to live inside the projects.site_config JSONB blob, each
-- carrying a FULL copy of every page's HTML. With ~30 versions that blob reached
-- ~15MB, and buildSiteConfig read + rewrote the ENTIRE blob on every single save
-- (every chat message, every 800ms inline-edit autosave, every component insert).
-- That read/write amplification was burning the project's Supabase Disk IO budget
-- and causing large writes to time out (silently dropping chat messages).
--
-- Now each version is an append-only row here. The hot path (saveState) writes a
-- small site_config; version snapshots are written once and only read on restore.
--
-- Run this in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS project_versions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  summary     text NOT NULL DEFAULT '',
  pages       jsonb NOT NULL DEFAULT '[]',   -- full Page[] snapshot for restore
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Fast "latest versions for this project" lookups (used by the history panel).
CREATE INDEX IF NOT EXISTS project_versions_project_idx
  ON project_versions (project_id, created_at DESC);

-- RLS: a user may touch versions only for projects they own.
ALTER TABLE project_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_versions_owner_all ON project_versions;
CREATE POLICY project_versions_owner_all ON project_versions
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = project_versions.project_id
        AND p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = project_versions.project_id
        AND p.user_id = auth.uid()
    )
  );

-- Service role (API routes with SUPABASE_SERVICE_ROLE_KEY) bypasses RLS anyway,
-- but keep an explicit policy for clarity/consistency with other tables.
DROP POLICY IF EXISTS project_versions_service_all ON project_versions;
CREATE POLICY project_versions_service_all ON project_versions
  FOR ALL USING (auth.role() = 'service_role');

-- ── Prune helper: keep only the N most-recent versions for a project ───────────
-- Called (fire-and-forget) after each new version insert so the table doesn't grow
-- unbounded. security definer + explicit ownership check so it's safe to call with
-- the anon key from the client.
CREATE OR REPLACE FUNCTION prune_project_versions(
  p_project_id uuid,
  p_keep int DEFAULT 30
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Only the project owner (or service role) may prune.
  IF NOT (
    auth.role() = 'service_role'
    OR EXISTS (SELECT 1 FROM projects p WHERE p.id = p_project_id AND p.user_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  DELETE FROM project_versions
  WHERE project_id = p_project_id
    AND id NOT IN (
      SELECT id FROM project_versions
      WHERE project_id = p_project_id
      ORDER BY created_at DESC
      LIMIT p_keep
    );
END;
$$;

-- ── One-time backfill: lift existing versions out of site_config into rows ──────
-- Copies each project's site_config.versions[] into project_versions, preserving
-- summary + timestamp + pages. Idempotent-ish: only runs for projects that have
-- versions in their config and no rows yet in project_versions.
INSERT INTO project_versions (project_id, summary, pages, created_at)
SELECT
  p.id,
  COALESCE(v->>'summary', ''),
  COALESCE(v->'pages', '[]'::jsonb),
  COALESCE((v->>'timestamp')::timestamptz, now())
FROM projects p
CROSS JOIN LATERAL jsonb_array_elements(
  CASE
    WHEN jsonb_typeof(p.site_config->'versions') = 'array'
    THEN p.site_config->'versions'
    ELSE '[]'::jsonb
  END
) AS v
WHERE NOT EXISTS (
  SELECT 1 FROM project_versions pv WHERE pv.project_id = p.id
);

-- ── One-time cleanup: strip the now-duplicated versions array from site_config ──
-- This is what actually frees the Disk IO — site_config stops carrying 30× HTML.
UPDATE projects
SET site_config = site_config - 'versions'
WHERE site_config ? 'versions';
