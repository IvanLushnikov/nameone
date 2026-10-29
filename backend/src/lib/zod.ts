/**
 * Общие zod-схемы для валидации API-входа.
 *
 * Полная синхронизация с front: src/lib/types.ts — SubjectSlug / Difficulty / TaskType /
 * GenerationRequest.
 *
 * zod-валидация в роутах:
 *   const body = generationRequestSchema.parse(await c.req.json());
 *
 * Ошибки zod ловятся в error middleware и отдаются как 400 + details.
 */

import { z } from "zod";

/**
 * ТЗ-33: перечень типов заданий — из общего реестра.
 *
 * Реестр лежит во фронте, но это ЕДИНЫЙ источник истины: бэк проверяет
 * ответ модели по нему же, по нему же собирается промпт. Импорт относительный,
 * внешних зависимостей не добавляет.
 */
import { TASK_TYPE_IDS } from "../../../src/lib/content/task-types";
// ─────────────────────────────────────────────────────────────────────────────
// Примитивы
// ─────────────────────────────────────────────────────────────────────────────

export const subjectSlugSchema = z.enum([
  "math",
  "algebra",
  "geometry",
  "russian",
  "literature",
  "english",
  "german",
  "informatics",
  "physics",
  "chemistry",
  "biology",
  "geography",
  "history",
  "social",
  "okruzhaet",
  "obzh",
  "technology",
  "finance",
  "music",
  "art",
  "pe",
]);

export const difficultySchema = z.enum(["easy", "medium", "hard"]);

export const taskTypeSchema = z.enum([
  "worksheet",
  "test",
  "cards",
  "control",
  "oge",
  "ege",
]);

export const planSchema = z.enum(["free", "base", "standard", "plus"]);

export const periodSchema = z.enum(["monthly", "academicYear"]);

// ─────────────────────────────────────────────────────────────────────────────
// Составные схемы
// ─────────────────────────────────────────────────────────────────────────────

export const worksheetTaskSchema = z.object({
  number: z.number().int().positive(),
  text: z.string().min(1),
  /**
   * ТЗ-33: типы заданий — из общего реестра, а не из зашитого списка.
   * Значение вне реестра отбрасывается здесь же (400), а не падает в 500
   * на сервере генерации.
   */
  type: z.enum(TASK_TYPE_IDS as [string, ...string[]]),
  options: z.array(z.string()).optional(),
  answer: z.string().optional(),
  explanation: z.string().optional(),
  points: z.number().int().nonnegative(),
  /** ТЗ-33: разобранный образец для типа `pattern`. */
  sample: z.string().max(4000).nullish(),
  /** ТЗ-33: таблица в задании (тип `table-task`). */
  table: z
    .object({
      headers: z.array(z.string().max(500)).max(20),
      rows: z.array(z.array(z.string().max(500)).max(20)).max(50),
    })
    .nullish(),
  /** ТЗ-33: элементы задания (sequence, classification, matching, compare). */
  items: z.array(z.string().max(1000)).max(50).nullish(),
  /** ТЗ-33: критерии приёмки (essay, open-ended, practical). */
  criteria: z.array(z.string().max(1000)).max(20).nullish(),
  /** ТЗ-33: шаги алгоритма (practical). */
  steps: z.array(z.string().max(1000)).max(30).nullish(),
});

/**
 * ТЗ-34: блок `evaluation` — контракт критериев оценивания.
 *
 * Две схемы, потому что это ДВА разных объекта:
 *
 *   · `modelEvaluationSchema` — то, что присылает МОДЕЛЬ: типичные ошибки по
 *     теме и рекомендация учителю. Баллов, отметок и процентов в нём нет и
 *     быть не должно: их считает сервер.
 *   · `evaluationPartSchema` — то, что уходит УЧИТЕЛЮ: критерии по заданиям,
 *     максимальный балл из реестра типов, сумма баллов и шкала отметок.
 *
 * Критерии в ответе API СОБИРАЮТСЯ из `task.criteria` (у каждого задания
 * своё поле), а не приходят вторым ответом модели. Поэтому второй носитель
 * одних и тех же данных не появится: разойтись им не с чем.
 */
export const modelEvaluationSchema = z.object({
  typicalMistakes: z.array(z.string().max(1000)).max(20).default([]),
  recommendation: z.string().max(2000).nullish(),
});

export const evaluationCriterionSchema = z.object({
  /** Номер задания в работе (номер ставит сервер). */
  number: z.number().int().positive(),
  /** Конкретные критерии приёмки. */
  criteria: z.array(z.string().max(1000)).max(20),
  /** Максимальный балл за задание — из реестра типов, не от модели. */
  maxPoints: z.number().int().nonnegative(),
});

export const evaluationMarkSchema = z.object({
  mark: z.number().int().min(2).max(5),
  fromPercent: z.number().min(0).max(100),
  toPercent: z.number().min(0).max(100),
});

export const evaluationPartSchema = z.object({
  /** Номер варианта: 1 — лист или тест, 1 и 2 — варианты контрольной. */
  variant: z.number().int().positive(),
  title: z.string().max(500),
  criteria: z.array(evaluationCriterionSchema).max(60),
  typicalMistakes: z.array(z.string().max(1000)).max(20),
  recommendation: z.string().max(2000).nullish(),
  /** Сумма максимальных баллов по всем заданиям работы. */
  totalMaxPoints: z.number().int().nonnegative(),
  /** Шкала отметок 5/4/3/2. */
  marks: z.array(evaluationMarkSchema).max(4),
});

export const generationRequestSchema = z.object({
  subject: subjectSlugSchema,
  grade: z.number().int().min(1).max(11),
  topic: z.string().min(1).max(200),
  difficulty: difficultySchema,
  count: z.number().int().min(1).max(50),
  type: taskTypeSchema,
  withAnswers: z.boolean(),
  withExplanations: z.boolean(),
});

export const generateWorksheetRequestSchema = z.object({
  request: generationRequestSchema,
  bypassCache: z.boolean().optional(),
});

export const magicLinkEmailSchema = z.string().email().max(254);

export const magicLinkRequestSchema = z.object({
  email: magicLinkEmailSchema,
});

export const paginationSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

export const createPaymentRequestSchema = z.object({
  plan: z.enum(["base", "standard", "plus"]),
  period: periodSchema,
  /**
   * Согласие учителя на безакцептные списания (ТЗ-20).
   *
   * Поле опциональное именно потому, что по умолчанию согласия нет: пока
   * переключателя в интерфейсе нет, фронт его не присылает, и `createPayment`
   * не передаёт в ЮKassa `save_payment_method`. Оплата остаётся разовой.
   *
   * `true` имеет смысл ТОЛЬКО для периода «месяц»: учебный год продлевать
   * не нужно (ТЗ-20 §2.6), и сервис согласие для него проигнорирует.
   */
  autoRenew: z.boolean().optional(),
});

/**
 * Ручные отметки учителя после проверки по фото (ТЗ-19).
 *
 * Потолок 200 отметок в теле — предохранитель от кривого клиента: у листа
 * максимум 40 заданий (см. routes/f06.ts MAX_TASKS), а 200 взяты с запасом на
 * то, что учитель сохранит несколько работ подряд одной пачкой. Больше — это
 * уже не человек нажимает «Сохранить отметки», а что-то сломалось.
 *
 * `points` — целое неотрицательное; в 0..maxPoints его клампит чистый модуль
 * слияния, потому что maxPoints жив в photo_check_items, а не в теле запроса.
 * `accepted: false` там же даёт 0 независимо от присланного балла.
 */
export const manualMarksRequestSchema = z.object({
  marks: z
    .array(
      z.object({
        taskNumber: z.number().int().positive(),
        accepted: z.boolean(),
        // Необязателен (ТЗ-19 §2): «зачтено» без балла = полный балл задания.
        // Пустое значение — не «ноль», это «учитель не думал о балле».
        points: z.number().int().nonnegative().optional(),
      }),
    )
    .min(1, "Передайте хотя бы одну отметку")
    .max(200, "За один раз сохраняем до 200 отметок"),
});

// ─────────────────────────────────────────────────────────────────────────────
// Inferred TS-типы (для удобства — не дублируем руками)
// ─────────────────────────────────────────────────────────────────────────────

export type SubjectSlugInput = z.infer<typeof subjectSlugSchema>;
export type GenerationRequestInput = z.infer<typeof generationRequestSchema>;
export type GenerateWorksheetRequestInput = z.infer<typeof generateWorksheetRequestSchema>;
export type MagicLinkRequestInput = z.infer<typeof magicLinkRequestSchema>;
export type PaginationInput = z.infer<typeof paginationSchema>;
export type CreatePaymentRequestInput = z.infer<typeof createPaymentRequestSchema>;
export type ManualMarksRequestInput = z.infer<typeof manualMarksRequestSchema>;
