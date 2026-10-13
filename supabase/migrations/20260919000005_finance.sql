-- Этап 2: финансы. Счета, категории, переводы, курсы, правила автокатегорий.

create table public.accounts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users(id) on delete cascade,
  title            text not null,
  currency         text not null check (currency in ('CNY', 'KZT', 'USD')),
  opening_balance  numeric(14,2) not null default 0,
  is_default       boolean not null default false,  -- счёт по умолчанию для своей валюты
  in_total         boolean not null default true,   -- учитывать в общем балансе
  is_archived      boolean not null default false,
  sort             integer not null default 0,
  external_id      text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (user_id, external_id)
);
create index accounts_user_idx on public.accounts (user_id);
create trigger accounts_updated_at before update on public.accounts
  for each row execute function public.set_updated_at();

create table public.categories (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  kind         text not null check (kind in ('expense', 'income')),
  code         text,          -- встроенный ключ для словаря (cafe, transport, …)
  title        text not null,
  sort         integer not null default 0,
  is_archived  boolean not null default false,
  external_id  text,
  created_at   timestamptz not null default now(),
  unique (user_id, external_id),
  unique (user_id, kind, code)
);
create index categories_user_idx on public.categories (user_id);

-- Выученные соответствия «описание → категория» (из истории и из исправлений).
create table public.category_rules (
  user_id      uuid not null references public.users(id) on delete cascade,
  keyword      text not null,
  kind         text not null check (kind in ('expense', 'income')),
  category_id  uuid not null references public.categories(id) on delete cascade,
  hits         integer not null default 1,
  updated_at   timestamptz not null default now(),
  primary key (user_id, kind, keyword)
);

alter table public.transactions
  add column account_id      uuid references public.accounts(id) on delete set null,
  add column category_id     uuid references public.categories(id) on delete set null,
  add column amount_account  numeric(14,2),   -- в валюте счёта
  add column amount_cny      numeric(14,2),   -- в юанях по курсу дня операции
  add column external_id     text,
  add constraint transactions_user_external_key unique (user_id, external_id);
create index transactions_account_idx on public.transactions (account_id);
create index transactions_category_idx on public.transactions (category_id);

create table public.transfers (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users(id) on delete cascade,
  from_account_id  uuid not null references public.accounts(id) on delete cascade,
  to_account_id    uuid not null references public.accounts(id) on delete cascade,
  from_amount      numeric(14,2) not null check (from_amount > 0),
  to_amount        numeric(14,2) not null check (to_amount > 0),
  note             text,
  occurred_at      timestamptz not null default now(),
  external_id      text,
  created_at       timestamptz not null default now(),
  unique (user_id, external_id),
  check (from_account_id <> to_account_id)
);
create index transfers_user_time_idx on public.transfers (user_id, occurred_at desc);

-- Курсы: справочник, общий для всех (не личные данные). per_usd — сколько единиц валюты за 1 USD.
create table public.fx_rates (
  date      date not null,
  currency  text not null,
  per_usd   numeric(18,8) not null check (per_usd > 0),
  primary key (date, currency)
);

do $$
declare t text;
begin
  foreach t in array array['accounts','categories','category_rules','transfers','fx_rates']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Баланс счетов в их валюте.
create or replace function public.account_balances(p_user uuid)
returns table (account_id uuid, balance numeric)
language sql stable security definer set search_path = '' as $$
  select a.id,
         a.opening_balance
         + coalesce((select sum(case t.kind when 'income' then t.amount_account else -t.amount_account end)
                       from public.transactions t where t.account_id = a.id), 0)
         - coalesce((select sum(f.from_amount) from public.transfers f where f.from_account_id = a.id), 0)
         + coalesce((select sum(f.to_amount) from public.transfers f where f.to_account_id = a.id), 0)
  from public.accounts a
  where a.user_id = p_user
$$;
revoke execute on function public.account_balances(uuid) from public, anon, authenticated;
grant execute on function public.account_balances(uuid) to service_role;
