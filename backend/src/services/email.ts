/**
 * Email-сервис — Resend wrapper.
 *
 * Изолируем всё общение с почтой здесь, чтобы:
 *   * /api/auth/magic-link не падал, если Resend API недоступен (только лог).
 *   * В дев-режиме (нет RESEND_API_KEY) ссылка просто пишется в console.info
 *     — разработчик копирует её оттуда.
 *
 * Subject и HTML hardcoded здесь (минимальный брендинг RабочиеЛисты AI),
 * могут быть вынесены в шаблон позже (T2/T3 не трогают — это email-domain).
 */

import { Resend } from "resend";
import type { Env } from "../env";

export interface SendMagicLinkResult {
  sent: boolean;
  /** Только при ошибке — строка от Resend / сети. */
  error?: string;
  /** Только в dev-режиме: фактически сгенерированный magic-link URL (для логов). */
  url?: string;
}

const FROM = "РабочиеЛисты AI <noreply@rabochielisty.ru>";
const SUBJECT = "Войти в РабочиеЛисты AI";

/**
 * Отправить magic-link email пользователю через Resend.
 *
 * Если RESEND_API_KEY не задан — пишем URL в console.info (dev-режим) и
 * возвращаем `{ sent: true, url }`. Никаких HTTP-вызовов.
 *
 * Если RESEND задан — пытаемся отправить; ошибка пишется в console.warn и
 * возвращается { sent: false, error }. Не бросаем — вызывающий код решает,
 * насколько это критично (для /api/auth/magic-link это не критично).
 */
export async function sendMagicLinkEmail(
  env: Env,
  to: string,
  url: string,
): Promise<SendMagicLinkResult> {
  // Dev fallback: нет ключа → не делаем HTTP, пишем в логи.
  if (!env.RESEND_API_KEY) {
    // eslint-disable-next-line no-console
    console.info(`[magic-link] dev-mode to=${to} url=${url}`);
    return { sent: true, url };
  }

  const resend = new Resend(env.RESEND_API_KEY);

  const html = buildHtml(url);
  const text = buildText(url);

  try {
    const { data, error } = await resend.emails.send({
      from: FROM,
      to,
      subject: SUBJECT,
      html,
      text,
    });
    if (error) {
      // eslint-disable-next-line no-console
      console.warn(JSON.stringify({ msg: "resend error", to, error }));
      return { sent: false, error: typeof error === "string" ? error : (error.message ?? "resend error") };
    }
    return { sent: Boolean(data?.id), url };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // eslint-disable-next-line no-console
    console.warn(JSON.stringify({ msg: "resend exception", to, error: msg }));
    return { sent: false, error: msg };
  }
}

function buildHtml(url: string): string {
  return `<!doctype html>
<html lang="ru">
  <head><meta charset="utf-8"><title>${escapeHtml(SUBJECT)}</title></head>
  <body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;background:#faf8f5;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f5;padding:32px 0;">
      <tr><td align="center">
        <table role="presentation" width="540" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
          <tr><td style="padding:40px 32px 16px 32px;text-align:center;">
            <div style="font-size:36px;margin-bottom:12px;">📚</div>
            <h1 style="margin:0;font-size:24px;color:#1c1917;font-weight:700;">РабочиеЛисты AI</h1>
          </td></tr>
          <tr><td style="padding:8px 32px;text-align:center;">
            <h2 style="margin:0 0 8px 0;font-size:20px;color:#1c1917;font-weight:600;">Войти в аккаунт</h2>
            <p style="margin:0;color:#57534e;font-size:15px;line-height:1.5;">
              Нажмите кнопку ниже — мы откроем ваш личный кабинет. Ссылка действует 15 минут.
            </p>
          </td></tr>
          <tr><td style="padding:24px 32px;text-align:center;">
            <a href="${url}" target="_blank" rel="noopener"
               style="display:inline-block;background:#f97316;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:12px;font-weight:600;font-size:16px;">
              Войти в РабочиеЛисты AI
            </a>
          </td></tr>
          <tr><td style="padding:8px 32px 0 32px;">
            <p style="margin:0 0 4px 0;color:#a8a29e;font-size:12px;line-height:1.5;">Или скопируйте ссылку:</p>
            <p style="margin:0;background:#faf8f5;padding:10px 12px;border-radius:8px;word-break:break-all;font-family:ui-monospace,SFMono-Regular,monospace;font-size:12px;color:#44403c;">
              ${escapeHtml(url)}
            </p>
          </td></tr>
          <tr><td style="padding:24px 32px 32px 32px;">
            <p style="margin:0;color:#a8a29e;font-size:12px;line-height:1.5;">
              Если вы не запрашивали вход — просто проигнорируйте письмо. Никто кроме вас эту ссылку не получит.
            </p>
          </td></tr>
        </table>
        <p style="margin:16px 0 0 0;color:#a8a29e;font-size:11px;">РабочиеЛисты AI · rabochielisty.ru</p>
      </td></tr>
    </table>
  </body>
</html>`;
}

function buildText(url: string): string {
  return [
    "РабочиеЛисты AI — войти в аккаунт",
    "",
    "Нажмите ссылку, чтобы войти (действует 15 минут):",
    url,
    "",
    "Если вы не запрашивали вход — просто проигнорируйте письмо.",
  ].join("\n");
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
