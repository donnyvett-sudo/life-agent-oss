// Вход в бота только по одноразовой ссылке от владельца.
// Код сгорает после первого входа, ссылку можно отозвать, пока ей не воспользовались.
import { BOT_USERNAME, INVITE_DAYS } from "./config.ts";
import { check, db, type User } from "./db.ts";

export type Invite = {
  id: string;
  code: string;
  created_by: string;
  note: string | null;
  expires_at: string;
  used_by: string | null;
  used_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

// Без похожих друг на друга символов: код переписывают руками и читают вслух.
const ALPHABET = "ACDEFGHJKLMNPQRTUVWXY2346789";
const CODE_LEN = 8;
const COLS = "id,code,created_by,note,expires_at,used_by,used_at,revoked_at,created_at";

export function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LEN));
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
}

export const inviteLink = (code: string) => `https://t.me/${BOT_USERNAME}?start=inv_${code}`;

/** Код из «/start inv_ABCD1234». Чужие приставки (например cards) не трогаем. */
export function parseInvitePayload(text: string): string | null {
  const m = text.match(/^\/start(?:@\S+)?\s+inv_([A-Z0-9]{4,16})$/i);
  return m ? m[1].toUpperCase() : null;
}

export async function createInvite(owner: User, note?: string): Promise<Invite> {
  const expires = new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString();
  return check(
    await db.from("invites")
      .insert({ code: newCode(), created_by: owner.id, note: note ?? null, expires_at: expires })
      .select(COLS).single(),
  ) as Invite;
}

/** Выданные и ещё живые ссылки. */
export async function pendingInvites(ownerId: string): Promise<Invite[]> {
  return check(
    await db.from("invites").select(COLS).eq("created_by", ownerId)
      .is("used_at", null).is("revoked_at", null).gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false }),
  ) as Invite[];
}

/** Годна ли ссылка — до того, как показать экран согласия. */
export async function peekInvite(code: string): Promise<Invite | null> {
  const { data } = await db.from("invites").select(COLS).eq("code", code).maybeSingle();
  const inv = (data as Invite) ?? null;
  if (!inv || inv.used_at || inv.revoked_at || Date.parse(inv.expires_at) < Date.now()) return null;
  return inv;
}

/**
 * Занимаем ссылку одним запросом: два одновременных согласия не создадут двух друзей.
 * Пользователя ещё нет, поэтому used_by проставляем следом, в attachInvite.
 */
export async function claimInvite(code: string): Promise<Invite | null> {
  const { data } = await db.from("invites").update({ used_at: new Date().toISOString() })
    .eq("code", code).is("used_at", null).is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .select(COLS).maybeSingle();
  return (data as Invite) ?? null;
}

export async function attachInvite(inviteId: string, userId: string): Promise<void> {
  check(await db.from("invites").update({ used_by: userId }).eq("id", inviteId));
}

/** Регистрация сорвалась — возвращаем ссылку в оборот. */
export async function releaseInvite(inviteId: string): Promise<void> {
  await db.from("invites").update({ used_at: null }).eq("id", inviteId);
}

export async function revokeInvite(ownerId: string, code: string): Promise<boolean> {
  const { count } = await db.from("invites").update({ revoked_at: new Date().toISOString() }, { count: "exact" })
    .eq("created_by", ownerId).eq("code", code.toUpperCase()).is("used_at", null).is("revoked_at", null);
  return !!count;
}

export async function friends(ownerId: string): Promise<User[]> {
  return check(
    await db.from("users").select("*").eq("invited_by", ownerId).order("created_at"),
  ) as User[];
}

export async function setAllowed(ownerId: string, userId: string, allowed: boolean): Promise<User | null> {
  const { data } = await db.from("users").update({ is_allowed: allowed })
    .eq("id", userId).eq("invited_by", ownerId).select("*").maybeSingle();
  return (data as User) ?? null;
}

/** Удаление аккаунта: остальные таблицы уходят каскадом по user_id. */
export async function deleteAccount(user: User): Promise<void> {
  check(await db.from("users").delete().eq("id", user.id));
}
