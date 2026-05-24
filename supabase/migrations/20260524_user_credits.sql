-- User credits system
-- Each user has a wallet of tokens. LLM endpoints deduct from the balance.
-- Stripe top-ups (added later) credit the balance via webhook.

create table if not exists user_credits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance_tokens bigint not null default 0,
  total_purchased bigint not null default 0,
  total_consumed bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  delta bigint not null,                  -- negative = consume, positive = top-up
  reason text not null,                   -- 'chat' | 'seo-fix' | 'image-meta' | 'stripe-topup' | 'signup-bonus'
  project_id uuid,
  metadata jsonb,                         -- { model, input_tokens, output_tokens, stripe_session_id }
  balance_after bigint not null,
  created_at timestamptz not null default now()
);

create index if not exists credit_transactions_user_idx on credit_transactions(user_id, created_at desc);

-- Idempotency for Stripe webhooks
create table if not exists stripe_events (
  id text primary key,
  processed_at timestamptz not null default now()
);

-- RLS: users read only their own
alter table user_credits enable row level security;
alter table credit_transactions enable row level security;

drop policy if exists user_credits_select_own on user_credits;
create policy user_credits_select_own on user_credits
  for select using (auth.uid() = user_id);

drop policy if exists credit_transactions_select_own on credit_transactions;
create policy credit_transactions_select_own on credit_transactions
  for select using (auth.uid() = user_id);

-- Atomic consume RPC: deducts tokens iff balance is sufficient.
-- Returns the new balance, or -1 if insufficient.
create or replace function consume_credits(
  p_user_id uuid,
  p_tokens bigint,
  p_reason text,
  p_project_id uuid default null,
  p_metadata jsonb default null
) returns bigint
language plpgsql
security definer
as $$
declare
  v_balance bigint;
begin
  if p_tokens <= 0 then
    raise exception 'tokens must be > 0';
  end if;

  -- Ensure wallet exists
  insert into user_credits (user_id) values (p_user_id)
    on conflict (user_id) do nothing;

  -- Atomic check-and-update with row lock
  update user_credits
    set balance_tokens = balance_tokens - p_tokens,
        total_consumed = total_consumed + p_tokens,
        updated_at = now()
    where user_id = p_user_id
      and balance_tokens >= p_tokens
    returning balance_tokens into v_balance;

  if v_balance is null then
    return -1;  -- insufficient funds
  end if;

  insert into credit_transactions (user_id, delta, reason, project_id, metadata, balance_after)
    values (p_user_id, -p_tokens, p_reason, p_project_id, p_metadata, v_balance);

  return v_balance;
end;
$$;

-- Atomic top-up RPC
create or replace function topup_credits(
  p_user_id uuid,
  p_tokens bigint,
  p_reason text,
  p_metadata jsonb default null
) returns bigint
language plpgsql
security definer
as $$
declare
  v_balance bigint;
begin
  if p_tokens <= 0 then
    raise exception 'tokens must be > 0';
  end if;

  insert into user_credits (user_id, balance_tokens, total_purchased)
    values (p_user_id, p_tokens, case when p_reason = 'signup-bonus' then 0 else p_tokens end)
    on conflict (user_id) do update
      set balance_tokens = user_credits.balance_tokens + p_tokens,
          total_purchased = user_credits.total_purchased + case when p_reason = 'signup-bonus' then 0 else p_tokens end,
          updated_at = now()
    returning balance_tokens into v_balance;

  insert into credit_transactions (user_id, delta, reason, metadata, balance_after)
    values (p_user_id, p_tokens, p_reason, p_metadata, v_balance);

  return v_balance;
end;
$$;

-- Trigger: give every new user 50k token signup bonus
create or replace function on_auth_user_created_grant_credits()
returns trigger
language plpgsql
security definer
as $$
begin
  perform topup_credits(new.id, 50000, 'signup-bonus', null);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_grant_credits_trg on auth.users;
create trigger on_auth_user_created_grant_credits_trg
  after insert on auth.users
  for each row execute function on_auth_user_created_grant_credits();

-- Backfill existing users
insert into user_credits (user_id, balance_tokens)
  select id, 50000 from auth.users
  where id not in (select user_id from user_credits)
on conflict (user_id) do nothing;
