-- Владелец может быть только один (защита от гонки двух первых /start).
create unique index users_single_owner on public.users ((true)) where is_owner;
