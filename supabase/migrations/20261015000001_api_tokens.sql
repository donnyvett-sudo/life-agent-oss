-- Personal API tokens with a scope, a label and revocation. Only a SHA-256 of the token is stored.
-- Additive: users.ingest_token stays and keeps working (old Shortcuts, life_sync.py, Life Desk).
-- Rollback: drop table public.api_tokens, public.auth_failures;

create table public.api_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  hash         text not null unique,                    -- sha256 of the token, hex
  label        text not null,
  scopes       text[] not null default '{*}',           -- '*', 'app', 'study', 'ingest'
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz,
  unique (user_id, label)
);
create index api_tokens_user_idx on public.api_tokens (user_id);

-- Failed attempts per (salted, hashed) address: 20 in 10 minutes means 429.
create table public.auth_failures (
  ip_hash text not null,
  at      timestamptz not null default now()
);
create index auth_failures_idx on public.auth_failures (ip_hash, at);

alter table public.api_tokens enable row level security;
alter table public.auth_failures enable row level security;
revoke all on public.api_tokens from anon, authenticated;
revoke all on public.auth_failures from anon, authenticated;

-- Existing personal tokens become the first rows ("legacy", every scope).
insert into public.api_tokens (user_id, hash, label, scopes)
select id, encode(extensions.digest(ingest_token, 'sha256'), 'hex'), 'legacy', '{*}'
from public.users
where ingest_token is not null
on conflict do nothing;
