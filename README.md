# Life Agent

A personal Telegram coach bot that tracks sleep, supplements, habits, money, study and projects,
with a Telegram Mini App as its dashboard. One deploy serves you (the owner) plus anyone you invite.

**Backend = Supabase** (Postgres + Edge Functions + pg_cron + Vault). Telegram is only the interface.
No server of your own to host.

```
Telegram ──webhook──▶ Edge Function telegram-bot ─┐
Mini App (GitHub Pages) ──▶ Edge Function api ────┼──▶ Postgres (RLS on, service_role only)
pg_cron (every minute) ──▶ Edge Function scheduler ┘        ▲
iOS Shortcuts / scripts ──▶ sleep-webhook, quick-entry, study-sync, health
```

## What it does
- Sleep log, streaks, morning/evening/weekly summaries (Asia/Shanghai by default, per-user timezone).
- Supplement reminders with snooze and low-stock alerts.
- Finance: quick entry (`taxi 18`, `$20 subscription`), accounts, categories, multi-currency, Money Manager import.
- Study: assignments, exams, class sessions, focus timer, Leitner flashcards (`/cards`).
- Career: projects, milestones, GitHub contribution graph. Habits, food log.
- Gemini only for coaching, voice and photo parsing; routine logic is deterministic code.
- UI languages: Russian and English.

## Quick start
See **[docs/SETUP.md](docs/SETUP.md)**. Short version: create a Supabase project, `supabase db push`,
`scripts/deploy.sh`, `scripts/setup-telegram.sh`, publish the Mini App with `scripts/deploy-miniapp.sh`.

## Before you run it for other people
The consent text (`supabase/functions/_shared/legal.ts`, `miniapp/src/screens/Legal.tsx`) says
"personal project, server in Tokyo, owner can technically read the data". **Edit it to match your
real setup** (region, contact, who is responsible). You are the data controller of your deployment.

## Development
```bash
cd supabase/functions && SUPABASE_URL=http://x SUPABASE_SERVICE_ROLE_KEY=x npx deno@2 test --allow-env --allow-read _shared/
cd miniapp && npm install && npm run dev
```

## License
MIT. See [LICENSE](LICENSE).
