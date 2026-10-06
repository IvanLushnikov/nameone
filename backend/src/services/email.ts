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

const FROM = "УчЛист <noreply@uchlist.ru>";
const SUBJECT = "Войти в УчЛист";

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
            <h1 style="margin:0;font-size:24px;color:#1c1917;font-weight:700;">УчЛист</h1>
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
              Войти в УчЛист
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
        <p style="margin:16px 0 0 0;color:#a8a29e;font-size:11px;">УчЛист · uchlist.ru</p>
      </td></tr>
    </table>
  </body>
</html>`;
}

function buildText(url: string): string {
  return [
    "УчЛист — войти в аккаунт",
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

// ─────────────────────────────────────────────────────────────────────────────
// Письма по подписке (ТЗ-20)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Письма по оплате идут через тот же Resend-паттерн, что и magic-link, и так же
 * деградируют до лога, когда RESEND_API_KEY не задан: отсутствие почты не должно
 * ронять обработку платежа (деньги-то уже списаны).
 *
 * Названия тарифов продублированы из src/lib/content/plans.ts: бэк — отдельный
 * npm-проект и не видит файлы фронта. Расхождение здесь безобидное (это текст
 * письма, не сумма), а вот суммы — из PRICES в services/billing.ts, и их
 * сверяет tests/integration/plans-price-sources.test.ts.
 */
const PLAN_LABELS: Record<string, string> = {
  base: "Базовый",
  plus: "Плюс",
  school: "Школа",
};

const MONTHS_GENITIVE = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

/**
 * Дата в виде «15 октября» (родительный падеж, как принято в русской дате).
 *
 * Своя функция, а не toLocaleDateString: месяц нужен в правильной форме, а
 * результат не должен зависеть от того, с каким ICU собран рантайм воркера.
 */
export function formatRuDate(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  return `${d.getUTCDate()} ${MONTHS_GENITIVE[d.getUTCMonth()]}`;
}

/** Копейки → «500 ₽». Сумма в письме всегда целая, копеек мы не показываем. */
function formatRub(kopecks: number): string {
  return `${Math.round(kopecks / 100)} ₽`;
}

/**
 * Публичный адрес приложения для ссылки в письме.
 * Берём APP_PUBLIC_URL — это единственная переменная, в которой гарантированно
 * один origin (см. комментарий к firstFrontendOrigin в services/billing.ts).
 */
function appUrl(env: Env, path: string): string {
  const base = (env.APP_PUBLIC_URL ?? (env.FRONTEND_URL ?? "").split(",")[0] ?? "").trim().replace(/\/+$/, "");
  return `${base}${path}`;
}

interface BillingMail {
  to: string;
  subject: string;
  heading: string;
  paragraphs: string[];
  action?: { label: string; url: string };
  footnote: string;
}

/** Общая обёртка: без RESEND_API_KEY — только лог, ошибок не бросаем. */
async function deliverBillingMail(env: Env, mail: BillingMail): Promise<boolean> {
  const html = renderBillingHtml(mail);
  const text = renderBillingText(mail);

  if (!env.RESEND_API_KEY) {
    // eslint-disable-next-line no-console
    console.info(
      `[billing-email] dev-mode to=${mail.to} subject=${JSON.stringify(mail.subject)} ` +
        `action=${mail.action?.url ?? "нет"}`,
    );
    return true;
  }

  const resend = new Resend(env.RESEND_API_KEY);
  try {
    const { data, error } = await resend.emails.send({
      from: FROM,
      to: mail.to,
      subject: mail.subject,
      html,
      text,
    });
    if (error) {
      // eslint-disable-next-line no-console
      console.warn(JSON.stringify({ msg: "billing email error", to: mail.to, error }));
      return false;
    }
    return Boolean(data?.id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // eslint-disable-next-line no-console
    console.warn(JSON.stringify({ msg: "billing email exception", to: mail.to, error: msg }));
    return false;
  }
}

function renderBillingHtml(mail: BillingMail): string {
  const action = mail.action
    ? `<tr><td style="padding:8px 32px 0 32px;">
         <a href="${escapeHtml(mail.action.url)}" target="_blank" rel="noopener"
            style="display:inline-block;background:#f97316;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:12px;font-weight:600;font-size:16px;">
           ${escapeHtml(mail.action.label)}
         </a>
       </td></tr>`
    : "";
  return `<!doctype html>
<html lang="ru">
  <head><meta charset="utf-8"><title>${escapeHtml(mail.subject)}</title></head>
  <body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;background:#faf8f5;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f5;padding:32px 0;">
      <tr><td align="center">
        <table role="presentation" width="540" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
          <tr><td style="padding:40px 32px 8px 32px;text-align:center;">
            <div style="font-size:36px;margin-bottom:12px;">📚</div>
            <h1 style="margin:0;font-size:24px;color:#1c1917;font-weight:700;">УчЛист</h1>
          </td></tr>
          <tr><td style="padding:16px 32px 0 32px;">
            <h2 style="margin:0 0 12px 0;font-size:20px;color:#1c1917;font-weight:600;">${escapeHtml(mail.heading)}</h2>
            ${mail.paragraphs
              .map((p) => `<p style="margin:0 0 10px 0;color:#57534e;font-size:15px;line-height:1.5;">${escapeHtml(p)}</p>`)
              .join("\n            ")}
          </td></tr>
          ${action}
          <tr><td style="padding:24px 32px 32px 32px;">
            <p style="margin:0;color:#a8a29e;font-size:12px;line-height:1.5;">${escapeHtml(mail.footnote)}</p>
          </td></tr>
        </table>
        <p style="margin:16px 0 0 0;color:#a8a29e;font-size:11px;">УчЛист · uchlist.ru</p>
      </td></tr>
    </table>
  </body>
</html>`;
}

function renderBillingText(mail: BillingMail): string {
  return [
    `УчЛист — ${mail.heading}`,
    "",
    ...mail.paragraphs,
    "",
    ...(mail.action ? [`${mail.action.label}: ${mail.action.url}`] : []),
    mail.footnote,
  ].join("\n");
}

/**
 * Продление прошло (автопродление, kind = renewal_done).
 * Пишем, что именно продлилось и до какого числа — учителю важно видеть
 * не «оплата прошла», а «доступ есть до такого-то».
 */
export async function sendRenewalDoneEmail(
  env: Env,
  to: string,
  data: { plan: string; endsAt: number },
): Promise<boolean> {
  const plan = PLAN_LABELS[data.plan] ?? data.plan;
  return deliverBillingMail(env, {
    to,
    subject: `Тариф «${plan}» продлён до ${formatRuDate(data.endsAt)}`,
    heading: "Подписка продлена",
    paragraphs: [
      `Оплатили следующий месяц тарифа «${plan}» — доступ теперь до ${formatRuDate(data.endsAt)}.`,
      "Карту мы не трогали: списания идут только по вашей подписке.",
    ],
    action: { label: "Открыть кабинет", url: appUrl(env, "/account") },
    footnote: "Отменить автопродление можно в кабинете в любой момент — до этого дня доступ останется.",
  });
}

/**
 * Списание не прошло (kind = renewal_failed).
 * Тон здесь особенно важен: человек не платил по своей воле, и письмо не должно
 * читаться как обвинение («ваша карта отклонена»). Сообщаем факт и даём ссылку
 * на оплату вручную.
 */
export async function sendRenewalFailedEmail(
  env: Env,
  to: string,
  data: { plan: string },
): Promise<boolean> {
  const plan = PLAN_LABELS[data.plan] ?? data.plan;
  return deliverBillingMail(env, {
    to,
    subject: `Не удалось продлить подписку «${plan}»`,
    heading: "Продление не прошло",
    paragraphs: [
      `Платёж за следующий месяц не прошёл, поэтому доступ к «${plan}» закончится вместе с текущим периодом.`,
      "Ничего списываться не будет, пока автопродление включено: сначала оплатите следующий месяц вручную — после этого продление продолжит работать само.",
    ],
    action: { label: "Оплатить месяц", url: appUrl(env, "/pricing") },
    footnote: "Если списание отклоняет банк, проще оплатить через СБП — деньги спишутся сразу.",
  });
}

/**
 * Напоминание за сутки: завтра спишут (kind = renewal_reminder, автопродление
 * включено). Дата, сумма и ссылка на отмену — три вещи, ради которых письмо
 * и отправляется: учитель должен успеть отменить, если передумал.
 */
export async function sendRenewalReminderEmail(
  env: Env,
  to: string,
  data: { plan: string; amountKopecks: number; endsAt: number },
): Promise<boolean> {
  const plan = PLAN_LABELS[data.plan] ?? data.plan;
  return deliverBillingMail(env, {
    to,
    subject: `Завтра продлим «${plan}» на ${formatRub(data.amountKopecks)}`,
    heading: "Завтра продление подписки",
    paragraphs: [
      `${formatRuDate(data.endsAt)} спишем ${formatRub(data.amountKopecks)} за тариф «${plan}» — карта, которую вы указали при оформлении.`,
      "Текущий период при этом не заканчивается: доступ просто продолжится на следующий месяц.",
    ],
    action: { label: "Отменить автопродление", url: appUrl(env, "/account") },
    footnote: "Не хотите продлевать — отмените по ссылке выше до завтра, списания не будет.",
  });
}

/**
 * Подписка заканчивается, автопродления нет (тот же renewal_reminder, но
 * другой dedupe_key). Это письмо про решение владельца от 2026-10-03: платить
 * молча никого не переводим, поэтому заранее говорим, что будет, и предлагаем
 * один шаг — оплатить следующий период. Без этого письма учитель узнает об
 * окончании доступа из тихой остановки сервиса.
 */
export async function sendPeriodEndingEmail(
  env: Env,
  to: string,
  data: { plan: string; endsAt: number },
): Promise<boolean> {
  const plan = PLAN_LABELS[data.plan] ?? data.plan;
  return deliverBillingMail(env, {
    to,
    subject: `Доступ «${plan}» заканчивается ${formatRuDate(data.endsAt)}`,
    heading: "Подписка заканчивается",
    paragraphs: [
      `${formatRuDate(data.endsAt)} заканчивается оплаченный период тарифа «${plan}».`,
      `Автоматического списания у вас нет — мы никого не переводим на автопродление без согласия. Если хотите продолжить, оплатите следующий месяц заранее.`,
    ],
    action: { label: "Продлить подписку", url: appUrl(env, "/pricing") },
    footnote: "После окончания периода личные материалы и история генераций останутся в кабинете.",
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Смена почты (ТЗ-21, блок 5)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Письмо с подтверждением смены почты.
 *
 * В отличие от писем выше, здесь деградация «в консоль» НЕДОПУСТИМА. Остальные
 * письма приходят уже после события (деньги списаны, подписка активирована) —
 * и «доставка в лог» там означает «событие обработано, а письмо не дошло».
 * Здесь всё наоборот: письмо с подтверждением ЕСТЬ подтверждение. Сказать
 * учителю «мы отправили письмо на новый адрес», не отправив его, — значит
 * оставить его с настройкой, которая не сработает никогда.
 *
 * Поэтому возвращаем честный результат: `sent: false` с причиной, и вызывающий
 * код говорит учителю правду и НЕ применяет смену почты.
 */
export interface EmailChangeMailResult {
  sent: boolean;
  /** Человекочитаемая причина, если письмо не отправлено. */
  reason?: "not_configured" | "provider_error";
  error?: string;
}

export async function sendEmailChangeEmail(
  env: Env,
  to: string,
  url: string,
): Promise<EmailChangeMailResult> {
  if (!env.RESEND_API_KEY) {
    return { sent: false, reason: "not_configured" };
  }

  const resend = new Resend(env.RESEND_API_KEY);
  const html =
    `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px">` +
    `<h2 style="margin:0 0 12px">Подтвердите новую почту</h2>` +
    `<p style="margin:0 0 12px">Вы попросили сменить почту в «УчЛисте» на этот адрес.</p>` +
    `<p style="margin:0 0 16px">Пока вы не подтвердите смену, вход останется на старом адресе, а все материалы — на прежнем аккаунте.</p>` +
    `<p style="margin:0 0 20px"><a href="${escapeHtml(url)}" style="display:inline-block;background:#107456;color:#fff;padding:12px 24px;border-radius:12px;text-decoration:none;font-weight:600">Подтвердить смену почты</a></p>` +
    `<p style="margin:0;color:#666;font-size:13px">Если это не вы — просто проигнорируйте письмо, ничего не изменится.</p>` +
    `</div>`;

  try {
    // `data` не разбираем: успех определяется отсутствием `error`, сам ответ
    // Resend здесь ничего не добавляет. Раньше он был в деструктуризации и
    // ронял eslint в CI — файл был сломан до этого захода.
    const { error } = await resend.emails.send({
      from: FROM,
      to,
      subject: "Подтвердите новую почту в УчЛисте",
      html,
      text:
        "Подтвердите смену почты в «УчЛисте»: " +
        `${url}\n\nПока вы не подтвердите смену, вход останется на старом адресе.`,
    });
    if (error) {
      // eslint-disable-next-line no-console
      console.warn(`[email] смена почты: Resend не принял письмо to=${to} error=${JSON.stringify(error)}`);
      return { sent: false, reason: "provider_error", error: error.message };
    }
    return { sent: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // eslint-disable-next-line no-console
    console.warn(`[email] смена почты: исключение to=${to} error=${msg}`);
    return { sent: false, reason: "provider_error", error: msg };
  }
}
