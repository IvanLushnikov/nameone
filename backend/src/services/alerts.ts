/**
 * Алерт админу: кто из платящих вышел за нормальный объём.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЗАЧЕМ
 * ─────────────────────────────────────────────────────────────────────────────
 * Норма тарифа мягкая (решение владельца продукта): пересечение не блокирует
 * генерацию. Это правильно для учителя — не отрезать посреди учебного года — но
 * оставляет продукт без предохранителя. Предохранитель здесь: письмо.
 *
 * Не «блокировка после N листов», а «дайте посмотреть на этого учителя».
 * Разница в том, с каким настроем открывают продукт после инцидента: с
 * желанием разобраться или с желанием выключить рубильник.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО НЕ ДЕЛАЕМ
 * ─────────────────────────────────────────────────────────────────────────────
 * Не пишем письмо на КАЖДОЕ превышение. При норме 16 млн токенов учитель может
 * пересечь её двадцать раз подряд за один урок, и админ получит двадцать
 * писем. Отсчка — последнее письмо по этому пользователю сутки назад.
 */

import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "../env";
import { Resend } from "resend";
import { logLlmEvent } from "../llm/log";

const FROM = "УчЛист <noreply@uchlist.ru>";
/** Не чаще одного письма в сутки на пользователя. */
const THROTTLE_SECONDS = 24 * 3600;

export interface QuotaAlert {
  userId: string;
  email: string;
  plan: string;
  used: number;
  norm: number;
  /** Себестоимость превышенной части в рублях — ради масштаба письма. */
  costOverNormRub: number;
  periodStart: number;
  periodEndsAt: number | null;
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2).replace(".", ",")} млн`;
  if (n >= 1_000) return `${Math.round(n / 1_000)} тыс.`;
  return String(n);
}

function buildHtml(a: QuotaAlert): string {
  const pct = Math.round((a.used / a.norm) * 100);
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;color:#1c1917;line-height:1.55">
  <h2 style="margin:0 0 12px">Учитель вышел за объём тарифа</h2>
  <p>Генерация у него <b>не заблокирована</b> (порог мягкий) — письмо только чтобы посмотреть глазами.</p>
  <table cellpadding="6" style="border-collapse:collapse;margin:14px 0;font-size:14px">
    <tr><td style="color:#78716c">Почта</td><td><b>${escapeHtml(a.email)}</b></td></tr>
    <tr><td style="color:#78716c">Тариф</td><td><b>${escapeHtml(a.plan)}</b></td></tr>
    <tr><td style="color:#78716c">Израсходовано</td><td><b>${formatTokens(a.used)}</b> из ${formatTokens(a.norm)} (${pct}%)</td></tr>
    <tr><td style="color:#78716c">Себестоимость сверх нормы</td><td><b>${a.costOverNormRub.toFixed(0)} ₽</b> за период</td></tr>
    <tr><td style="color:#78716c">Начало окна</td><td>${new Date(a.periodStart * 1000).toISOString().slice(0, 10)}</td></tr>
  </table>
  <p style="margin:16px 0 0">
    <a href="/api/admin/usage/${encodeURIComponent(a.userId)}"
       style="display:inline-block;padding:10px 16px;background:#44403c;color:#fff;border-radius:8px;text-decoration:none">
      Открыть в админке
    </a>
  </p>
  <p style="margin:20px 0 0;font-size:13px;color:#a8a29e">
    Если нагрузка постоянная — это нормальный учитель, которому нужен «Плюс»
    или доп. объём. Если разовая — возможна активность бота.
  </p>
</div>`;
}

/**
 * Письмо админу об одном превышении.
 *
 * Не бросает: алерт не должен ронять генерацию. Отсутствие RESEND_API_KEY —
 * dev-режим, логируем.
 */
export async function sendQuotaAlert(
  db: D1Database,
  env: Env,
  alert: QuotaAlert,
): Promise<{ sent: boolean; throttled: boolean }> {
  // Отсечка по последнему такому событию этого пользователя.
  const last = await db
    .prepare(
      `SELECT created_at FROM events
       WHERE user_id = ?1 AND name = 'quota_alert_sent'
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(alert.userId)
    .first<{ created_at: number }>();
  const now = Math.floor(Date.now() / 1000);
  if (last && now - last.created_at < THROTTLE_SECONDS) {
    return { sent: false, throttled: true };
  }

  await db
    .prepare(`INSERT INTO events (id, user_id, name, data_json, created_at) VALUES (?1, ?2, 'quota_alert_sent', ?3, ?4)`)
    .bind(
      `ev_qa_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      alert.userId,
      JSON.stringify({ used: alert.used, norm: alert.norm }),
      now,
    )
    .run();

  if (!env.RESEND_API_KEY) {
    logLlmEvent("warn", "quota alert (dev, без RESEND_API_KEY)", {
      userId: alert.userId,
      plan: alert.plan,
      used: alert.used,
      norm: alert.norm,
    });
    return { sent: false, throttled: false };
  }

  try {
    const resend = new Resend(env.RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: FROM,
      to: alert.email,
      subject: `[УчЛист] Выход за объём тарифа: ${alert.plan}`,
      html: buildHtml(alert),
    });
    if (error) {
      logLlmEvent("warn", "quota alert не отправлен", { userId: alert.userId, error: String(error).slice(0, 200) });
      return { sent: false, throttled: false };
    }
    return { sent: true, throttled: false };
  } catch (e) {
    logLlmEvent("warn", "quota alert упал", { userId: alert.userId, error: String(e).slice(0, 200) });
    return { sent: false, throttled: false };
  }
}
