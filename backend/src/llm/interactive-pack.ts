/**
 * Ранклер `interactive-pack` (TZ-13 §4.7).
 *
 * Задача LLM ровно одна: разложить `payload_json` ЛИСТА по механике формата.
 * Новые задания не генерируются (второй вызов = двойной COGS, ТЗ §4.7).
 *
 * Цепочка: кэш → LLM (gpt-6-luna → gpt-6-sol) → разбор JSON → нормализация →
 * детерминированная валидация → SVG-рендер на сервере → LLM-валидатор
 * (deepseek-v4-flash) → итог.
 *
 * ═══ ПОЧЕМУ ФАЙЛ ОТДЕЛЬНЫЙ, А НЕ В `llm/index.ts` ═══
 * `llm/types.ts` сейчас правит параллельный воркер (TZ-11: расширяет
 * `LLMMessage.content` до мультимодального формата). Чтобы не конфликтовать,
 * новая задача `interactive-pack` НЕ добавлена в `GenerationKind` и
 * `PRIMARY_BY_TASK`. Вместо этого маршрут задан здесь явно — локально,
 * в одном месте, с комментарием что делать после мержа (см. `ROUTING`).
 */

import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "../env";
import { logLlmCall } from "./index";
import { lookupCache, saveCache } from "./cache";
import { callWithFallback, pickModel } from "./router";
import type { RoutingDecision } from "./types";
import { supportsPromptCache } from "./config";
import { logLlmEvent } from "./log";
import { buildInteractivePackPrompt } from "./prompts/interactive-pack";
import { renderInteractiveChart } from "../lib/interactives/svg";
import {
  validateInteractiveConfig,
  type ConfigIssue,
} from "../services/interactives-scoring";
import type {
  InteractiveConfig,
  InteractiveFormat,
  InteractiveItem,
  InteractiveOptions,
} from "../lib/interactives/types";
import { INTERACTIVE_FORMATS } from "../lib/interactives/types";
import type { Worksheet } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Маршрутизация
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Маршрут `interactive-pack` из ТЗ §4.7.
 *
 * gpt-6-luna — основная (~$0.0007 на интерактив), gpt-6-sol — фолбэк.
 * Если бы `interactive-pack` уже был в `GenerationKind`, это место стало бы
 * одной строкой в `PRIMARY_BY_TASK` роутера; держим локально, пока типы
 * принадлежат другому воркеру.
 */
const PRIMARY_MODEL = "gpt-6-luna";
const FALLBACK_MODELS = ["gpt-6-sol"] as const;

/**
 * Собрать RoutingDecision вручную (минуя pickModel, т.к. задачи нет в типе).
 *
 * Структура та же, что у `pickModel()`, поэтому `callWithFallback` принимает её
 * без приведений типов.
 */
function interactivePackDecision(env: Env): RoutingDecision {
  if (!env.POLZA_API_KEY) {
    return { primary: null, fallbacks: [], generation: "primary" };
  }
  return {
    primary: { provider: "polza", model: PRIMARY_MODEL },
    fallbacks: FALLBACK_MODELS.map((model) => ({ provider: "polza" as const, model })),
    generation: "primary",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Кэш
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ключ кэша по ТЗ §4.7: `interactive-pack:<worksheetId>:<format>:<optionsHash>`.
 *
 * Тот же лист + тот же формат + те же настройки = та же раскладка. Учитель
 * жмёт «переделать» — второй раз LLM не зовётся.
 *
 * Хэш считаем через `crypto.subtle.digest` (есть в Workers и в Node 18+):
 * в бэкенд не тащим крипто-зависимости ради короткой строки.
 */
export async function interactivePackCacheKey(
  worksheetId: string,
  format: string,
  options: InteractiveOptions,
): Promise<string> {
  const canonical = JSON.stringify(sortKeys(options));
  let hash = "nohash";
  try {
    const data = new TextEncoder().encode(canonical);
    const digest = await crypto.subtle.digest("SHA-256", data);
    hash = [...new Uint8Array(digest)]
      .slice(0, 8)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    // Workers всегда дают crypto; на случай тестов/старого рантайма — djb2.
    hash = `djb2-${djb2(canonical)}`;
  }
  return `interactive-pack:${worksheetId}:${format}:${hash}`;
}

/** Стабильная сортировка ключей: `{b:1,a:2}` и `{a:2,b:1}` — один хэш. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Тот же djb2, что в publicForms/ratelimit — без зависимостей. */
function djb2(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

// ─────────────────────────────────────────────────────────────────────────────
// Нормализация ответа LLM
// ─────────────────────────────────────────────────────────────────────────────

/** Что прислала модель (сырое, нам не доверяем). */
interface RawPack {
  title?: unknown;
  items?: unknown;
  options?: unknown;
  summary?: unknown;
}

/**
 * Привести ответ модели к `InteractiveConfig` или вернуть `null`.
 *
 * Здесь много «страховок», и это намеренно: ответ LLM — это текст от
 * внешней системы, а не доверенные данные. Мы не падаем, а выкидываем
 * мусор: битый item не должен ломать весь интерактив.
 */
function normalizePack(
  raw: RawPack,
  format: InteractiveFormat,
  fallbackTitle: string,
): InteractiveConfig | null {
  if (!Array.isArray(raw.items) || raw.items.length === 0) return null;

  const items: InteractiveItem[] = [];
  raw.items.forEach((rawItem, index) => {
    if (!rawItem || typeof rawItem !== "object") return;
    const it = rawItem as Record<string, unknown>;

    const prompt = typeof it.prompt === "string" ? it.prompt.trim() : "";
    if (prompt === "") return;

    const item: InteractiveItem = { id: `i${index + 1}`, prompt };

    if (Array.isArray(it.options)) {
      const opts = it.options.filter((o): o is string => typeof o === "string" && o.trim() !== "");
      if (opts.length >= 2) item.options = opts;
    }
    if (typeof it.correctIndex === "number" && Number.isInteger(it.correctIndex)) {
      item.correctIndex = it.correctIndex;
    }
    if (typeof it.isTrue === "boolean") item.isTrue = it.isTrue;
    if (typeof it.bucket === "string" && it.bucket.trim() !== "") item.bucket = it.bucket.trim();
    if (typeof it.points === "number" && Number.isFinite(it.points)) item.points = it.points;
    if (typeof it.orderIndex === "number" && Number.isInteger(it.orderIndex)) {
      item.orderIndex = it.orderIndex;
    }
    if (it.isTrap === true) item.isTrap = true;
    if (typeof it.correctBucket === "string" && it.correctBucket.trim() !== "") {
      item.correctBucket = it.correctBucket.trim();
    }

    // Графика: модель отдаёт спеку, рендерим ЗДЕСЬ, на сервере (ТЗ §4.8).
    const chart = it.chart as { spec?: unknown } | null | undefined;
    if (chart && typeof chart === "object") {
      const svg = renderInteractiveChart(chart.spec as never);
      if (svg) item.svg = svg;
    }

    items.push(item);
  });

  if (items.length === 0) return null;

  const title =
    typeof raw.title === "string" && raw.title.trim() !== "" ? raw.title.trim().slice(0, 120) : fallbackTitle;

  const options: InteractiveOptions =
    raw.options && typeof raw.options === "object" && !Array.isArray(raw.options)
      ? (raw.options as InteractiveOptions)
      : {};

  return { format, title, items, options, schemaVersion: 1 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Основной вход
// ─────────────────────────────────────────────────────────────────────────────

export interface PackInteractiveArgs {
  worksheet: Worksheet;
  worksheetId: string;
  format: InteractiveFormat;
  options: InteractiveOptions;
  userId: string;
  plan: string;
}

export interface PackInteractiveResult {
  config: InteractiveConfig;
  /** null = LLM не понадобился, взят кэш. */
  model: string | null;
  costUsd: number;
  latencyMs: number;
  cached: boolean;
  /** Оценка LLM-валидатора 0..1 (null — валидатор не запускался). */
  validationScore: number | null;
  /** Детерминированные проблемы конфига (для логов и ответа учителю). */
  issues: ConfigIssue[];
}

/**
 * Собрать интерактив из листа. Бросает `BadRequestError`/`InternalError`,
 * если собрать нечего.
 */
export async function packInteractive(
  args: PackInteractiveArgs,
  env: Env,
  db: D1Database,
): Promise<PackInteractiveResult> {
  const start = Date.now();
  const { worksheet, worksheetId, format, options, userId, plan } = args;

  if (!INTERACTIVE_FORMATS.includes(format)) {
    throw new Error(`Unknown interactive format: ${format}`);
  }

  const cacheKey = await interactivePackCacheKey(worksheetId, format, options);

  // ── 1. Кэш ──────────────────────────────────────────────────────────────
  const cached = await lookupCache(db, cacheKey);
  if (cached && typeof cached === "object" && cached.response) {
    const config = (cached.response as { config?: InteractiveConfig }).config;
    if (config && Array.isArray(config.items) && config.items.length > 0) {
      await logLlmCall(db, {
        userId,
        task: "interactive-pack",
        provider: "cache",
        model: cacheKey.slice(0, 12),
        plan,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        latencyMs: Date.now() - start,
        cached: true,
        fallback: false,
      });
      // Кэш мог прийти из-под более старого кода — перевалидируем.
      const issues = validateInteractiveConfig(config);
      return {
        config,
        model: null,
        costUsd: 0,
        latencyMs: Date.now() - start,
        cached: true,
        validationScore: null,
        issues,
      };
    }
  }

  // ── 2. LLM ──────────────────────────────────────────────────────────────
  const decision = interactivePackDecision(env);
  if (!decision.primary) {
    throw new Error("LLM: POLZA_API_KEY not configured");
  }

  const { system, user } = buildInteractivePackPrompt({ worksheet, format, options });

  const result = await callWithFallback(
    {
      model: decision.primary.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      responseFormat: "json",
      temperature: 0.4, // ниже, чем у генерации листа: раскладка должна быть стабильной
      maxTokens: 4096,
      cacheSystemPrompt: supportsPromptCache(decision.primary.model),
    },
    decision,
    env,
  );

  // ── 3. Разбор JSON ──────────────────────────────────────────────────────
  let config: InteractiveConfig | null = null;
  try {
    const parsed = JSON.parse(result.response.content) as RawPack;
    config = normalizePack(parsed, format, worksheet.title || "Интерактив");
  } catch (e) {
    logLlmEvent("warn", "interactive-pack: invalid JSON from model", {
      format,
      worksheetId,
      error: String(e),
      content: result.response.content.slice(0, 200),
    });
  }

  if (!config) {
    // LLM не ответил чем-то пригодным. Отдаём «честный» отказ, а не пустой
    // интерактив: пустой конфиг учителю не нужен.
    await logLlmCall(db, {
      userId,
      task: "interactive-pack",
      provider: result.provider,
      model: result.model,
      plan,
      tokensIn: result.response.tokensIn,
      tokensOut: result.response.tokensOut,
      costUsd: result.response.costUsd,
      latencyMs: Date.now() - start,
      cached: false,
      fallback: result.generation !== "primary",
      error: "unparseable-pack",
    });
    throw new Error("LLM вернул нечитаемый конфиг интерактива");
  }

  // ── 4. Детерминированная валидация (до LLM-валидатора) ──────────────────
  const issues = validateInteractiveConfig(config);

  // ── 5. LLM-валидатор (deepseek-v4-flash, та же задача "validate") ───────
  // Запускаем ТОЛЬКО если нет блокирующих проблем: если правильный вариант не
  // существует, валидатор тут не поможет, а токены потратятся впустую.
  let validationScore: number | null = null;
  if (issues.length === 0) {
    validationScore = await runValidator(config, worksheet, env, db, userId, plan, start);
  }

  // ── 6. Кэш + лог ────────────────────────────────────────────────────────
  await saveCache(db, {
    key: cacheKey,
    subject: worksheet.subject,
    grade: worksheet.grade,
    topic: worksheet.topic,
    difficulty: worksheet.difficulty,
    count: config.items.length,
    type: "interactive-pack",
    response: { config },
  });

  await logLlmCall(db, {
    userId,
    task: "interactive-pack",
    provider: result.provider,
    model: result.model,
    plan,
    tokensIn: result.response.tokensIn,
    tokensOut: result.response.tokensOut,
    costUsd: result.response.costUsd,
    latencyMs: Date.now() - start,
    cached: false,
    fallback: result.generation !== "primary",
  });

  return {
    config,
    model: result.model,
    costUsd: result.response.costUsd,
    latencyMs: Date.now() - start,
    cached: false,
    validationScore,
    issues,
  };
}

/**
 * Валидатор конфига на deepseek-v4-flash (задача "validate" — она уже есть в
 * роутере, ТЗ §4.7 «task = validate → deepseek-v4-flash, всегда, как сейчас»).
 *
 * Возвращает score 0..1. Ошибка валидатора НЕ роняет создание: конфиг уже
 * прошёл детерминированную проверку, а LLM-валидатор — это второй эшелон.
 */
async function runValidator(
  config: InteractiveConfig,
  worksheet: Worksheet,
  env: Env,
  db: D1Database,
  userId: string,
  plan: string,
  start: number,
): Promise<number | null> {
  try {
    const decision = pickModel("validate", env);
    if (!decision.primary) return null;

    const system =
      "Ты валидатор игровых заданий для школьного класса. Ответ — СТРОГО один JSON: " +
      '{"score": 0..1, "issues": [{"message": "..."}]}. ' +
      "Понижай score, если: правильный ответ неочевиден, варианты повторяются по смыслу, " +
      "утверждение «правда/ложь» двусмысленно, задание не соответствует возрасту класса. " +
      "Без markdown и текста вокруг JSON.";

    const user = JSON.stringify(
      {
        class: `${worksheet.subject}, ${worksheet.grade} класс`,
        format: config.format,
        items: config.items.map((i) => ({
          prompt: i.prompt,
          options: i.options ?? null,
          correctIndex: i.correctIndex ?? null,
          isTrue: i.isTrue ?? null,
          bucket: i.bucket ?? null,
        })),
      },
      null,
      2,
    );

    const result = await callWithFallback(
      {
        model: decision.primary.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        responseFormat: "json",
        temperature: 0.2,
        maxTokens: 1500,
      },
      decision,
      env,
    );

    let score: number | null = null;
    try {
      const parsed = JSON.parse(result.response.content) as { score?: unknown };
      if (typeof parsed.score === "number") {
        score = Math.max(0, Math.min(1, parsed.score));
      }
    } catch {
      logLlmEvent("warn", "interactive-pack: validator returned invalid JSON", {
        content: result.response.content.slice(0, 200),
      });
    }

    await logLlmCall(db, {
      userId,
      task: "validate",
      provider: result.provider,
      model: result.model,
      plan,
      tokensIn: result.response.tokensIn,
      tokensOut: result.response.tokensOut,
      costUsd: result.response.costUsd,
      latencyMs: Date.now() - start,
      cached: false,
      fallback: result.generation !== "primary",
    });

    return score;
  } catch (e) {
    logLlmEvent("warn", "interactive-pack: validator failed, continuing", { error: String(e) });
    return null;
  }
}
