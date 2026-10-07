/**
 * POST /api/ktp/generate — календарно-тематическое планирование на год.
 *
 * Клиент (`src/lib/client/llm.ts`) ждёт:
 *   { ok: true, ktp: Ktp, meta: {...}, usage: {...} }
 *
 * Форма `KtpContent` совпадает с `KtpBody` в `routes/worksheets.ts` — этим же
 * телом фронт сохраняет КТП через POST /api/worksheets/save.
 *
 * Тариф: задача ktp-gen входит в PLUS_ONLY_TASKS (годовой план — самый дорогой
 * документ из пяти), без «Плюса» приходит 402 UPGRADE_REQUIRED.
 */

import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../types";
import { generateKtp } from "../llm";
import {
  ArtifactRequestObject,
  artifactEnvelope,
  assertArtifactAllowed,
  consumeFreeQuota,
  prepareArtifactGeneration,
} from "./artifact-generate";

const KtpEnvelope = artifactEnvelope(
  ArtifactRequestObject.extend({
    /** Учебный год: без него КТП на «ближайший год» не определить. */
    schoolYear: z.string().regex(/^\d{4}\/\d{4}$/).optional(),
  }),
);

export const ktpRouter = new Hono<AppEnv>();

ktpRouter.post("/generate", async (c) => {
  assertArtifactAllowed(c, "ktp");

  const prepared = await prepareArtifactGeneration(c, KtpEnvelope);

  const result = await generateKtp(
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
    ktp: result.artifact,
    meta: result.meta,
    usage: result.usage,
  });
});

export default ktpRouter;