-- Social module — account-level (per user_id), standalone-ready.
-- Tokens are stored ENCRYPTED and these tables are accessed ONLY server-side
-- via the service role. RLS is enabled with NO public policies, so the browser
-- (anon/authenticated) can never read tokens. All access goes through /api/social/*.

create table if not exists public.social_connections (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  provider        text not null,               -- 'facebook' | 'instagram' | 'linkedin'
  external_id     text not null,               -- page id / ig business id / linkedin person urn
  account_name    text,                         -- human label (page name, @handle, full name)
  access_token    text not null,               -- ENCRYPTED
  refresh_token   text,                         -- ENCRYPTED (nullable)
  token_expires_at timestamptz,
  scopes          text,
  meta            jsonb not null default '{}'::jsonb,  -- extra: { ig_account_id, picture, ... }
  status          text not null default 'active',      -- active | expired
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (user_id, provider, external_id)
);

create index if not exists idx_social_connections_user on public.social_connections(user_id);

create table if not exists public.social_posts (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  source_type       text not null default 'manual',  -- blog | page | manual | external
  source_project_id uuid,                              -- optional link to a builder project
  source_ref        text,                              -- blog post id / page slug / external url
  content           jsonb not null default '{}'::jsonb, -- { text, media_urls[], link }
  -- target connection ids the post should publish to
  connection_ids    uuid[] not null default '{}',
  status            text not null default 'draft',     -- draft|scheduled|publishing|published|failed|partial
  scheduled_at      timestamptz,
  -- per-connection result: { "<conn_id>": { externalId, url, status, error } }
  results           jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_social_posts_user on public.social_posts(user_id);
create index if not exists idx_social_posts_scheduled on public.social_posts(status, scheduled_at);

-- Lock down: RLS on, no public policies → only service_role (server) can touch these.
alter table public.social_connections enable row level security;
alter table public.social_posts      enable row level security;
