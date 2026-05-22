-- Table for dynamically generated templates (from user-provided inspiration URLs + screenshots)
CREATE TABLE IF NOT EXISTS public.templates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL DEFAULT '',
  sector text NOT NULL DEFAULT '',
  keywords text[] NOT NULL DEFAULT '{}',
  html text NOT NULL DEFAULT '',
  source_url text,
  created_at timestamptz DEFAULT now()
);

-- Index for keyword search
CREATE INDEX IF NOT EXISTS templates_sector_idx ON public.templates(sector);
CREATE INDEX IF NOT EXISTS templates_keywords_idx ON public.templates USING gin(keywords);

-- RLS: readable by all authenticated users, writable only via service role
ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Templates are readable by authenticated users"
  ON public.templates FOR SELECT
  TO authenticated
  USING (true);
