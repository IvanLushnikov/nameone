/**
 * /api/worksheets/* — генерация, валидация и чтение рабочих листов.
 *
 *   POST /api/worksheets/generate   — сгенерировать новый лист (LLM)
 *   POST /api/worksheets/validate   — прогнать валидатор на листе (DeepSeek)
 *   GET  /api/worksheets/:id        — прочитать сохранённый лист (для preview/share)
 *
 * План (free/base/plus) передаётся:
 *  1) В теле запроса (body.plan) — приоритет
 *  2) Из сессии пользователя (users.plan) — если не указан в теле
 *  3) Free по умолчанию
 */

import { Hono, type Context } from "hono";
import type { Env } from "../env";
import { generateWorksheet, validateWorksheet } from "../llm";
import { saveWorksheet, logWorksheetEvent, getWorksheetById } from "../services/worksheet";
import { NotFoundError, BadRequestError } from "../lib/errors";
import type { AppEnv, GenerateWorksheetRequest, Worksheet } from "../types";
import { moderateGenerationRequest } from "../llm/moderation";
import { shortId } from "../lib/shortid";

// Env imported for Hono<AppEnv> type inference compatibility.
void ({} as Env);

const worksheetsRouter = new Hono<AppEnv>();

async function resolvePlan(
  c: Context<AppEnv>,
  bodyPlan: unknown,
): Promise<"free" | "base" | "plus"> {
  if (bodyPlan === "plus" || bodyPlan === "base" || bodyPlan === "free") return bodyPlan;
  const user = c.get("user");
  if (user?.plan) return user.plan;
  return "free";
}

async function resolveUserId(
  c: Context<AppEnv>,
): Promise<string | null> {
  const user = c.get("user");
  if (user?.id) return user.id;
  return null;
}

worksheetsRouter.post("/generate", async (c) => {
  let body: GenerateWorksheetRequest & { plan?: "free" | "base" | "plus" };
  try {
    body = (await c.req.json()) as GenerateWorksheetRequest & { plan?: "free" | "base" | "plus" };
  } catch {
    throw new BadRequestError("Invalid JSON body");
  }

  if (!body.request) throw new BadRequestError("Missing 'request' field");

  // Pre-moderation (defense in depth)
  const mod = moderateGenerationRequest({ subject: body.request.subject, topic: body.request.topic });
  if (!mod.ok) throw new BadRequestError(`Invalid input: ${mod.reason}`);

  const plan = await resolvePlan(c, body.plan);
  const userId = await resolveUserId(c);
  const ip = c.get("ip") ?? "0.0.0.0";

  // Гарантируем, что у worksheet есть id (для будущего save)
  if (!body.request || typeof body.request !== "object") {
    throw new BadRequestError("Invalid 'request' object");
  }

  const result = await generateWorksheet(
    {
      request: body.request,
      plan,
      bypassCache: body.bypassCache ?? false,
      userId,
      ip,
    },
    c.env,
    c.env.DB,
  );

  // Если у worksheet нет id — проставляем наш (для последующего сохранения)
  const worksheet: Worksheet = {
    ...result.worksheet,
    id: result.worksheet.id || `ws_${shortId()}`,
  };

  // Save (await — лучше знать сразу если что-то упало)
  await saveWorksheet(c.env.DB, { userId, worksheet });
  await logWorksheetEvent(c.env.DB, { userId, worksheet, meta: result.meta });

  return c.json({
    ok: true,
    worksheet,
    meta: result.meta,
  });
});

worksheetsRouter.post("/validate", async (c) => {
  let body: { worksheet: Worksheet; context: { subject: string; grade: number; topic: string } };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    throw new BadRequestError("Invalid JSON body");
  }
  if (!body.worksheet || !body.context) throw new BadRequestError("Missing worksheet or context");

  const result = await validateWorksheet({ worksheet: body.worksheet, context: body.context }, c.env, c.env.DB);
  return c.json({
    ok: true,
    score: result.score,
    issues: result.issues,
    meta: result.meta,
  });
});

worksheetsRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const ws = await getWorksheetById(c.env.DB, id);
  if (!ws) throw new NotFoundError("Worksheet not found");
  return c.json({ ok: true, worksheet: ws });
});

export { worksheetsRouter };
