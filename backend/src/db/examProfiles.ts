/**
 * Профили экзамена (ТЗ-30 AD-5) — длительность варианта по профилю.
 *
 * ─── ЧТО ЗДЕСЬ ЖИВЁТ ───────────────────────────────────────────────────────
 * Одна функция: `getExamMinutes` — «сколько минут длится вариант по этому
 * профилю». Всё остальное сознательно не написано: админки для заведения
 * профилей в этом листе нет, добавление строки делается миграцией или
 * импортом. Лишний код заведения — это лишний способ испортить число, на
 * которое потом опирается учитель, печатая вариант.
 *
 * ─── ПОЧЕМУ ДВА СЛАГА ──────────────────────────────────────────────────────
 * Сначала ищем точный профиль предмета (`ege-math-profile`), потом общий
 * профиль экзамена (`ege`). Так один профиль «ЕГЭ» покрывает английский и
 * биологию, а математика с двумя профилями получает своё время.
 *
 * ─── ПОЧЕМУ FALLBACK, А НЕ ОШИБКА ──────────────────────────────────────────
 * Пустой `exam_profiles` — это нормальное состояние новой базы, а не поломка.
 * Отказывать учителю в варианте из-за отсутствующей справочной строки нельзя,
 * поэтому при отсутствии профиля берётся `DEFAULT_EXAM_MINUTES` (235), и
 * вызывающая сторона знает об этом по `source`.
 *
 * Источник длительности возвращается не для красоты: роут экзамена кладёт его
 * в ответ, и по нему видно, что время взято из профиля, а не из дефолта.
 */

import type { D1Database } from "@cloudflare/workers-types";
import { DEFAULT_EXAM_MINUTES } from "../llm/prompts/exam-gen";

export type ExamSlug = "oge" | "ege";

export interface ExamProfileRow {
  slug: string;
  subject: string;
  minutes: number;
  fgos_profile: string | null;
}

export interface ExamMinutes {
  minutes: number;
  /** Слаг профиля, из которого взято время. null — профиля не было. */
  profileSlug: string | null;
  /** "profile" — из таблицы, "default" — профиля нет. */
  source: "profile" | "default";
}

/**
 * Порядок поиска: профиль предмета → профиль предмета с суффиксом
 * «профильный» → общий профиль экзамена → дефолт.
 *
 * Суффикс `-profile` в середине нужен для математики: у ЕГЭ по математике два
 * профиля (базовый и профильный) с РАЗНОЙ длительностью, и оба называются
 * одним предметом. Без этой строки профильный срез молча получил бы длительность
 * базового — ровно та ошибка, ради устранения которой всё и затевалось.
 *
 * Отсутствие таблицы (миграция ещё не прогнана) и отсутствие строки
 * обрабатываются одинаково и честно: возвращаем дефолт с `source: "default"`,
 * а не роняем генерацию варианта.
 */
export async function getExamMinutes(
  db: D1Database,
  args: { exam: ExamSlug; subject: string },
): Promise<ExamMinutes> {
  const candidates = [
    `${args.exam}-${args.subject}-profile`,
    `${args.exam}-${args.subject}`,
    args.exam,
  ];

  for (const slug of candidates) {
    const row = await db
      .prepare(`SELECT slug, subject, minutes, fgos_profile FROM exam_profiles WHERE slug = ?1`)
      .bind(slug)
      .first<ExamProfileRow>();
    if (row && Number.isInteger(row.minutes) && row.minutes > 0) {
      return { minutes: row.minutes, profileSlug: row.slug, source: "profile" };
    }
  }

  return { minutes: DEFAULT_EXAM_MINUTES, profileSlug: null, source: "default" };
}