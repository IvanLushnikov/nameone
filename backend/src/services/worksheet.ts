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

export async function getWorksheetById(
  db: D1Database,
  id: string,
): Promise<Worksheet | null> {
  const row = await db
    .prepare(`SELECT payload_json FROM worksheets WHERE id = ?1`)
    .bind(id)
    .first<{ payload_json: string }>();
  if (!row) return null;
  try {
    return JSON.parse(row.payload_json) as Worksheet;
  } catch {
    return null;
  }
}
