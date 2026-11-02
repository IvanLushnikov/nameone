/**
 * Схемы рабочего листа — общие для генерации и избранного.
 *
 * Задача ТЗ-37b / находка №4 ревью безопасности 30.10.2026: тело
 * `POST /api/users/favorites` принималось как есть (`as { worksheet: Worksheet }`),
 * и запрос без `tasks` падал в 500 на `worksheet.tasks.length`. Теперь тело
 * проверяется схемой, и мусор получает 400, а не 500.
 *
 * Схема задания живёт здесь, а не в `routes/worksheets.ts`, потому что её
 * используют два роута: генерация (`POST /api/worksheets/generate`) и
 * избранное (`POST /api/users/favorites`). Дублировать её в двух местах —
 * значит через месяц забыть обновить в одном из них.
 */
import { z } from "zod";
// Реестр типов задания живёт на фронте (общий контракт для обеих сторон).
import { TASK_TYPE_IDS } from "../../../src/lib/content/task-types";

/**
 * Одно задание рабочего листа.
 *
 * Расширения сверх базового набора:
 *   - verified/verifiedExplanation — опциональные поля per-task (Ф-05-Б);
 *   - sample/table/items/criteria/steps — поля новых типов задания (ТЗ-33).
 *     Они необязательные: старые листы приходят без них и принимаются как
 *     раньше.
 */
export const worksheetTaskSchema = z.object({
  number: z.number().int().positive(),
  text: z.string().min(1).max(2000),
  // LaTeX-версия задания: та же формула вертикально, в $...$. Без неё дробь
  // на листе печатается в одну строку. Поле необязательное.
  text_latex: z.string().max(4000).nullish(),
  type: z.enum(TASK_TYPE_IDS as [string, ...string[]]),
  options: z.array(z.string().max(500)).max(20).optional(),
  answer: z.string().max(2000).optional(),
  explanation: z.string().max(2000).optional(),
  points: z.number().int().nonnegative().max(100),
  verified: z.union([z.boolean(), z.null()]).optional(),
  verifiedExplanation: z.string().max(2000).optional(),
  // ТЗ-27: метка темы у задания («Давление твёрдых тел») — по ней считается
  // блок «Темы, где просели» в ведомости.
  skill: z.string().max(200).nullish(),
  sample: z.string().max(4000).nullish(),
  table: z
    .object({
      headers: z.array(z.string().max(500)).max(20),
      rows: z.array(z.array(z.string().max(500)).max(20)).max(50),
    })
    .nullish(),
  items: z.array(z.string().max(1000)).max(50).nullish(),
  criteria: z.array(z.string().max(1000)).max(20).nullish(),
  steps: z.array(z.string().max(1000)).max(30).nullish(),
});

/**
 * Тело `POST /api/users/favorites`.
 *
 * Отличается от тела генерации:
 *   - обёртка `worksheet` (в генерации — плоский объект с `type`);
 *   - `id` и `createdAt` необязательны: лист может прийти из избранного
 *     другого устройства, и id тогда сгенерируется на сервере;
 *   - `type` не проверяется: фронт кладёт в избранное только те артефакты,
 *     у которых есть `tasks`, то есть листы.
 *
 * ВАЖНО: схема не должна срезать поля, которые фронт кладёт в лист. zod
 * по умолчанию выбрасывает неизвестные ключи, а payload_json потом читается
 * обратно — и потерянное поле теряется навсегда. Поэтому `text_latex`,
 * `skill`, `chartSpec` и `isDemo` перечислены явно.
 */
export const favoriteBodySchema = z.object({
  worksheet: z.object({
    id: z.string().max(64).optional().default(""),
    title: z.string().max(200).optional().default(""),
    subject: z.string().min(1).max(64),
    grade: z.number().int().min(1).max(11),
    topic: z.string().min(1).max(200),
    difficulty: z.enum(["easy", "medium", "hard"]),
    tasks: z.array(worksheetTaskSchema).min(1).max(100),
    createdAt: z.string().max(64).optional(),
    variant: z.enum(["A", "B"]).optional(),
    // Спецификация SVG-графика (Phase 1 roadmap). Схему не описываем: она
    // живёт на фронте и меняется вместе с рендерером, а нам нужно только
    // сохранить её как есть.
    chartSpec: z.unknown().optional(),
    // Заготовка: сервис был недоступен, задания типовые. Едет вместе с
    // артефактом в избранное и в ЛК — нужен для водяного знака на листе.
    isDemo: z.boolean().optional(),
  }),
});
