-- Лимиты трат на месяц: общий (category_id is null) и по категориям.
create table public.budgets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  category_id uuid references public.categories(id) on delete cascade,
  amount      numeric(12,2) not null check (amount > 0),
  currency    text not null,
  created_at  timestamptz not null default now(),
  -- Один лимит на категорию; nulls not distinct — чтобы общий лимит тоже был один.
  unique nulls not distinct (user_id, category_id)
);
create index budgets_user_idx on public.budgets (user_id);
alter table public.budgets enable row level security;
revoke all on public.budgets from anon, authenticated;
