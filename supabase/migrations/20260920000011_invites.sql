-- Друзья заходят только по одноразовой ссылке от владельца: код живёт 7 дней
-- и сгорает после первого входа.
create table public.invites (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  created_by  uuid not null references public.users(id) on delete cascade,
  note        text,                              -- кому предназначена ссылка
  expires_at  timestamptz not null,
  used_by     uuid references public.users(id) on delete set null,
  used_at     timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index invites_owner_idx on public.invites (created_by, created_at desc);

-- Кто пригласил и когда человек согласился с политикой. Без согласия в базу не пишем,
-- поэтому у всех строк дата есть; владелец согласился, когда завёл бота.
alter table public.users add column invited_by uuid references public.users(id) on delete set null;
alter table public.users add column consent_at timestamptz;
update public.users set consent_at = created_at where consent_at is null;

alter table public.invites enable row level security;
revoke all on public.invites from anon, authenticated;
