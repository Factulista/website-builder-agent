-- Blog posts table for Factulista
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS blog_posts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title        text NOT NULL DEFAULT '',
  slug         text NOT NULL DEFAULT '',
  content_html text NOT NULL DEFAULT '',
  excerpt      text NOT NULL DEFAULT '',
  featured_image text,
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_at timestamptz,
  categories   text[] NOT NULL DEFAULT '{}',
  tags         text[] NOT NULL DEFAULT '{}',
  seo_title    text,
  seo_description text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, slug)
);

-- Index for fast lookup by project
CREATE INDEX IF NOT EXISTS blog_posts_project_id_idx ON blog_posts (project_id);
CREATE INDEX IF NOT EXISTS blog_posts_status_idx      ON blog_posts (project_id, status);
CREATE INDEX IF NOT EXISTS blog_posts_published_at_idx ON blog_posts (project_id, published_at DESC);

-- RLS
ALTER TABLE blog_posts ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS (used by API routes with SUPABASE_SERVICE_ROLE_KEY)
CREATE POLICY "service_role_all" ON blog_posts
  FOR ALL USING (auth.role() = 'service_role');
