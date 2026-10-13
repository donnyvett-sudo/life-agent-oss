-- Life Coach: базовая схема этапа 1.
-- Доступ к данным только через Edge Functions (service_role). RLS включён везде,
-- политик для anon/authenticated нет → прямой доступ с клиента закрыт.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- Пользователи ---------------------------------------------------------------
create table public.users (
  id          uuid primary key default gen_random_uuid(),
  tg_id       bigint not null unique,
  first_name  text,
  username    text,
  tz          text not null default 'Asia/Shanghai',
  is_allowed  boolean not null default false,
  is_owner    boolean not null default false,
  settings    jsonb not null default '{
    "schedule": {
      "morning": "07:15",
      "lunch_fallback": "14:30",
      "evening": "22:00",
      "lights_out": "22:45",
      "weekly": "21:00",
      "weekly_dow": 0
    },
    "sleep": { "bed": "23:00", "wake": "07:00" },
    "coach": { "frequency": "normal" }
  }'::jsonb,
  state       jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger users_updated_at before update on public.users
  for each row execute function public.set_updated_at();

-- Добавки --------------------------------------------------------------------
create table public.supplements (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users(id) on delete cascade,
  name              text not null,
  slot              text not null check (slot in ('morning', 'lunch', 'evening')),
  units_per_intake  numeric(6,2) not null default 1 check (units_per_intake > 0),
  units_per_pack    integer check (units_per_pack > 0),
  units_left        numeric(8,2),
  low_stock_warned  boolean not null default false,
  active            boolean not null default true,
  sort              integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index supplements_user_idx on public.supplements (user_id);
create trigger supplements_updated_at before update on public.supplements
  for each row execute function public.set_updated_at();

create table public.supplement_logs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users(id) on delete cascade,
  supplement_id  uuid not null references public.supplements(id) on delete cascade,
  local_date     date not null,
  status         text not null check (status in ('taken', 'skipped')),
  created_at     timestamptz not null default now(),
  unique (supplement_id, local_date)
);
create index supplement_logs_user_date_idx on public.supplement_logs (user_id, local_date);

-- Напоминания и инициативные сообщения (идемпотентность по user/kind/date) --
create table public.reminders (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users(id) on delete cascade,
  kind           text not null,
  local_date     date not null,
  status         text not null default 'pending'
                   check (status in ('pending', 'done', 'skipped', 'expired')),
  attempts       integer not null default 0,
  next_at        timestamptz,
  tg_message_id  bigint,
  payload        jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id, kind, local_date)
);
create index reminders_due_idx on public.reminders (next_at) where status = 'pending';
create trigger reminders_updated_at before update on public.reminders
  for each row execute function public.set_updated_at();

-- Траты (минимум для этапа 1; расширяется на этапе 2) -----------------------
create table public.transactions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  kind         text not null default 'expense' check (kind in ('expense', 'income')),
  amount       numeric(14,2) not null check (amount > 0),
  currency     text not null default 'CNY',
  category     text,
  note         text,
  raw_text     text,
  source       text not null default 'bot',
  occurred_at  timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
create index transactions_user_time_idx on public.transactions (user_id, occurred_at desc);

-- Сон ------------------------------------------------------------------------
create table public.sleep_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  night_date   date not null, -- локальная дата пробуждения
  bed_at       timestamptz,
  wake_at      timestamptz,
  asleep_min   integer,
  in_bed_min   integer,
  deep_min     integer,
  rem_min      integer,
  core_min     integer,
  awake_min    integer,
  source       text not null default 'shortcuts',
  raw          jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, night_date)
);
create trigger sleep_sessions_updated_at before update on public.sleep_sessions
  for each row execute function public.set_updated_at();

-- Чат с коучем ---------------------------------------------------------------
create table public.messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  role        text not null check (role in ('user', 'coach')),
  text        text not null,
  created_at  timestamptz not null default now()
);
create index messages_user_time_idx on public.messages (user_id, created_at desc);

-- Наказания / награды --------------------------------------------------------
create table public.coach_ledger (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  kind         text not null check (kind in ('penalty', 'reward')),
  code         text not null,
  title        text not null,
  reason       text,
  status       text not null default 'open' check (status in ('open', 'done', 'used', 'expired')),
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);
create index coach_ledger_user_idx on public.coach_ledger (user_id, status);

-- RLS: включён везде, клиентского доступа нет ------------------------------
do $$
declare t text;
begin
  foreach t in array array['users','supplements','supplement_logs','reminders',
                           'transactions','sleep_sessions','messages','coach_ledger']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Секрет для pg_cron → scheduler (живёт только в Vault) ---------------------
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'cron_secret',
                           'auth for pg_cron -> scheduler edge function');

create or replace function public.get_cron_secret()
returns text language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'
$$;
revoke execute on function public.get_cron_secret() from public, anon, authenticated;
grant execute on function public.get_cron_secret() to service_role;
