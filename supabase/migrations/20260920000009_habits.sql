-- Этап 5: образ жизни. Привычки, спорт и звонки родным — одной таблицей.

-- kind задаёт, как считать норму:
--   daily    — каждый день;
--   weekly   — target раз в неделю, в какие дни неважно;
--   interval — не реже чем раз в target дней (звонки родным).
-- is_hard — попадает в воскресный разбор со штрафом. Мягкие просто показываются.
create table public.habits (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  title        text not null,
  kind         text not null default 'daily' check (kind in ('daily', 'weekly', 'interval')),
  target       integer not null default 1 check (target between 1 and 30),
  days         smallint[],                      -- для daily: только эти дни недели (0 = вс), null = все
  note         text,                            -- «маме», «45 минут», что угодно
  is_hard      boolean not null default false,
  active       boolean not null default true,
  sort         integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index habits_user_idx on public.habits (user_id, active, sort);
create trigger habits_updated_at before update on public.habits
  for each row execute function public.set_updated_at();

-- Одна отметка на привычку в день: повторное нажатие снимает её, а не плодит строки.
create table public.habit_logs (
  user_id      uuid not null references public.users(id) on delete cascade,
  habit_id     uuid not null references public.habits(id) on delete cascade,
  local_date   date not null,
  amount       integer not null default 1,      -- минуты спорта и прочее, если захочется
  note         text,
  created_at   timestamptz not null default now(),
  primary key (habit_id, local_date)
);
create index habit_logs_user_date_idx on public.habit_logs (user_id, local_date);

do $$
declare t text;
begin
  foreach t in array array['habits','habit_logs']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
