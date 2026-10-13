-- Человек заблокировал бота: планировщик ему не пишет, пока тот сам не напишет боту.
alter table public.users add column if not exists blocked_at timestamptz;
