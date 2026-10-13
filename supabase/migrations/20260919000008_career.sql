-- Этап 4: карьера. Проекты, вехи, активность на GitHub.

create table public.projects (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  title        text not null,
  goal         text,                            -- зачем он нужен, одной строкой
  status       text not null default 'active' check (status in ('idea', 'active', 'paused', 'done')),
  repo         text,                            -- «owner/name» на GitHub, если он есть
  due_date     date,
  sort         integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index projects_user_idx on public.projects (user_id, status, sort);
create trigger projects_updated_at before update on public.projects
  for each row execute function public.set_updated_at();

-- Вехи ставятся руками: у проекта нет преподавателя, который назначит дедлайн.
create table public.milestones (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  project_id   uuid not null references public.projects(id) on delete cascade,
  title        text not null,
  due_date     date,
  status       text not null default 'todo' check (status in ('todo', 'done')),
  done_at      timestamptz,
  sort         integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index milestones_user_due_idx on public.milestones (user_id, status, due_date);
create trigger milestones_updated_at before update on public.milestones
  for each row execute function public.set_updated_at();

-- Граф контрибуций с GitHub, по дню. Приватные репозитории тоже считаются.
create table public.github_days (
  user_id        uuid not null references public.users(id) on delete cascade,
  date           date not null,
  contributions  integer not null default 0,
  synced_at      timestamptz not null default now(),
  primary key (user_id, date)
);

do $$
declare t text;
begin
  foreach t in array array['projects','milestones','github_days']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
