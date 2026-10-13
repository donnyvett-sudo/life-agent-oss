import { check, db, type User } from "./db.ts";
import { langFromLocale } from "./i18n.ts";
import { attachInvite, claimInvite, type Invite, parseInvitePayload, peekInvite, releaseInvite } from "./invites.ts";

export async function findUser(tgId: number): Promise<User | null> {
  return check(await db.from("users").select("*").eq("tg_id", tgId).maybeSingle()) as
    | User
    | null;
}

/** Личный токен (users.ingest_token): короткие и пустые даже не ищем в базе. */
export function tokenShaped(token: string | null | undefined): token is string {
  return typeof token === "string" && token.length >= 32 && token.length <= 200;
}

/** Пользователь по личному токену (заголовок X-Token): Study Agent, Shortcuts, Life Desk. */
export async function findByToken(token: string | null | undefined): Promise<User | null> {
  if (!tokenShaped(token)) return null;
  return check(
    await db.from("users").select("*").eq("ingest_token", token).eq("is_allowed", true).maybeSingle(),
  ) as User | null;
}

/** Язык интерфейса на первый раз — по клиенту Telegram, дальше меняется в настройках. */
async function initLang(user: User, code?: string): Promise<User> {
  const l = langFromLocale(code);
  if (l === "ru") return user;
  const settings = { ...user.settings, lang: l };
  check(await db.from("users").update({ settings }).eq("id", user.id));
  return { ...user, settings };
}

export type StartResult =
  | { kind: "owner"; user: User } // первый /start в пустой базе
  | { kind: "known"; user: User }
  | { kind: "blocked" } // доступ сняли
  | { kind: "consent"; code: string } // ссылка годная, ждём согласия
  | { kind: "closed" }; // без приглашения сюда не войти

/**
 * /start: владелец появляется сам в пустой базе, остальные — только по ссылке-приглашению
 * и только после экрана согласия. Без согласия в базу ничего не пишем.
 */
export async function registerOnStart(
  from: { id: number; first_name?: string; username?: string; language_code?: string },
  text: string,
): Promise<StartResult> {
  const existing = await findUser(from.id);
  if (existing) return existing.is_allowed ? { kind: "known", user: existing } : { kind: "blocked" };

  const { count } = await db.from("users").select("id", { count: "exact", head: true });
  if ((count ?? 0) === 0) {
    const user = check(
      await db.from("users").insert({
        tg_id: from.id,
        first_name: from.first_name ?? null,
        username: from.username ?? null,
        is_allowed: true,
        is_owner: true,
        consent_at: new Date().toISOString(),
      }).select().single(),
    ) as User;
    return { kind: "owner", user: await initLang(user, from.language_code) };
  }

  const code = parseInvitePayload(text);
  if (!code || !(await peekInvite(code))) return { kind: "closed" };
  return { kind: "consent", code };
}

/**
 * Человек нажал «Согласен». Сначала занимаем ссылку, потом заводим пользователя:
 * если что-то упало, ссылку возвращаем в оборот.
 * Добавки друг заводит сам — чужой набор ему ни к чему.
 */
export async function acceptInvite(
  from: { id: number; first_name?: string; username?: string; language_code?: string },
  code: string,
): Promise<{ user: User | null; invite: Invite | null }> {
  const existing = await findUser(from.id);
  if (existing) return { user: existing.is_allowed ? existing : null, invite: null };

  const invite = await claimInvite(code);
  if (!invite) return { user: null, invite: null };

  try {
    const user = check(
      await db.from("users").insert({
        tg_id: from.id,
        first_name: from.first_name ?? null,
        username: from.username ?? null,
        is_allowed: true,
        is_owner: false,
        invited_by: invite.created_by ?? null,
        consent_at: new Date().toISOString(),
      }).select().single(),
    ) as User;
    await attachInvite(invite.id, user.id);
    return { user: await initLang(user, from.language_code), invite };
  } catch (e) {
    await releaseInvite(invite.id);
    throw e;
  }
}
