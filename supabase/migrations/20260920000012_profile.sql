-- Профиль пользователя: «о себе» для коуча, своя валюта по умолчанию, свой токен GitHub.
-- До этого личность владельца была зашита в код, а валюта — в константу CNY.

alter table public.users add column github_token text;

alter table public.users alter column settings set default '{
  "schedule": {
    "morning": "07:15",
    "lunch_fallback": "14:30",
    "evening": "22:00",
    "lights_out": "22:45",
    "weekly": "21:00",
    "weekly_dow": 0
  },
  "sleep": { "bed": "23:00", "wake": "07:00" },
  "coach": { "frequency": "normal" },
  "profile": { "about": "", "currency": "USD" }
}'::jsonb;

update public.users
set settings = settings || jsonb_build_object(
  'profile', jsonb_build_object('about', '', 'currency', 'USD')
)
where settings->'profile' is null;
