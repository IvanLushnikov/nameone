/**
 * POST /api/lesson-plans/generate — план урока по ФГОС.
 *
 * Клиент (`src/lib/client/llm.ts`) ждёт:
 *   { ok: true, lessonPlan: LessonPlan, meta: {...}, usage: {...} }
 * и читает ключ `lessonPlan`; если ключа нет, фронт молча рисует типовую
 * заготовку — поэтому ключ в ответе обязателен всегда.
 *
 * Форма `LessonPlanContent` совпадает с `LessonPlanBody` в
 * `routes/worksheets.ts`: этим же телом фронт сохраняет план через
 * POST /api/worksheets/save.
 *
 * Тариф: доступен всем (задача lesson-plan-gen не входит в PLUS_ONLY_TASKS).
 */

import { Hono } from "hono";
import type { AppEnv } from "../types";
import { generateLessonPlan } from "../llm";
import {
  ArtifactEnvelope,
  assertArtifactAllowed,
  consumeFreeQuota,
  prepareArtifactGeneration,
} from "./artifact-generate";

export const lessonPlansRouter = new Hono<AppEnv>();

lessonPlansRouter.post("/generate", async (c) => {
  // Тип артефакта — из эндпоинта: подменить его полем `request.type` из
  // браузера нельзя, иначе «Базовый» получил бы генерацию «Плюса».
  assertArtifactAllowed(c, "lesson-plan");

  const prepared = await prepareArtifactGeneration(c, ArtifactEnvelope);

  const result = await generateLessonPlan(
    {
      request: prepared.request,
      plan: prepared.plan,
      bypassCache: prepared.bypassCache,
      userId: prepared.userId,
      ip: prepared.ip,
    },
    c.env,
    c.env.DB,
  );

  await consumeFreeQuota(c, prepared);

  return c.json({
    ok: true as const,
    lessonPlan: result.artifact,
    meta: result.meta,
    usage: result.usage,
  });
});

export default lessonPlansRouter;