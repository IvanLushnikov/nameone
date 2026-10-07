/**
 * POST /api/materials/generate — комплект раздаточных материалов.
 *
 * Клиент (`src/lib/client/llm.ts`) ждёт:
 *   { ok: true, materialBundle: MaterialBundle, meta: {...}, usage: {...} }
 *
 * Форма `MaterialBundleContent` совпадает с тем, что фронт кладёт в ZIP: файлы
 * со `kind` и `format` из `MaterialFile`. Как и карточки, комплект фронт через
 * `/api/worksheets/save` НЕ сохраняет — он живёт в браузере учителя.
 *
 * Тариф: доступен всем (материалы идут задачей worksheet-gen — это дешёвый
 * класс документа, отдельной GenerationKind для них нет; см. ARTIFACT_TASK).
 */

import { Hono } from "hono";
import type { AppEnv } from "../types";
import { generateMaterials } from "../llm";
import {
  ArtifactEnvelope,
  assertArtifactAllowed,
  consumeFreeQuota,
  prepareArtifactGeneration,
} from "./artifact-generate";

export const materialsRouter = new Hono<AppEnv>();

materialsRouter.post("/generate", async (c) => {
  assertArtifactAllowed(c, "materials");

  const prepared = await prepareArtifactGeneration(c, ArtifactEnvelope);

  const result = await generateMaterials(
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
    materialBundle: result.artifact,
    meta: result.meta,
    usage: result.usage,
  });
});

export default materialsRouter;