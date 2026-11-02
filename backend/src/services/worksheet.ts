/**
 * Сервисный слой для worksheets — сохранение/чтение сгенерированных листов.
 *
 * Логика:
 *  - saveWorksheet — пишет в таблицу `worksheets` (full payload_json).
 *  - logWorksheetEvent — пишет событие в `events` для аналитики.
 *  - getWorksheetById — читает payload обратно для preview/share.
 */

import type { D1Database } from "@cloudflare/workers-types";
import type { Worksheet, GenerateWorksheetMeta } from "../types";

export async function saveWorksheet(
  db: D1Database,
  params: {
    userId: string | null;
    worksheet: Worksheet;
  },
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT OR REPLACE INTO worksheets
         (id, user_id, subject, grade, topic, difficulty, type, count, title, payload_json, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
    )
    .bind(
      params.worksheet.id,
      params.userId,
      params.worksheet.subject,
      params.worksheet.grade,
      params.worksheet.topic,
      params.worksheet.difficulty,
      "worksheet",
      params.worksheet.tasks.length,
      params.worksheet.title,
      JSON.stringify(params.worksheet),
      now,
    )
    .run();
}

export async function logWorksheetEvent(
  db: D1Database,
  params: {
    userId: string | null;
    worksheet: Worksheet;
    meta: GenerateWorksheetMeta;
  },
): Promise<void> {
  const id = `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO events (id, user_id, name, data_json, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
    .bind(
      id,
      params.userId,
      "worksheet_generated",
      JSON.stringify({
        worksheetId: params.worksheet.id,
        subject: params.worksheet.subject,
        grade: params.worksheet.grade,
        topic: params.worksheet.topic,
        count: params.worksheet.tasks.length,
        model: params.meta.model,
        costUsd: params.meta.costUsd,
        latencyMs: params.meta.latencyMs,
        cached: params.meta.cached,
        generation: params.meta.generation,
      }),
      now,
    )
    .run();
}

/**
 * Прочитать сохранённый лист по id.
 *
 * ─── ЧТО ТУТ ВАЖНО (UL-D08) ─────────────────────────────────────────────────
 * id и createdAt берутся ИЗ СТРОКИ БД, а не из payload. Раньше payload хранил
 * ровно то, что прислал клиент, — без id. Поэтому сохранённый лист нельзя
 * было открыть по ссылке: загрузчик на фронте требует `id` в артефакте и
 * отказывался показывать такой лист («Лист не найден»), хотя строка в базе
 * была.
 *
 * Теперь:
 *   * id строки — авторитетный (клиентский id в payload не доверяем: по нему
 *     нельзя было бы решить, чей это лист);
 *   * createdAt — из строки, если в payload его нет (старые листы);
 *   * всё остальное содержимое и тип артефакта сохраняются как были: план
 *     урока остаётся планом, КТП — КТП.
 *
 * Битый JSON — как и раньше, null: выдумывать артефакт нельзя.
 */
export async function getWorksheetById(
  db: D1Database,
  id: string,
): Promise<Worksheet | null> {
  const row = await db
    .prepare(`SELECT id, payload_json, created_at FROM worksheets WHERE id = ?1`)
    .bind(id)
    .first<{ id: string; payload_json: string; created_at: number }>();
  if (!row) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(row.payload_json);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const stored = payload as Record<string, unknown>;
  const createdAt =
    typeof stored.createdAt === "string" && stored.createdAt
      ? stored.createdAt
      : new Date(row.created_at * 1000).toISOString();

  return { ...stored, id: row.id, createdAt } as unknown as Worksheet;
}

/**
 * Кому принадлежит лист.
 *
 * Нужно для проверки прав на чтение: у сохранённого листа есть владелец,
 * и отдавать его по одной лишь ссылке нельзя. `null` означает «лист создан
 * анонимно» (демо-генерация без входа) — у таких нет персональных данных
 * и чужого владельца, поэтому обращение с ними разбирает роут.
 */
export async function getWorksheetOwnerId(
  db: D1Database,
  id: string,
): Promise<string | null | undefined> {
  const row = await db
    .prepare(`SELECT user_id FROM worksheets WHERE id = ?1`)
    .bind(id)
    .first<{ user_id: string | null }>();
  if (!row) return undefined; // листа нет вообще
  return row.user_id; // строка — владелец, null — анонимный лист
}
