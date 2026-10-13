// Deployment-specific values, set in miniapp/.env (see .env.example). Nothing here is secret.
export const BOT = (import.meta.env.VITE_BOT_USERNAME as string | undefined) ?? "your_bot";
export const REGION = (import.meta.env.VITE_DB_REGION as string | undefined) ?? "the region chosen by the operator";
export const BOT_LINK = `https://t.me/${BOT}`;
