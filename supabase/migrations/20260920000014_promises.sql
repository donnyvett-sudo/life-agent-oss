-- Обещания друзьям: кто, кому, что, до какого дня и как проверяем.
create table public.promises (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  to_user_id  uuid not null references public.users(id) on delete cascade,
  title       text not null,
  check_kind  text not null default 'friend' check (check_kind in ('photo', 'sleep', 'friend')),
  due_date    date not null,
  status      text not null default 'open' check (status in ('open', 'kept', 'broken', 'cancelled')),
  proof_file_id text,
  proof_at    timestamptz,
  penalty     text,
  penalty_id  uuid references public.coach_ledger(id) on delete set null,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  check (user_id <> to_user_id)
);

create index promises_user_idx on public.promises (user_id, status, due_date);
create index promises_to_idx on public.promises (to_user_id, status);

alter table public.promises enable row level security;
revoke all on public.promises from anon, authenticated;
