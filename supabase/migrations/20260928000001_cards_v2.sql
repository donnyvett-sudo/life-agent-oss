-- Карточки v2: ежедневная сессия из 5 новых слов, ядро «разговорных» слов chinese1,
-- озвучка (file_id голосового в Telegram как кэш), ситуационные карточки и чек-ин.

alter table public.flashcards
  add column status text not null default 'new' check (status in ('new', 'learning', 'archived')),
  add column intro_order integer,
  add column audio_file_id text;

-- Ситуационные карточки не живут в Лейтнере: пишем только факт ответа, без карточки.
alter table public.flashcard_reviews
  alter column card_id drop not null,
  alter column box_after drop not null,
  add column note text;

-- Свободные ответы на вопросы бота (чек-ин карточек и т.п.), чтобы прочитать позже.
create table public.feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  topic       text not null,
  text        text not null,
  created_at  timestamptz not null default now()
);
alter table public.feedback enable row level security;
revoke all on public.feedback from anon, authenticated;
