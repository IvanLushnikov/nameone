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
import type { Context } from "hono";
import type { CfObject } from "../lib/antifraud";
import type { UsagePlan } from "../services/usage";
import { generateExam } from "../llm";
import {
  guardGeneration,
  consumeGenerationQuota,
  releaseFreeQuotaForGeneration,
} from "../llm/ratelimit";
import { checkExamAnswers, saveExamAttempt } from "../services/exam";
import { BadRequestError, ForbiddenError, PaymentRequiredError } from "../lib/errors";
import type { AppEnv, SubjectSlug, CheckExamRequest } from "../types";

const examsRouter = new Hono<AppEnv>();

function readCf(c: Context<AppEnv>): CfObject | undefined {
  return (c.req.raw as Request & { cf?: CfObject }).cf;
}

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

  // Вариант ОГЭ/ЕГЭ — та же генерация, что и рабочий лист: та же отпечатковая
  // защита и тот же счётчик попыток.
  //
  // Раньше здесь ничего не было, то есть вариант экзамена был единственной
  // ручкой, которая вообще не попадала в лимиты: бесплатная квота её не
  // видела, антифрод по отпечатку не считал всплеск генераций. Решение
  // владельца от 07.10.2026 — все платные вызовы в общей пачке.
  const guard = await guardGeneration({
    db: c.env.DB,
    userId,
    plan: plan as UsagePlan,
    ip,
    userAgent: c.get("userAgent") ?? "",
    cf: readCf(c),
    salt: c.env.FINGERPRINT_SALT ?? "dev-fingerprint-salt",
    challengePassed: Boolean(c.req.header("cf-turnstile-response")),
  });

  try {
    const result = await generateExam(
      { exam: body.exam, subject: body.subject, variantNumber: body.variantNumber, plan, userId, ip },
      c.env,
      c.env.DB,
    );

    // Попытку списываем ПОСЛЕ успеха: упавший вызов провайдера не должен стоить
    // учителю варианта.
    await consumeGenerationQuota(c.env.DB, {
      userId,
      plan: plan as UsagePlan,
      fingerprint: guard.fingerprint,
    });

    return c.json({
      ok: true,
      variant: result.variant,
      meta: result.meta,
    });
  } catch (e) {
    // Занятая попытка возвращается сразу, а не ждёт TTL в 5 минут.
    await releaseFreeQuotaForGeneration(c.env.DB, {
      userId,
      plan: plan as UsagePlan,
      fingerprint: guard.fingerprint,
    }).catch(() => {});
    throw e;
  }
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
