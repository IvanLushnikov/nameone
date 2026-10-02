/**
 * Очистка фото тетрадей по истечении retention-срока (TZ-11 §5.2, В-2.3).
 *
 * Фото страницы школьной тетради — персональные данные ребёнка: в шапке
 * может быть фамилия, на контрольных бывают подписи с датой рождения. Поэтому
 * держим максимум 7 дней и удаляем сами, а не «когда учитель наведёт порядок».
 *
 * ─── Почему файл в `src/jobs/`, а не в `scripts/` ───
 * Логика нужна ВОРКЕРУ (cron-триггер в `src/index.ts`), а не только ручному
 * запуску из CLI. При этом `backend/tsconfig.json` собирает только
 * `src` и `tests` — импорт из `scripts/` не билдится, и cron тихо упал бы
 * на деплое. Поэтому чистая функция живёт здесь, а
 * `scripts/purgeExpiredPhotos.ts` остаётся тонкой обёрткой для CLI.
 *
 * ─── Порядок операций ───
 * Сначала удаляем объект из R2, потом ставим `deleted_at` в D1. Обратный
 * порядок опасен: если процесс умрёт между шагами, в D1 будет отметка об
 * удалении, а фото останется в R2 навсегда — и повторный прогон её не тронет,
 * потому что запись уже «удалена».
 */

import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import { listExpiredPhotoChecks, markPhotoDeleted } from "../db/photoChecks";

/** Сколько записей обрабатываем за один проход — защита от длинного запроса. */
export const BATCH_LIMIT = 200;

export interface PurgeResult {
  scanned: number;
  deletedFromR2: number;
  markedDeleted: number;
  failed: number;
}

/**
 * Чистая функция очистки — её можно вызвать и из cron-обработчика Worker,
 * и из скрипта, и из теста (с фейковыми D1/R2).
 */
export async function purgeExpiredPhotos(
  db: D1Database,
  bucket: R2Bucket,
  nowUnixSec: number = Math.floor(Date.now() / 1000),
): Promise<PurgeResult> {
  const rows = await listExpiredPhotoChecks(db, { now: nowUnixSec, limit: BATCH_LIMIT });

  const result: PurgeResult = {
    scanned: rows.length,
    deletedFromR2: 0,
    markedDeleted: 0,
    failed: 0,
  };

  for (const row of rows) {
    if (!row.user_id) {
      // Проверка без пользователя (аккаунт удалён) — чистим фото, но не
      // проставляем deleted_at: markPhotoDeleted требует совпадения user_id.
      if (row.r2_key) {
        try {
          await bucket.delete(row.r2_key);
          result.deletedFromR2++;
        } catch {
          result.failed++;
        }
      }
      continue;
    }

    try {
      if (row.r2_key) {
        await bucket.delete(row.r2_key);
        result.deletedFromR2++;
      }
      const ok = await markPhotoDeleted(db, {
        id: row.id,
        userId: row.user_id,
        deletedAt: nowUnixSec,
      });
      if (ok) result.markedDeleted++;
    } catch {
      // Одна неудачная запись не должна останавливать весь прогон.
      result.failed++;
    }
  }

  return result;
}
