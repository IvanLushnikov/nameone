/**
 * Крон рекуррентных списаний и напоминаний (ТЗ-20).
 *
 * ─── Почему файл в `src/jobs/`, а не в `scripts/` ───────────────────────────
 * Логику вызывает ВОРКЕР (cron-триггер в `src/index.ts`), а не только ручной
 * запуск из CLI: `backend/tsconfig.json` собирает только `src` и `tests`, и
 * импорт из `scripts/` на деплое просто не билдится.
 *
 * ─── Ровно две экспортируемые функции ───────────────────────────────────────
 * Оркестратор подключает их к cron в `src/index.ts` двумя вызовами. Всё
 * остальное живёт в `services/billingRecurring.ts` и не интересует крон.
 *
 * ─── Про флаг ───────────────────────────────────────────────────────────────
 * Обе функции при `RECURRING_BILLING_ENABLED !== "true"` (или без ключей
 * ЮKassa) — полный no-op с понятным логом. Это не «страховка на всякий случай»:
 * автоплатежи в боевом магазине ЮKassa включаются только запросом менеджеру,
 * и включённый флаг без разрешения означал бы попытку списать деньги у
 * учителя. Включать — последним шагом, после проверок на тестовой карте.
 */

import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "../env";
import {
  chargeDueSubscription,
  claimNotification,
  findDueSubscriptions,
  findEndingSubscriptions,
  hasYooKassaKeys,
  isRecurringEnabled,
  monthlyPriceKopecks,
} from "../services/billingRecurring";
import { sendPeriodEndingEmail, sendRenewalReminderEmail } from "../services/email";

/** Понятное объяснение, почему проход ничего не сделал. */
function logDisabled(job: string, env: Env): void {
  // eslint-disable-next-line no-console
  console.info(
    `[cron:${job}] пропущен: RECURRING_BILLING_ENABLED=${env.RECURRING_BILLING_ENABLED ?? "не задан"}` +
      (hasYooKassaKeys(env) ? "" : ", нет ключей YOOKASSA_SHOP_ID/YOOKASSA_SECRET_KEY"),
  );
}

/**
 * Напоминания за сутки до конца периода.
 *
 * Два разных письма, потому что два разных положения дел:
 *   • автопродление ВКЛЮЧЕНО — «завтра спишем <сумма>, отменить можно здесь»;
 *   • автопродления НЕТ     — «доступ заканчивается <дата>, списаний не будет,
 *                              продлите» (решение владельца от 2026-10-03:
 *                              переводить оплативших разово молча нельзя).
 *
 * Идемпотентность — через `billing_notifications`: ключ привязан к конкретному
 * списанию (включая его дату), поэтому повторный прогон крона в течение суток
 * письмо не продублирует, а на следующий период отправит новое.
 */
export async function sendRenewalReminders(
  db: D1Database,
  env: Env,
  options: { now?: number } = {},
): Promise<{ scanned: number; sent: number; skipped: number }> {
  if (!isRecurringEnabled(env)) {
    logDisabled("sendRenewalReminders", env);
    return { scanned: 0, sent: 0, skipped: 0 };
  }

  const now = options.now ?? Math.floor(Date.now() / 1000);
  const subs = await findEndingSubscriptions(db, now);
  const result = { scanned: subs.length, sent: 0, skipped: 0 };

  for (const sub of subs) {
    // Письмо о СПИСАНИИ имеет смысл только при живом согласии: без строки в
    // recurring_payment_methods крон ничего не спишет, и обещать списание
    // было бы враньём. Смотрим именно на строку согласия, а не на auto_renew.
    const hasConsent = sub.has_recurring_method === 1 && sub.period === "monthly";
    const dedupeKey = `${hasConsent ? "renew" : "expiring"}:${sub.id}:${sub.ends_at}`;

    try {
      const claimed = await claimNotification(db, sub.user_id, "renewal_reminder", dedupeKey, now);
      if (!claimed) {
        result.skipped++;
        continue;
      }

      const sent = hasConsent
        ? await sendRenewalReminderEmail(env, sub.email, {
            plan: sub.plan,
            amountKopecks: monthlyPriceKopecks(sub.plan),
            endsAt: sub.ends_at,
          })
        : await sendPeriodEndingEmail(env, sub.email, { plan: sub.plan, endsAt: sub.ends_at });

      if (sent) result.sent++;
      else result.skipped++;
    } catch {
      // Одно письмо не должно ронять проход по всем остальным учителям.
      result.skipped++;
    }
  }

  // eslint-disable-next-line no-console
  console.info(
    `[cron:sendRenewalReminders] scanned=${result.scanned} sent=${result.sent} skipped=${result.skipped}`,
  );
  return result;
}

/**
 * Списать подписки, у которых истёк оплаченный период.
 *
 * Порядок внутри прохода: сначала «охота» за подписками батчем, потом по одной
 * попытка на каждого учителя. Ошибка одного (сеть, отказ банка, каприз
 * ЮKassa) считается failed и идёт дальше — остальные не должны ждать.
 */
export async function chargeDueSubscriptions(
  db: D1Database,
  env: Env,
  // Крон вызывает эти функции с двумя аргументами. Третий — только для тестов:
  // без подмены fetch тест списания дёргал бы боевой API ЮKassa.
  options: { now?: number; fetcher?: typeof globalThis.fetch } = {},
): Promise<{ scanned: number; charged: number; failed: number; skipped: number }> {
  if (!isRecurringEnabled(env)) {
    logDisabled("chargeDueSubscriptions", env);
    return { scanned: 0, charged: 0, failed: 0, skipped: 0 };
  }
  if (!hasYooKassaKeys(env)) {
    // Флаг включён, а списать нечем — это ошибка конфигурации, а не «ноль дел».
    // eslint-disable-next-line no-console
    console.error(
      "[cron:chargeDueSubscriptions] пропущен: нет YOOKASSA_SHOP_ID/YOOKASSA_SECRET_KEY. " +
        "Автопродление включено, но списывать нечем — проверьте секреты.",
    );
    return { scanned: 0, charged: 0, failed: 0, skipped: 0 };
  }

  const now = options.now ?? Math.floor(Date.now() / 1000);
  const subs = await findDueSubscriptions(db, now);
  const result = { scanned: subs.length, charged: 0, failed: 0, skipped: 0 };

  for (const sub of subs) {
    try {
      const outcome = await chargeDueSubscription(db, env, sub, { now, fetcher: options.fetcher });
      if (!outcome.ok) {
        result.failed++;
        continue;
      }
      if (outcome.error === "already_charged") {
        // Списание за этот период уже создано, ждём вебхук. Учитывать как
        // успешное списание нельзя — деньги ещё не списаны.
        result.skipped++;
        continue;
      }
      result.charged++;

      // Письмо о продлении уходит из вебхука, а не отсюда: сейчас платёж лишь
      // создан, деньги ещё не списаны. Писать «продлили» было бы неправдой.
    } catch {
      result.failed++;
    }
  }

  // eslint-disable-next-line no-console
  console.info(
    `[cron:chargeDueSubscriptions] scanned=${result.scanned} charged=${result.charged} ` +
      `failed=${result.failed} skipped=${result.skipped}`,
  );
  return result;
}
