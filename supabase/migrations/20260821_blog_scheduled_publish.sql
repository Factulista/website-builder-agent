-- Scheduled blog post publication.
-- Adds a 'scheduled' status + go-live day (date only, no time — the cron that
-- flips scheduled → published runs once a day).
--
-- IMPORTANT: `scheduled_at` (go-live day) is intentionally separate from
-- `published_at` (the editorial/SEO date shown to readers and Google, chosen
-- by the user in the builder sidebar). The publish flow must NEVER overwrite
-- published_at based on scheduled_at — see app/api/blog-posts/[postId]/route.ts.

ALTER TABLE blog_posts DROP CONSTRAINT IF EXISTS blog_posts_status_check;
ALTER TABLE blog_posts ADD CONSTRAINT blog_posts_status_check
  CHECK (status IN ('draft', 'published', 'scheduled'));

ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS scheduled_at date;

-- Partial index: the daily cron scans only scheduled posts, across all projects.
CREATE INDEX IF NOT EXISTS blog_posts_scheduled_idx
  ON blog_posts (scheduled_at) WHERE status = 'scheduled';
