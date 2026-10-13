-- Тело по дням: шаги, вес и пульс покоя из «Здоровья».
-- Одна строка на день: утренняя команда присылает вчерашний день заново, пока
-- часы досинхронизируются, поэтому пишем через upsert, а не добавляем строки.
-- Любое поле может быть пустым: вес меряют не каждый день, пульс покоя часы
-- считают не всегда.
create table public.body_days (
  user_id    uuid not null references public.users(id) on delete cascade,
  local_date date not null,
  steps      integer check (steps >= 0 and steps <= 200000),
  weight_kg  numeric(5,2) check (weight_kg > 20 and weight_kg < 400),
  resting_hr integer check (resting_hr > 20 and resting_hr < 200),
  source     text not null default 'shortcuts',
  updated_at timestamptz not null default now(),
  primary key (user_id, local_date)
);
create index body_days_user_idx on public.body_days (user_id, local_date desc);
create trigger body_days_updated_at before update on public.body_days
  for each row execute function public.set_updated_at();
alter table public.body_days enable row level security;
revoke all on public.body_days from anon, authenticated;
