/**
 * POST /api/presentations/generate — презентация к уроку.
 *
 * Клиент (`src/lib/client/llm.ts`) ждёт:
 *   { ok: true, presentation: Presentation, meta: {...}, usage: {...} }
 *
 * Форма `PresentationContent` совпадает с `PresentationBody` в
 * `routes/worksheets.ts` — этим же телом фронт сохраняет презентацию через
 * POST /api/worksheets/save.
 *
 * Тариф: задача presentation-gen входит в PLUS_ONLY_TASKS, поэтому без «Плюса»
 * приходит 402 UPGRADE_REQUIRED. Тип артефакта берётся из эндпоинта, а не из
 * `request.type` в теле: подменив его, можно было бы получить Sonnet по цене
 * Luna.
 */

import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../types";
import { generatePresentation } from "../llm";
import {
  ArtifactRequestObject,
  artifactEnvelope,
  assertArtifactAllowed,
  consumeFreeQuota,
  prepareArtifactGeneration,
} from "./artifact-generate";

const PresentationEnvelope = artifactEnvelope(
  ArtifactRequestObject.extend({
    /** Сколько слайдов просят: ровно эти четыре значения понимает экспортёр. */
    slideCount: z
      .union([z.literal(5), z.literal(10), z.literal(15), z.literal(20)])
      .optional(),
  }),
);

export const presentationsRouter = new Hono<AppEnv>();

presentationsRouter.post("/generate", async (c) => {
  assertArtifactAllowed(c, "presentation");

  const prepared = await prepareArtifactGeneration(c, PresentationEnvelope);

  const result = await generatePresentation(
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
    presentation: result.artifact,
    meta: result.meta,
    usage: result.usage,
  });
});

export default presentationsRouter;