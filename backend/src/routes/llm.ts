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

const llmRouter = new Hono<{ Bindings: Env }>();

llmRouter.get("/models", (c) => {
  const models = availableModels(c.env);
  return c.json({ ok: true, models });
});

const embedSchema = z.object({
  texts: z.array(z.string().min(1).max(8000)).min(1).max(100),
});

llmRouter.post("/embeddings", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new BadRequestError("Invalid JSON body");
  }
  const { texts } = embedSchema.parse(body);
  const result = await embed({ texts }, c.env);
  return c.json({
    ok: true,
    vectors: result.vectors,
    model: result.model,
    costUsd: result.costUsd,
  });
});

export { llmRouter };
