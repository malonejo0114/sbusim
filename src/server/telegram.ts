import { optionalEnv } from "@/server/env";
import { fetchJsonWithRetry } from "@/server/fetchJson";

function escapeTelegram(text: string) {
  return text.replace(/[<>&]/g, (ch) => {
    if (ch === "<") return "&lt;";
    if (ch === ">") return "&gt;";
    return "&amp;";
  });
}

export function isTelegramAlertEnabled() {
  return Boolean(optionalEnv("TELEGRAM_BOT_TOKEN") && optionalEnv("TELEGRAM_CHAT_ID"));
}

export async function sendTelegramAlert(message: string) {
  const token = optionalEnv("TELEGRAM_BOT_TOKEN");
  const chatId = optionalEnv("TELEGRAM_CHAT_ID");
  if (!token || !chatId) return { ok: false, skipped: true };

  const text = escapeTelegram(message).slice(0, 3800);
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  await fetchJsonWithRetry(
    url,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    },
    { timeoutMs: 10_000, retries: 2, backoffMs: 500 }
  );
  return { ok: true, skipped: false };
}

