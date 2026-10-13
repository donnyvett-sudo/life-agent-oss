# Life Agent

Личный Telegram-бот-коуч: сон, добавки, привычки, деньги, учёба, проекты; дашборд — Telegram Mini App.
Один деплой обслуживает вас (владельца) и тех, кого вы пригласите.

**Бэкенд — Supabase** (Postgres + Edge Functions + pg_cron + Vault). Telegram — только интерфейс.
Своего сервера не нужно.

Запуск — [docs/SETUP.md](docs/SETUP.md) (на английском). Лицензия MIT.

**Важно:** перед тем как пускать других людей, поправьте текст согласия
(`supabase/functions/_shared/legal.ts`, `miniapp/src/screens/Legal.tsx`) под свой реальный сетап.
