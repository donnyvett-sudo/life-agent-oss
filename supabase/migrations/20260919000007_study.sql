-- Этап 3: учёба. Курсы, задания, экзамены, пары, фокус-сессии, карточки.

create table public.courses (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  code         text not null,                   -- short code of the course, e.g. math, cs
  title        text not null,
  short        text not null,                   -- короткое имя для списков
  ai_policy    text not null default 'none' check (ai_policy in ('none', 'banned', 'own_work')),
  sort         integer not null default 0,
  is_archived  boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (user_id, code)
);

create table public.assignments (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  course_id    uuid references public.courses(id) on delete set null,
  title        text not null,
  details      text,
  due_date     date,
  due_note     text,                            -- «в классе пн или ср», если точной даты нет
  status       text not null default 'todo' check (status in ('todo', 'done')),
  done_at      timestamptz,
  source       text not null default 'app',
  external_id  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, external_id)
);
create index assignments_user_due_idx on public.assignments (user_id, status, due_date);
create trigger assignments_updated_at before update on public.assignments
  for each row execute function public.set_updated_at();

create table public.exams (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  course_id     uuid references public.courses(id) on delete set null,
  kind          text not null default 'other' check (kind in ('quiz', 'final', 'presentation', 'other')),
  title         text not null,
  topic         text,
  date          date,                           -- точная дата или начало диапазона
  date_to       date,                           -- конец диапазона для ориентировочных
  is_tentative  boolean not null default false,
  notes         text,
  source        text not null default 'app',
  external_id   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, external_id)
);
create index exams_user_date_idx on public.exams (user_id, date);
create trigger exams_updated_at before update on public.exams
  for each row execute function public.set_updated_at();

-- Сетка плавает от недели к неделе, поэтому храним конкретные занятия с датой, а не правила.
create table public.class_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  course_id    uuid references public.courses(id) on delete set null,
  kind         text not null default 'lecture' check (kind in ('lecture', 'lab', 'other')),
  title        text,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  room         text,
  source       text not null default 'app',
  external_id  text,
  created_at   timestamptz not null default now(),
  unique (user_id, external_id)
);
create index class_sessions_user_time_idx on public.class_sessions (user_id, starts_at);

create table public.focus_sessions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users(id) on delete cascade,
  course_id      uuid references public.courses(id) on delete set null,
  planned_min    integer not null check (planned_min between 5 and 180),
  started_at     timestamptz not null default now(),
  ended_at       timestamptz,
  minutes        integer,
  status         text not null default 'running' check (status in ('running', 'done', 'stopped')),
  tg_message_id  bigint
);
create index focus_sessions_running_idx on public.focus_sessions (status) where status = 'running';
create index focus_sessions_user_idx on public.focus_sessions (user_id, started_at desc);

create table public.flashcards (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  deck         text not null default 'chinese1',
  front        text not null,                   -- ханзи
  reading      text,                            -- пиньинь
  meaning      text not null,
  example      text,
  lesson       text,
  box          integer not null default 1 check (box between 1 and 5),
  next_review  date not null default current_date,
  external_id  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, external_id)
);
create index flashcards_due_idx on public.flashcards (user_id, next_review);
create trigger flashcards_updated_at before update on public.flashcards
  for each row execute function public.set_updated_at();

create table public.flashcard_reviews (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  card_id      uuid not null references public.flashcards(id) on delete cascade,
  correct      boolean not null,
  box_after    integer not null,
  reviewed_at  timestamptz not null default now()
);
create index flashcard_reviews_user_idx on public.flashcard_reviews (user_id, reviewed_at desc);

do $$
declare t text;
begin
  foreach t in array array['courses','assignments','exams','class_sessions','focus_sessions','flashcards','flashcard_reviews']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
