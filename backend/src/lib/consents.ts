/**
 * Согласия при регистрации / входе (оферта, ПДн, реклама).
 *
 * Отдельная таблица `user_consents`, не колонки в users: повторный прогон
 * schema.sql идемпотентен, а ALTER ADD COLUMN в SQLite — нет. Плюс история
 * по версиям документов: UNIQUE(user_id, type, version).
 *
 * Политика уникальности: одна строка на пару (тип × версия документа).
 * Повторный вход с той же версией — UPSERT (обновляем accepted/accepted_at/ip/ua).
 * Смена текста документа = новая version → новая строка; старые остаются.
 *
 * Реклама пишется всегда, даже при отказе (accepted=0): иначе нельзя доказать,
 * что человек отказался, а не «мы забыли спросить». Рассылки при этом не шлём.
 */

import type { D1Database } from "@cloudflare/workers-types";
import { z } from "zod";
import { userConsentId } from "./shortid";

/** Типы согласий login-контура. F-06 photo consent сюда не входит. */
export type ConsentType = "offer" | "pdn" | "marketing";

/**
 * Версии документов (текстовые slug'и, как у photo CONSENT_VERSION=1).
 *
 * Должны совпадать по смыслу с `CONSENT_DOC_VERSION` / `OFFER_DOC_VERSION` /
 * `MARKETING_CONSENT_VERSION` на фронте (`src/lib/site.ts`). Меняем только
 * при реальной правке юртекста.
 */
export const OFFER_DOC_VERSION = "1";
export const PDN_DOC_VERSION = "1";
export const MARKETING_CONSENT_VERSION = "1";

export const CONSENT_VERSIONS: Record<ConsentType, string> = {
  offer: OFFER_DOC_VERSION,
  pdn: PDN_DOC_VERSION,
  marketing: MARKETING_CONSENT_VERSION,
};

/**
 * Тело согласий от клиента.
 *
 * offer и pdn обязаны быть true (акцепт). marketing — bool, default false;
 * отказ тоже пишем в БД.
 */
export const authConsentsSchema = z.object({
  offer: z.literal(true),
  pdn: z.literal(true),
  marketing: z.boolean(),
});

export type AuthConsents = z.infer<typeof authConsentsSchema>;

export interface ConsentMeta {
  ip?: string | null;
  ua?: string | null;
}

/**
 * Записать три решения (оферта, ПДн, реклама) для пользователя.
 *
 * Без строк в этой таблице согласие нельзя считать принятым: UI-галочка
 * сама по себе ничего не доказывает.
 */
export async function recordAuthConsents(
  db: D1Database,
  userId: string,
  consents: AuthConsents,
  meta: ConsentMeta = {},
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const ip = meta.ip ?? null;
  const ua = meta.ua ?? null;

  const rows: Array<{ type: ConsentType; accepted: 0 | 1; version: string }> = [
    { type: "offer", accepted: 1, version: CONSENT_VERSIONS.offer },
    { type: "pdn", accepted: 1, version: CONSENT_VERSIONS.pdn },
    {
      type: "marketing",
      accepted: consents.marketing ? 1 : 0,
      version: CONSENT_VERSIONS.marketing,
    },
  ];

  for (const row of rows) {
    await db
      .prepare(
        `INSERT INTO user_consents
           (id, user_id, type, version, accepted, accepted_at, ip, ua)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(user_id, type, version) DO UPDATE SET
           accepted = excluded.accepted,
           accepted_at = excluded.accepted_at,
           ip = excluded.ip,
           ua = excluded.ua`,
      )
      .bind(
        userConsentId(),
        userId,
        row.type,
        row.version,
        row.accepted,
        now,
        ip,
        ua,
      )
      .run();
  }
}

/**
 * Есть ли в БД акцепт обязательного согласия данной версии.
 * UI-галочка без строки здесь = согласие НЕ принято.
 */
export async function hasAcceptedConsent(
  db: D1Database,
  userId: string,
  type: Exclude<ConsentType, "marketing">,
  version: string = CONSENT_VERSIONS[type],
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT accepted FROM user_consents
       WHERE user_id = ?1 AND type = ?2 AND version = ?3
       LIMIT 1`,
    )
    .bind(userId, type, version)
    .first<{ accepted: number }>();
  return row?.accepted === 1;
}
