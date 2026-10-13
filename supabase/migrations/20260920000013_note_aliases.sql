-- Память названий: одно заведение = одно написание. Ключ — фонетический «скелет»
-- (кириллица и латиница сводятся к одному виду), значение — каноническое написание.
create table public.note_aliases (
  user_id    uuid not null references public.users(id) on delete cascade,
  skel       text not null,
  canonical  text not null,
  hits       integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key (user_id, skel)
);

alter table public.note_aliases enable row level security;
revoke all on public.note_aliases from anon, authenticated;

-- Что было сказано/написано, если бот подставил каноническое название.
alter table public.transactions add column note_heard text;
