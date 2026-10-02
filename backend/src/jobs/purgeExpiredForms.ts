/**
 * Очистка ответов учеников по истечении retention-срока (TZ-12 §5.4).
 *
 * Имя ученика, ответы и время выполнения — персональные данные ребёнка.
 * По ТЗ-12 §5.4 ответы хранятся максимум 90 дней и удаляются САМИ, а не
 * «когда учитель наведёт порядок в кабинете».
 *
 * ─── Правило из ТЗ дословно ───
 *  • учитель закрыл форму → ответы остаются, он может разбирать их сколько угодно;
 *  • прошло 90 дней → ответы удаляются автоматически, а САМА ФОРМА ОСТАЁТСЯ
 *    в списке со статусом «ответы удалены»;
 *  • учитель нажал «Удалить» → форма и ответы удаляются сразу (CASCADE, это
 *    отдельный эндпоинт DELETE, он нас не касается).
 *
 * Поэтому мы НЕ удаляем строку `forms` — только `form_answers` и
 * `form_responses`, и ставим форме флаг `responses_purged = 1`, чтобы
 * кабинет показал честную подпись «ответы удалены», а не пустой список.
 *
 * ─── От чего считаем 90 дней ───
 * От последней отправки, а не от создания формы и не от её закрытия. Учитель
 * может держать форму открытой месяцами и разбирать ответы в последний
 * день — тогда данные нужны ещё год. Срок считается от последнего
 * `submitted_at`, поэтому активная форма под нож не попадает.
 *
 * ─── Почему это отдельная функция, а не продление purgeExpiredPhotos ───
 * purgeExpiredPhotos удаляет фотографии из R2 + ставит отметку в D1. Здесь
 * нет объектов в R2: удаляются строки в трёх таблицах. Смешивать два разных
 * механизма в одном модуле значит усложнить оба.
 *
 * ─── Порядок операций ───
 * Сначала ответы на задания, потом сами ответы, потом флаг на форме.
 * Обратный порядок опасен: если процесс умрёт между шагами, форма будет
 * помечена «ответы удалены», а данные останутся в базе навсегда — и повторный
 * прогон их уже не тронет, потому что флаг стоит.
 */

import type { D1Database } from "@cloudflare/workers-types";

/** Retention-срок хранения ПДн ученика, секунды (90 суток). */
export const RETENTION_SEC = 90 * 24 * 60 * 60;

/** Сколько форм обрабатываем за один проход — защита от длинного cron-запроса. */
export const BATCH_LIMIT = 100;

export interface PurgeFormsResult {
  scanned: number;
  responsesDeleted: number;
  answersDeleted: number;
  formsFlagged: number;
  failed: number;
}

/**
 * Чистая функция очистки — вызывается из cron-обработчика, из CLI-скрипта
 * и из теста (с фейковым D1).
 *
 * @param nowUnixSec текущее время, unix seconds. Параметр, а не Date.now()
 *                   внутри, чтобы тест мог подставить фиксированное время.
 */
export async function purgeExpiredForms(
  db: D1Database,
  nowUnixSec: number = Math.floor(Date.now() / 1000),
): Promise<PurgeFormsResult> {
  const result: PurgeFormsResult = {
    scanned: 0,
    responsesDeleted: 0,
    answersDeleted: 0,
    formsFlagged: 0,
    failed: 0,
  };

  const cutoff = nowUnixSec - RETENTION_SEC;

  // Берём формы, у которых ответы ЕСТЬ, но ни одного ответа свежее отсечки.
  //
  // Внимание на логику, тут легко перепутать направление: нам нужны формы, где
  // НЕТ свежих отправок. Поэтому «ответы старше отсечки» выражается как
  // «ответы есть» И «свежих ответов нет». Условие `EXISTS (submitted_at > cutoff)`
  // означало бы ровно обратное — мы бы удаляли данные учеников, которые
  // только что отправили работу, и хранили бы протухшие ПДн.
  const page = await db
    .prepare(
      `SELECT id
         FROM forms
        WHERE responses_purged = 0
          AND EXISTS (
            SELECT 1 FROM form_responses r WHERE r.form_id = forms.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM form_responses r
             WHERE r.form_id = forms.id
               AND r.submitted_at > ?1
          )
        ORDER BY id ASC
        LIMIT ?2`,
    )
    .bind(cutoff, BATCH_LIMIT)
    .all<{ id: string }>();

  const ids = (page.results ?? []).map((r) => r.id);
  result.scanned = ids.length;

  for (const id of ids) {
    try {
      // Считаем заранее — после удаления строк уже не посчитать.
      const counts = await db
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM form_answers
               WHERE response_id IN (SELECT id FROM form_responses WHERE form_id = ?1)) AS answers,
             (SELECT COUNT(*) FROM form_responses WHERE form_id = ?1) AS responses`,
        )
        .bind(id)
        .first<{ answers: number; responses: number }>();

      // Порядок: ответы на задания → ответы → флаг. Флаг ставится ПОСЛЕДНИМ:
      // если процесс умрёт на середине, форма не будет помечена очищенной и
      // следующий прогон её подберет.
      await db
        .prepare(
          `DELETE FROM form_answers
            WHERE response_id IN (SELECT id FROM form_responses WHERE form_id = ?1)`,
        )
        .bind(id)
        .run();
      await db.prepare(`DELETE FROM form_responses WHERE form_id = ?1`).bind(id).run();
      await db.prepare(`UPDATE forms SET responses_purged = 1 WHERE id = ?1`).bind(id).run();

      result.answersDeleted += counts?.answers ?? 0;
      result.responsesDeleted += counts?.responses ?? 0;
      result.formsFlagged += 1;
    } catch (e) {
      // Одна битая форма не должна ронять весь проход: логируем и идём дальше.
      result.failed += 1;
      console.error(`[purgeExpiredForms] не удалось очистить форму ${id}`, e);
    }
  }

  return result;
}

