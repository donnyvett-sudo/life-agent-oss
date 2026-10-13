import { createClient } from "npm:@supabase/supabase-js@2";

export const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

export type Schedule = {
  morning: string;
  lunch_fallback: string;
  evening: string;
  lights_out: string;
  weekly: string;
  weekly_dow: number;
};

export type User = {
  id: string;
  tg_id: number;
  first_name: string | null;
  tz: string;
  is_allowed: boolean;
  is_owner: boolean;
  invited_by: string | null;
  ingest_token: string;
  github_token: string | null;
  settings: {
    schedule: Schedule;
    sleep: { bed: string; wake: string };
    coach: { frequency: string };
    lang?: "ru" | "en";
    // Заполняется при первом входе: коуч не знает о человеке ничего заранее.
    profile?: { about: string; name?: string; currency: string; github_login?: string | null };
  };
  state: Record<string, unknown>;
};

export type Supplement = {
  id: string;
  user_id: string;
  name: string;
  slot: "morning" | "lunch" | "evening";
  units_per_intake: number;
  units_per_pack: number | null;
  units_left: number | null;
  low_stock_warned: boolean;
  active: boolean;
  sort: number;
};

export type Reminder = {
  id: string;
  user_id: string;
  kind: string;
  local_date: string;
  status: "pending" | "done" | "skipped" | "expired";
  attempts: number;
  next_at: string | null;
  tg_message_id: number | null;
  payload: Record<string, unknown>;
};

export function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

/** Валюта пользователя по умолчанию: в ней он вводит суммы и видит сводки. */
export const userCurrency = (u: User): string => u.settings.profile?.currency || "USD";
