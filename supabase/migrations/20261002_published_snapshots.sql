-- Point 1 of the Oct 2026 Supabase load plan — static publishing, free variant.
-- Final rendered html of every published page, one row per (project, host, path), plus a
-- routing manifest row (path '__manifest': page list + redirects). Written at publish /
-- on changes by lib/published-snapshots.ts, read by servePublished — so public page
-- requests no longer decompress the whole site_config.
-- Service role only (RLS on, no policies): the anon/authenticated API roles can't read it.
-- Rollback / kill switch: DELETE FROM published_snapshots (serving falls back to live render).

CREATE TABLE IF NOT EXISTS public.published_snapshots (
  project_slug text NOT NULL,
  host         text NOT NULL,
  path         text NOT NULL,
  project_id   uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  status       int  NOT NULL DEFAULT 200,
  content_type text NOT NULL DEFAULT 'text/html; charset=utf-8',
  body         text NOT NULL,
  rendered_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_slug, host, path)
);

CREATE INDEX IF NOT EXISTS published_snapshots_project_idx ON public.published_snapshots (project_id);

ALTER TABLE public.published_snapshots ENABLE ROW LEVEL SECURITY;
