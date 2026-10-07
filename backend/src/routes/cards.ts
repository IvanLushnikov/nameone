/**
 * POST /api/cards/generate — набор карточек для запоминания.
 *
 * Клиент (`src/lib/client/llm.ts`) ждёт:
 *   { ok: true, cardSet: CardSet, meta: {...}, usage: {...} }
 *
 * Форма `CardSetContent` совпадает с `CardSetBody` в `routes/worksheets.ts`, но
 * обратите внимание: карточки фронт через `/api/worksheets/save` НЕ сохраняет
 * (`toSaveInput` в `src/app/constructor/page.tsx` возвращает null для `cards`) —
 * комплект живёт в браузере учителя. Форму всё равно держим совпадающей.
 *
 * Тариф: доступен всем (cards-gen не входит в PLUS_ONLY_TASKS).
 */

import { Hono } from "hono";
import type { AppEnv } from "../types";
import { generateCards } from "../llm";
import {
  ArtifactEnvelope,
  assertArtifactAllowed,
  consumeFreeQuota,
  prepareArtifactGeneration,
} from "./artifact-generate";

export const cardsRouter = new Hono<AppEnv>();

cardsRouter.post("/generate", async (c) => {
  assertArtifactAllowed(c, "cards");

  const prepared = await prepareArtifactGeneration(c, ArtifactEnvelope);

  const result = await generateCards(
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
    cardSet: result.artifact,
    meta: result.meta,
    usage: result.usage,
  });
});

export default cardsRouter;