-- Еда: приёмы пищи (фото или текст → КБЖУ) и личный словарь блюд.
-- Фото не храним: только file_id Telegram. Суммы дня считаем по этим строкам.
create table public.meal_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  local_date  date not null,
  eaten_at    timestamptz not null default now(),
  title       text not null,
  -- [{name, grams, kcal, p, f, c}]
  items       jsonb not null default '[]'::jsonb,
  kcal        integer not null check (kcal >= 0 and kcal <= 20000),
  protein     numeric(6,1) not null default 0 check (protein >= 0 and protein <= 1500),
  fat         numeric(6,1) not null default 0 check (fat >= 0 and fat <= 1500),
  carbs       numeric(6,1) not null default 0 check (carbs >= 0 and carbs <= 3000),
  confidence  numeric(3,2) check (confidence >= 0 and confidence <= 1),
  source      text not null default 'photo' check (source in ('photo', 'text', 'dish', 'manual')),
  status      text not null default 'pending' check (status in ('pending', 'confirmed')),
  corrected   boolean not null default false,
  tg_file_id  text,
  updated_at  timestamptz not null default now()
);
create index meal_logs_user_day_idx on public.meal_logs (user_id, local_date desc, eaten_at);
create trigger meal_logs_updated_at before update on public.meal_logs
  for each row execute function public.set_updated_at();
alter table public.meal_logs enable row level security;
revoke all on public.meal_logs from anon, authenticated;

-- Личный словарь: подтверждённые блюда. Идут в промпт как эталоны порций и
-- отвечают на повторяющиеся блюда без обращения к Gemini.
create table public.dishes (
  user_id    uuid not null references public.users(id) on delete cascade,
  name_norm  text not null,
  name       text not null,
  grams      integer not null check (grams > 0 and grams <= 5000),
  kcal       integer not null check (kcal >= 0 and kcal <= 20000),
  protein    numeric(6,1) not null default 0,
  fat        numeric(6,1) not null default 0,
  carbs      numeric(6,1) not null default 0,
  uses       integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key (user_id, name_norm)
);
create trigger dishes_updated_at before update on public.dishes
  for each row execute function public.set_updated_at();
alter table public.dishes enable row level security;
revoke all on public.dishes from anon, authenticated;
