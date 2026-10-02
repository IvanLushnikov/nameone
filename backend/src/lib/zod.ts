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

export const planSchema = z.enum(["free", "base", "plus"]);

export const periodSchema = z.enum(["monthly", "academicYear"]);

// ─────────────────────────────────────────────────────────────────────────────
// Составные схемы
// ─────────────────────────────────────────────────────────────────────────────

export const worksheetTaskSchema = z.object({
  number: z.number().int().positive(),
  text: z.string().min(1),
  type: z.enum(["computation", "multiple-choice", "short-answer", "essay", "fill-blank"]),
  options: z.array(z.string()).optional(),
  answer: z.string().optional(),
  explanation: z.string().optional(),
  points: z.number().int().nonnegative(),
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
  plan: z.enum(["base", "plus"]),
  period: periodSchema,
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
