-- Related posts: per-article manual picks (ordered list of blog_post ids).
-- When empty, the serve layer falls back to automatic selection by category.
ALTER TABLE blog_posts
  ADD COLUMN IF NOT EXISTS related_post_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
