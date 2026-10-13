-- Персональный токен для внешних источников (iOS Shortcuts → sleep-webhook).
-- Одновременно секрет и идентификатор пользователя.
alter table public.users
  add column ingest_token text not null unique
  default encode(extensions.gen_random_bytes(24), 'hex');
