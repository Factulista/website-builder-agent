-- Add author column to blog_posts
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS author text NOT NULL DEFAULT '';
