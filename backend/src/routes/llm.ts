/**
 * /api/llm/* — публичный LLM-info и платные вызовы для фронта.
 *
 *   GET  /api/llm/models      — список доступных моделей (по наличию ключей в env)
 *   POST /api/llm/embeddings  — проксирование embeddings-запроса
 *   POST /api/llm/verify      — двухпроходная проверка задания (F-05-B)
 *
 * Эндпоинты не требуют auth (для /models это UI-info, /embeddings и /verify —
 * только анонимный публичный доступ, у обоих rate-limit).
 */

import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../types";
import { availableModels } from "../llm/config";
import { embed, verifySelfTask } from "../llm";
import { BadRequestError } from "../lib/errors";
import { rateLimitMiddleware } from "../middleware/ratelimit";

// AppEnv, а не { Bindings: Env }: /verify читает тариф из сессии (c.get("user")).
const llmRouter = new Hono<AppEnv>();

/**
 * GET /api/llm/models — что видит клиент.
 *
 * Раньше ручка отдавала анонимно весь MODEL_CATALOG целиком: и модели, которых
 * нет в роутинге, и их внутренние имена, и эмбеддинги, которые клиент не
 * выбирает. Это утечка конфигурации: посторонний видел, какие модели у нас
 * есть и какие у них провайдерские имена (BL-13).
 *
 * Теперь наружу уходит только список моделей, доступных учителю как выбор, —
 * без внутренних имён и без признаков наличия ключей. Эмбеддинги из ответа
 * убраны: это служебные модели, клиент их не выбирает.
 */
const CLIENT_VISIBLE_MODELS = [
  "gpt-6-luna",
  "gpt-6-sol",
  "claude-sonnet-5-5",
] as const;

llmRouter.get("/models", (c) => {
  const available = availableModels(c.env);
  const models = CLIENT_VISIBLE_MODELS.filter((m) =>
    available.includes(m as string)
  );
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
 *
 * 06.10.2026 лимит снижен с 60 до 20 запросов в час, потому что тело запроса
 * ограничено 100 текстами × 8000 символов (≈265k токенов). По реальному прайсу
 * polza это до ~4 ₽ за один запрос, то есть старые 60/час давали ~250 ₽ в час
 * с одного адреса, и расхода этого не было видно НИГДЕ — ни в норме, ни в
 * отчёте (см. комментарий в llm/index.ts → embed).
 *
 * 20/час с запасом перекрывает нормальное использование (кегль в UI) и
 * оставляет одну явно видимую точку, где расход уже посчитан.
 */
const embedLimit = rateLimitMiddleware({
  limit: 20,
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

  // Тариф — из сессии, не из тела запроса (то же правило, что в /verify).
  const user = c.get("user");
  const result = await embed(
    {
      texts,
      userId: user?.id ?? null,
      plan: user?.plan ?? "free",
    },
    c.env,
    c.env.DB,
  );
  return c.json({
    ok: true,
    vectors: result.vectors,
    model: result.model,
    // costUsd наружу не отдаём: это внутренняя метрика расхода на провайдера,
    // наружу она ничего полезного не даёт, но показывает постороннему, сколько
    // мы тратим и сколько он «накрутил». Внутри вызов УЖЕ записан в llm_logs
    // и в норму платного тарифа — то есть расход стал видимым там, где нужен.
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /verify — двухпроходная проверка одного задания (F-05-B)
// ─────────────────────────────────────────────────────────────────────────────

const verifySchema = z.object({
  subject: z.string().min(1).max(120),
  grade: z.number().int().min(1).max(11),
  topic: z.string().min(1).max(200),
  task: z.object({
    text: z.string().min(1).max(8000),
    expectedAnswer: z.string().max(4000).optional(),
  }),
});

/**
 * Лимит на self-verify.
 *
 * Ручка анонимная и платная: один запрос = ДВА вызова LLM (solve + verify).
 * Учебный сценарий — учитель генерирует лист, и проверка зовётся по разу на
 * КАЖДОЕ задание (src/lib/mock/generator.ts), то есть 10-20 запросов на лист.
 * Отсюда 200 запросов в час на IP: это ~10-20 листов в час с одного адреса —
 * с запасом перекрывает и учителя за одним NAT в школе, и несколько вкладок,
 * но не даёт перебрать счёт (2 × 200 вызовов самой дешёвой модели в час).
 *
 * Почему не бесплатная квота из llm/ratelimit.ts: она даёт 3 генерации всего
 * на IP, а здесь проверка идёт по каждому заданию — лимит выключил бы
 * проверку на третьем задании листа, и это выглядело бы как «проверка не
 * работает», а не как «лимит исчерпан».
 */
const verifyLimit = rateLimitMiddleware({
  limit: 200,
  windowSec: 3600,
  bucket: "self-verify",
});

llmRouter.post("/verify", verifyLimit, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new BadRequestError("Invalid JSON body");
  }
  const parsed = verifySchema.parse(body);

  // Тариф — ТОЛЬКО из сессии (то же правило, что в routes/worksheets.ts):
  // клиент присылает план в теле запроса только для баланса нормы.
  const user = c.get("user");
  const plan = user?.plan ?? "free";

  const result = await verifySelfTask(
    {
      task: {
        subject: parsed.subject,
        grade: parsed.grade,
        topic: parsed.topic,
        text: parsed.task.text,
        expectedAnswer: parsed.task.expectedAnswer,
      },
      userId: user?.id ?? null,
      plan,
    },
    c.env,
    c.env.DB,
  );

  // Контракт ответа — ровно тот, что ждёт фронт (src/lib/llm/self-verify.ts).
  // `mock: false` здесь не украшение: клиент по нему отличает настоящую
  // проверку от подставной. Подставной проверки на бэкенде не существует —
  // при отсутствии ключа эндпоинт отвечает 503, и фронт показывает «не проверено».
  return c.json({
    ok: true,
    verified: result.verified,
    answer: result.answer,
    explanation: result.explanation,
    latency_ms: result.latencyMs,
    model: result.model,
    mock: false,
  });
});

export { llmRouter };
