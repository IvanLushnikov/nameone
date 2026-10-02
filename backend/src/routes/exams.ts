/**
 * /api/exams/* — генерация вариантов ОГЭ/ЕГЭ + проверка ответов.
 *
 *   POST /api/exams/generate — сгенерировать вариант (Sonnet 5.5 по тарифу «Плюс»)
 *   POST /api/exams/check    — проверить ответы пользователя (детерминированный чек)
 *
 * Тариф — только из сессии: клиентский `plan` в теле запроса игнорируется
 * (он определял модель LLM, то есть стоимость обслуживания).
 */

import { Hono } from "hono";
import { z } from "zod";
import { generateExam } from "../llm";
import { checkExamAnswers, saveExamAttempt } from "../services/exam";
import { BadRequestError, ForbiddenError, PaymentRequiredError } from "../lib/errors";
import type { AppEnv, SubjectSlug, CheckExamRequest } from "../types";

const examsRouter = new Hono<AppEnv>();

const generateSchema = z.object({
  exam: z.enum(["oge", "ege"]),
  subject: z.string().min(1) as z.ZodType<SubjectSlug>,
  variantNumber: z.number().int().min(1).max(999),
});

examsRouter.post("/generate", async (c) => {
  let body: z.infer<typeof generateSchema>;
  try {
    body = generateSchema.parse({ ...((await c.req.json()) as object) });
  } catch (e) {
    throw new BadRequestError("Invalid body", { zodError: String(e).slice(0, 200) });
  }

  // Ученик решает выданное, но не генерирует (тариф «Школа», Q1 2027).
  if (c.get("user")?.role === "student") {
    throw new ForbiddenError("Ученикам генерация материалов недоступна", {
      code: "GENERATION_FORBIDDEN",
    });
  }

  // Варианты ОГЭ/ЕГЭ — премиум-тип, входят только в «Плюс» (см. PLUS_ONLY_TASKS).
  const plan = c.get("user")?.plan ?? "free";
  if (plan !== "plus") {
    throw new PaymentRequiredError("Варианты ОГЭ/ЕГЭ входят в тариф «Плюс»", {
      code: "UPGRADE_REQUIRED",
      task: "exam-gen",
    });
  }

  const userId = c.get("user")?.id ?? null;
  const ip = c.get("ip") ?? "0.0.0.0";

  const result = await generateExam(
    { exam: body.exam, subject: body.subject, variantNumber: body.variantNumber, plan, userId, ip },
    c.env,
    c.env.DB,
  );

  return c.json({
    ok: true,
    variant: result.variant,
    meta: result.meta,
  });
});

examsRouter.post("/check", async (c) => {
  let body: CheckExamRequest;
  try {
    body = (await c.req.json()) as CheckExamRequest;
  } catch {
    throw new BadRequestError("Invalid JSON body");
  }
  if (!body.problems || !body.answers) throw new BadRequestError("Missing problems or answers");

  const result = checkExamAnswers({ problems: body.problems, answers: body.answers });

  // Save attempt (optional — для аналитики)
  const userId = c.get("user")?.id ?? null;
  await saveExamAttempt(c.env.DB, {
    userId,
    examId: `exam_${Date.now().toString(36)}`,
    exam: body.problems[0]?.number ? "oge" : "ege",
    subject: "unknown",
    score: result.score,
    maxScore: result.maxScore,
    perProblem: result.perProblem,
  });

  return c.json({
    ok: true,
    score: result.score,
    maxScore: result.maxScore,
    perProblem: result.perProblem,
  });
});

export { examsRouter };
