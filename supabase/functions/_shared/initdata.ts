// Проверка подписи Telegram Mini App initData
// (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).

const enc = new TextEncoder();

async function hmac(key: BufferSource, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return crypto.subtle.sign("HMAC", k, enc.encode(data));
}

const hex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type TgInitUser = { id: number; first_name?: string; username?: string };

export async function signInitData(fields: Record<string, string>, botToken: string) {
  const dcs = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join("\n");
  const secret = await hmac(enc.encode("WebAppData"), botToken);
  return hex(await hmac(secret, dcs));
}

export async function verifyInitData(
  initData: string,
  botToken: string,
  maxAgeSec = 24 * 60 * 60,
): Promise<TgInitUser | null> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const fields = Object.fromEntries(params.entries());
  if (!safeEqual(await signInitData(fields, botToken), hash)) return null;

  const authDate = Number(fields.auth_date);
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) return null;
  try {
    const user = JSON.parse(fields.user ?? "null") as TgInitUser | null;
    return user?.id ? user : null;
  } catch {
    return null;
  }
}
