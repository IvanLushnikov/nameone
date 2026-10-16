/**
 * Общая часть пяти роутов генерации: план урока, презентация, КТП, карточки,
 * материалы. Каждый тип — отдельный файл (`routes/<name>.ts`), потому что у них
 * разный ключ ответа, разная zod-схема запроса и своя функция генерации. Общее
 * вынесено сюда, чтобы не расходились пять копий одного и того же:
 *   1. разбор и валидация тела запроса,
 *   2. pre-moderation,
 *   3. проверка роли и тарифа,
 *   4. антифрод + бесплатная квота,
 *   5. списание квоты ПОСЛЕ успешной генерации.
 *
 * ПОЧЕМУ ЗДЕСЬ ДУБЛИРУЮТСЯ ХЕЛПЕРЫ ИЗ routes/worksheets.ts
 *
 * `resolvePlan` / `assertCanGenerate` / `assertTaskAllowed` / `resolveUserId` /
 * `readCf` живут в worksheets.ts как приватные функции и не экспортируются.
 * Правкой worksheets.ts этот этап не занимался, поэтому копия здесь намеренная.
 * Копии помечены ссылкой на оригинал: если правила разъедутся, это будет видно
 * по этим комментариям. Правило одно и то же — тариф берётся ТОЛЬКО из сессии,
 * значение `plan` из тела запроса игнорируется.
 */

import type { Context } from "hono";
import { z } from "zod";
import type { AppEnv } from "../types";
import type { UsagePlan } from "../services/usage";
import {
  BadRequestError,
  ForbiddenError,
  PaymentRequiredError,
} from "../lib/errors";
import type { CfObject } from "../lib/antifraud";
import { moderateGenerationRequest } from "../llm/moderation";
import { taskForArtifact, PLUS_ONLY_TASKS } from "../llm/router";
import { guardGeneration, consumeGenerationQuota } from "../llm/ratelimit";
import type { ArtifactRequest } from "../llm/prompts/artifact-gen";

// ─────────────────────────────────────────────────────────────────────────────
// Копии приватных хелперов routes/worksheets.ts (см. шапку файла)
// ─────────────────────────────────────────────────────────────────────────────

/** Тариф берётся ТОЛЬКО из сессии. Оригинал: routes/worksheets.ts:resolvePlan. */
function resolvePlan(c: Context<AppEnv>): UsagePlan {
  return c.get("user")?.plan ?? "free";
}

/** Ученикам генерация не выдаётся. Оригинал: routes/worksheets.ts:assertCanGenerate. */
function assertCanGenerate(c: Context<AppEnv>): void {
  if (c.get("user")?.role === "student") {
    throw new ForbiddenError("Ученикам генерация материалов недоступна", {
      code: "GENERATION_FORBIDDEN",
    });
  }
}

/**
 * Право на премиум-типы (КТП, презентации) — единственное, где тариф влияет на
 * генерацию. Модель от тарифа не зависит (см. router.ts), поэтому «Базовый»
 * получает честный 402, а не тихую генерацию на дешёвой модели.
 *
 * Тип артефакта берётся ИЗ ЭНДПОИНТА, а не из тела запроса: `POST
 * /api/ktp/generate` — это КТП по определению, и подменить его значением
 * `request.type` из браузера нельзя.
 */
function assertTaskAllowed(c: Context<AppEnv>, artifactType: string): void {
  const task = taskForArtifact(artifactType);
  if (!PLUS_ONLY_TASKS.has(task)) return;
  if (resolvePlan(c) === "plus") return;
  throw new PaymentRequiredError("Этот тип материала входит в тариф «Плюс»", {
    code: "UPGRADE_REQUIRED",
    task,
  });
}

/**
 * Проверка тарифа для конкретного эндпоинта. Вызывается роутом ДО
 * `prepareArtifactGeneration`: чтобы 402 возвращался раньше, чем антифрод
 * запишет визит в базу (не платный учитель не должен оставлять след в
 * антифрод-счётчиках такого же, как платный).
 */
export function assertArtifactAllowed(c: Context<AppEnv>, artifactType: string): void {
  assertTaskAllowed(c, artifactType);
}

function resolveUserId(c: Context<AppEnv>): string | null {
  return c.get("user")?.id ?? null;
}

/** Данные Cloudflare о клиенте для отпечатка. Оригинал: routes/worksheets.ts:readCf. */
function readCf(c: Context<AppEnv>): CfObject | undefined {
  return (c.req.raw as Request & { cf?: CfObject }).cf;
}

// ─────────────────────────────────────────────────────────────────────────────
// Схема запроса
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Общие поля запроса генерации — те же, что у рабочего листа
 * (`GenerateWorksheetRequest` в src/types.ts).
 *
 * `type` принимается и игнорируется: фронт присылает свой `TaskType`, но тип
 * артефакта задаёт эндпоинт, и доверять полю из браузера нельзя (см.
 * assertTaskAllowed).
 *
 * Границы не выдуманы: `topic` до 300 символов — длинная тема вроде
 * «Правописание причастий, дефиксное и недефиксное образование» должна
 * помещаться; `count` — число карточек/недель, больше 50 не имеет смысла.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * УЧЕБНИК (meta.umk) — КАК ЭТО СТАЛО РАБОТАТЬ
 * ─────────────────────────────────────────────────────────────────────────────
 * Учитель выбирает УМК в конструкторе, и выбор доезжает до промпта рабочего
 * листа (`POST /api/worksheets/generate` → `llm/prompts/worksheet-gen.ts`).
 *
 * Для документов путь был другой и он молча терял выбор: `z.object()` по
 * умолчанию ВЫКИДЫВАЕТ неизвестные ключи, а пять промптов документов (план
 * урока, презентация, КТП, карточки, материалы) про учебник не знали.
 * Поэтому поле `meta` в схему тогда НЕ добавили — намеренно, чтобы не создать
 * видимость поддержки, которой нет.
 *
 * Порядок был прописан в самом комментарии, и он теперь выполнен (лист 2.1.7):
 * правило про учебник лежит в `prompts/umk-block.ts`, его зовут все шесть
 * промптов, и `meta` добавлено в эту схему. Одного поля в zod было бы
 * недостаточно — теперь промпт его читает.
 */
export const ArtifactRequestObject = z.object({
  subject: z.string().trim().min(1).max(64),
  grade: z.number().int().min(1).max(11),
  topic: z.string().trim().min(1).max(300),
  difficulty: z.enum(["easy", "medium", "hard"]),
  /** Сколько единиц контента: карточек, недель, этапов. */
  count: z.number().int().min(1).max(50).default(6),
  /** Фронт присылает свой TaskType; значение не используется. */
  type: z.string().max(40).optional(),
  withAnswers: z.boolean().default(true),
  withExplanations: z.boolean().default(true),
  /**
   * УЧЕБНИК УЧИТЕЛЯ (лист 2.1.7). Раньше это поле в схему не входило
   * намеренно: добавить его без промпта значило бы создать видимость
   * поддержки, которой нет.
   *
   * Теперь порядок замкнут: `prompts/umk-block.ts` читает `meta` во всех
   * шести типах, и этот роут его больше не отбрасывает. Форма та же, что у
   * рабочего листа, — фронт шлёт именно `request.meta.umk`.
   */
  meta: z.object({ umk: z.string().trim().max(80).nullable().optional() }).optional(),
});

/** Конверт: `{ request: {...}, bypassCache?: boolean }`. */
export function artifactEnvelope(requestShape: z.ZodTypeAny = ArtifactRequestObject) {
  return z.object({
    request: requestShape,
    bypassCache: z.boolean().optional(),
  });
}

/** Базовый конверт — для типов без дополнительных полей. */
export const ArtifactEnvelope = artifactEnvelope();

// ─────────────────────────────────────────────────────────────────────────────
// Конвейе�� роута
// ─────────────────────────────────────────────────────────────────────────────

export interface PreparedGeneration {
  request: ArtifactRequest;
  bypassCache: boolean;
  plan: UsagePlan;
  userId: string | null;
  ip: string;
  /** Результат антифрод-проверки — нужен для списания квоты. */
  fingerprint: string;
  /** Почта и окружение — для письма о третьей генерации месяца (ТЗ-29). */
  email: string | null;
  env: AppEnv["Bindings"];
}

/**
 * Провести запрос до вызова LLM и вернуть всё, что нужно генерации.
 *
 * Порядок именно такой (как в worksheets.ts): валидация → moderation → роль →
 * тариф → антифрод. Провайдера касается только последний шаг, поэтому заведомо
 * мусорный или запрещённый запрос до него не доходит.
 */
export async function prepareArtifactGeneration(
  c: Context<AppEnv>,
  schema: z.ZodTypeAny,
): Promise<PreparedGeneration> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new BadRequestError("Invalid JSON body");
  }

  // ZodError из `.parse()` разбирает errorMiddleware в 400 VALIDATION_ERROR
  // с перечнем полей — учитель видит, что именно не так.
  const parsed = schema.parse(raw) as { request: ArtifactRequest; bypassCache?: boolean };
  const request = parsed.request;

  // Pre-moderation (defense in depth — второй раз её делает llm/index.ts).
  const mod = moderateGenerationRequest({ subject: request.subject, topic: request.topic });
  if (!mod.ok) {
    throw new BadRequestError(`Invalid input: ${mod.reason}`, { reason: mod.reason });
  }

  assertCanGenerate(c);

  const plan = resolvePlan(c);
  const userId = resolveUserId(c);
  const ip = c.get("ip") ?? "0.0.0.0";

  const guard = await guardGeneration({
    db: c.env.DB,
    userId,
    plan,
    ip,
    userAgent: c.get("userAgent") ?? "",
    cf: readCf(c),
    salt: c.env.FINGERPRINT_SALT ?? "dev-fingerprint-salt",
    // Капча при необходимости приходит как заголовок cf-turnstile-response
    // (её выдал фронт по 409 от прошлой попытки).
    challengePassed: Boolean(c.req.header("cf-turnstile-response")),
  });

  return {
    request,
    bypassCache: parsed.bypassCache ?? false,
    plan,
    userId,
    ip,
    fingerprint: guard.fingerprint,
    // Письмо о третьей генерации месяца (ТЗ-29) уходит только владельцу
    // аккаунта: у анонима почты нет, и слать ему некуда.
    email: c.get("user")?.email ?? null,
    env: c.env,
  };
}

/**
 * Списать бесплатную попытку ПОСЛЕ успешной генерации.
 *
 * Порядок обязателен: упавший вызов провайдера не должен съедать учителю
 * генерацию, иначе после трёх неудачных попыток он упрётся в 402, ничего не
 * получив.
 */
export async function consumeFreeQuota(
  c: Context<AppEnv>,
  prepared: Pick<PreparedGeneration, "plan" | "userId" | "fingerprint" | "email" | "env">,
): Promise<void> {
  await consumeGenerationQuota(c.env.DB, {
    userId: prepared.userId,
    plan: prepared.plan,
    fingerprint: prepared.fingerprint,
    email: prepared.email ?? null,
    env: prepared.env,
  });
}