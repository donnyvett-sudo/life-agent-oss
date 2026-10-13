-- Пульс планировщика: по нему внешняя проверка понимает, что pg_cron и функции живы.
create table public.heartbeat (
  id        boolean primary key default true check (id),
  last_tick timestamptz not null default now(),
  ticks     bigint not null default 0
);
insert into public.heartbeat (id) values (true) on conflict do nothing;
alter table public.heartbeat enable row level security;
revoke all on public.heartbeat from anon, authenticated;

create or replace function public.beat() returns void
language sql security definer set search_path = public as $$
  update public.heartbeat set last_tick = now(), ticks = ticks + 1 where id;
$$;
revoke all on function public.beat() from anon, authenticated;
