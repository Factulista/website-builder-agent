-- Support/help center articles ("Ayuda") for Factulista.
-- Mirrors blog_posts closely (same status lifecycle, same scheduling model), with two
-- differences: `category` is a SINGLE text field (not an array) because the URL is
-- ayuda/{categoria}/{slug} — every article belongs to exactly one category, used both
-- for the URL and for the category tiles on the Ayuda hub page — and a generated
-- `search_vector` column backs the full-text search bar on that hub page.

-- Accent-insensitive normalization for search, without depending on the `unaccent`
-- extension (which needs to be enabled separately and isn't always available on every
-- Supabase plan/role). Folds the common Spanish/Romance-language accented characters to
-- their plain equivalents. IMMUTABLE is required so this can be used inside a STORED
-- generated column. translate() tolerates length mismatches between the two arguments
-- gracefully (extra source chars are just dropped), so this degrades safely even if a
-- pair is ever miscounted.
CREATE OR REPLACE FUNCTION support_search_normalize(input text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT translate(
    coalesce(input, ''),
    'áéíóúñüÁÉÍÓÚÑÜàèìòùÀÈÌÒÙâêîôûÂÊÎÔÛäëïöÄËÏÖ',
    'aeiounuAEIOUNUaeiouAEIOUaeiouAEIOUaeioAEIO'
  );
$$;

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
    to_tsvector('simple', support_search_normalize(
      coalesce(title, '') || ' ' ||
      coalesce(excerpt, '') || ' ' ||
      coalesce(category, '') || ' ' ||
      regexp_replace(coalesce(content_html, ''), '<[^>]+>', ' ', 'g')
    ))
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

-- Ranked full-text search, used by /api/support-articles/search. Returns published
-- articles ordered by relevance (ts_rank), not insertion order. Same normalization
-- function as the generated column, applied to the query, so accents fold on both sides
-- symmetrically ("facturacion" matches stored "facturación").
CREATE OR REPLACE FUNCTION search_support_articles(
  p_project_id uuid,
  p_query text,
  p_category text DEFAULT NULL,
  p_limit int DEFAULT 20
)
RETURNS TABLE (id uuid, title text, slug text, excerpt text, category text, rank real)
LANGUAGE sql STABLE AS $$
  SELECT
    sa.id, sa.title, sa.slug, sa.excerpt, sa.category,
    ts_rank(sa.search_vector, websearch_to_tsquery('simple', support_search_normalize(p_query))) AS rank
  FROM support_articles sa
  WHERE sa.project_id = p_project_id
    AND sa.status = 'published'
    AND (p_category IS NULL OR sa.category = p_category)
    AND sa.search_vector @@ websearch_to_tsquery('simple', support_search_normalize(p_query))
  ORDER BY rank DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION search_support_articles(uuid, text, text, int) TO authenticated, anon, service_role;
