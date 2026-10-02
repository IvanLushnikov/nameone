/**
 * /api/llm/* — публичный LLM-info для фронта.
 *
 *   GET  /api/llm/models      — список доступных моделей (по наличию ключей в env)
 *   POST /api/llm/embeddings  — проксирование embeddings-запроса
 *
 * Эндпоинты не требуют auth (для /models это UI-info, для /embeddings —
 * только анонимный публичный доступ, rate-limit в будущем).
 */

import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env";
import { availableModels } from "../llm/config";
import { embed } from "../llm";
import { BadRequestError } from "../lib/errors";
import { rateLimitMiddleware } from "../middleware/ratelimit";

const llmRouter = new Hono<{ Bindings: Env }>();

llmRouter.get("/models", (c) => {
  const models = availableModels(c.env);
  return c.json({ ok: true, models });
});

const embedSchema = z.object({
  texts: z.array(z.string().min(1).max(8000)).min(1).max(100),
});

/**
 * Лимит на эмбеддинги.
 *
 * Ручка анонимная — иначе фронт не сможет считать похожесть до входа в ЛК.
 * Но без лимита это готовая точка расхода: любой может дёргать платный
 * эмбеддинг-эндпоинт нашего провайдера сколько угодно раз.
 * 60 запросов в час на IP с запасом перекрывает нормальное использование
 * (кегль в UI) и не даёт опустошить счёт.
 */
const embedLimit = rateLimitMiddleware({
  limit: 60,
  windowSec: 3600,
  bucket: "embeddings",
});

llmRouter.post("/embeddings", embedLimit, async (c) => {
  let textsBody: unknown;
  try {
    textsBody = await c.req.json();
  } catch {
    throw new BadRequestError("Invalid JSON body");
  }
  const { texts } = embedSchema.parse(textsBody);
  const result = await embed({ texts }, c.env);
  return c.json({
    ok: true,
    vectors: result.vectors,
    model: result.model,
    // costUsd наружу не отдаём: это внутренняя метрика расхода на провайдера,
    // наружу она ничего полезного не даёт, но показывает постороннему, сколько
    // мы тратим и сколько он «накрутил».
  });
});

export { llmRouter };
