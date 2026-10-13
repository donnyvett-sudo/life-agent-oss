-- Этап 5, вторая половина: стиль. Профиль, гардероб и разобранные образы.

-- Одна строка на человека: то, что нужно знать, чтобы судить об образе.
create table public.style_profile (
  user_id      uuid primary key references public.users(id) on delete cascade,
  height_cm    integer check (height_cm between 100 and 250),
  build        text,                            -- «худощавое», «среднее», «плотное»
  colors       text,                            -- цветотип или просто «тёплые, приглушённые»
  size_top     text,
  size_bottom  text,
  size_shoe    text,
  budget       text,                            -- «до 400 ¥ за вещь»
  goal         text,                            -- к чему идём: «спокойный минимализм»
  avoid        text,                            -- что не носит ни при каких условиях
  updated_at   timestamptz not null default now()
);
create trigger style_profile_updated_at before update on public.style_profile
  for each row execute function public.set_updated_at();

-- Гардероб нужен не ради учёта, а чтобы совет опирался на то, что уже есть.
create table public.wardrobe (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  kind         text not null default 'top'
                 check (kind in ('top', 'bottom', 'outer', 'shoes', 'accessory')),
  title        text not null,
  color        text,
  note         text,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index wardrobe_user_idx on public.wardrobe (user_id, active, kind);
create trigger wardrobe_updated_at before update on public.wardrobe
  for each row execute function public.set_updated_at();

-- Разобранные образы: храним только вердикт и текст, картинку не сохраняем.
create table public.style_looks (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  verdict      text not null default 'maybe' check (verdict in ('yes', 'maybe', 'no')),
  summary      text not null,
  advice       text,
  asked        text,                            -- подпись к фото, если была
  created_at   timestamptz not null default now()
);
create index style_looks_user_idx on public.style_looks (user_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['style_profile','wardrobe','style_looks']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
