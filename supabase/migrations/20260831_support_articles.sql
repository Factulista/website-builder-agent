-- Support/help center articles ("Ayuda") for Factulista.
-- Mirrors blog_posts closely (same status lifecycle, same scheduling model), with two
-- differences: `category` is a SINGLE text field (not an array) because the URL is
-- ayuda/{categoria}/{slug} — every article belongs to exactly one category, used both
-- for the URL and for the category tiles on the Ayuda hub page — and a generated
-- `search_vector` column backs the full-text search bar on that hub page.
--
-- Uses the 'simple' text search config (no stemming) rather than a fixed language —
-- this platform is multi-tenant/multi-language, so we can't hardcode e.g. 'spanish'
-- in a STORED generated column. 'simple' still gives real word-based matching, just
-- without language-specific stemming (searching "facturas" won't also match "factura").

CREATE TABLE IF NOT EXISTS support_articles (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title                text NOT NULL DEFAULT '',
  slug                 text NOT NULL DEFAULT '',
  content_html         text NOT NULL DEFAULT '',
  excerpt              text NOT NULL DEFAULT '',
  category             text NOT NULL DEFAULT '',
  tags                 text[] NOT NULL DEFAULT '{}',
  status               text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'scheduled')),
  published_at         timestamptz,
  scheduled_at         date,
  seo_title            text,
  seo_description      text,
  author               text NOT NULL DEFAULT '',
  related_article_ids  jsonb NOT NULL DEFAULT '[]'::jsonb,
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('simple',
      coalesce(title, '') || ' ' ||
      coalesce(excerpt, '') || ' ' ||
      coalesce(category, '') || ' ' ||
      regexp_replace(coalesce(content_html, ''), '<[^>]+>', ' ', 'g')
    )
  ) STORED,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, slug)
);

CREATE INDEX IF NOT EXISTS support_articles_project_id_idx    ON support_articles (project_id);
CREATE INDEX IF NOT EXISTS support_articles_status_idx        ON support_articles (project_id, status);
CREATE INDEX IF NOT EXISTS support_articles_category_idx      ON support_articles (project_id, category);
CREATE INDEX IF NOT EXISTS support_articles_scheduled_idx     ON support_articles (scheduled_at) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS support_articles_search_idx        ON support_articles USING GIN (search_vector);

ALTER TABLE support_articles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON support_articles
  FOR ALL USING (auth.role() = 'service_role');
