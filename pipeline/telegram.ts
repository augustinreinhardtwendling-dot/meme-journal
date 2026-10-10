// Bot Telegram : envoi du résumé du matin. Le chat_id est découvert au premier /start et mémorisé (ce n'est pas un secret).
import type { Sql } from "postgres";
import { loadConfig } from "../lib/db";

const API = "https://api.telegram.org";

export function telegramToken(): string | null {
  const t = (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
  return t || null;
}

async function call<T>(token: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!json.ok) throw new Error(`Telegram ${method} : ${json.description ?? res.status}`);
  return json.result as T;
}

/** Trouve la conversation privée avec le bot (il faut lui avoir envoyé /start) et la mémorise. */
export async function resolveChatId(sql: Sql, token: string): Promise<string | null> {
  const fromEnv = (process.env.TELEGRAM_CHAT_ID ?? "").trim();
  if (fromEnv) return fromEnv;
  const cfg = await loadConfig();
  if (cfg.telegram.chat_id) return cfg.telegram.chat_id;
  const updates = await call<{ message?: { chat: { id: number; type: string } } }[]>(token, "getUpdates");
  const chat = updates.map((u) => u.message?.chat).filter((c) => c?.type === "private").at(-1);
  if (!chat) return null;
  const id = String(chat.id);
  await sql`update settings set config = jsonb_set(config, '{telegram}', ${sql.json({ chat_id: id } as never)}, true), updated_at = now() where id = 1`;
  return id;
}

export async function sendTelegram(token: string, chatId: string, html: string) {
  await call(token, "sendMessage", { chat_id: chatId, text: html, parse_mode: "HTML", link_preview_options: { is_disabled: true } });
}

export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
