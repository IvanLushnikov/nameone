/**
 * LLM routing: выбрать провайдера+модель по задаче и тарифу.
 *
 * Один источник правды для всех вызовов LLM. Соответствует
 * `docs/02-llm-architecture.md` Section 2:
 *
 *   task=worksheet-gen + plan in [free, base] → primary Luna, fallback Sol
 *   task=worksheet-gen + plan=plus           → primary Opus 5.5 (с cache), no fallback
 *   task=exam-gen     + plan in [free, base] → primary Luna, fallback Sol
 *   task=exam-gen     + plan=plus           → primary Opus 5.5 (с cache), no fallback
 *   task=validate                           → primary DeepSeek V4 Flash, no fallback
 *   task=embed                               → primary Qwen3, fallback OpenAI
 *
 * С 2026-09-27 — polza.ai единственный провайдер для РабочиеЛисты AI.
 * Один POLZA_API_KEY покрывает все модели. Без ключа → primary = null
 * (routes должны fallback на mock или вернуть ошибку).
 *
 * `callWithFallback` — обёртка: пробует primary, на ошибке — fallbacks.
 * На полном падении бросает InternalError.
 */

import type { Env } from "../env";
import { InternalError } from "../lib/errors";
import { logLlmEvent } from "./log";
import { isProviderEnabled } from "./config";
import { getProvider } from "./providers/base";
import type {
  LLMRequest,
  LLMResponse,
  ProviderPick,
  RoutingDecision,
  GenerationKind,
  Plan,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Routing matrix
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Возвращает primary + fallbacks для заданной задачи и тарифа.
 *
 * Polza = единственный провайдер. Если POLZA_API_KEY нет — primary = null
 * и routes должен fallback'нуть на mock или вернуть 503.
 *
 * Fallback chain внутри одного провайдера (Luna → Sol, Qwen3 → OpenAI)
 * срабатывает ТОЛЬКО если polza вернул ошибку на primary (см. callWithFallback).
 */
export function pickModel(task: GenerationKind, plan: Plan, env: Env): RoutingDecision {
  if (!isProviderEnabled(env, "polza")) {
    // Polza не сконфигурирован — routes должен fallback на mock.
    return { primary: null, fallbacks: [], generation: "primary" };
  }

  switch (task) {
    case "worksheet-gen":
    case "exam-gen": {
      if (plan === "plus") {
        // Plus → Opus 5.5 с prompt cache. Нет fallback (Opus — premium, не хотим деградировать).
        return {
          primary: { provider: "polza", model: "claude-opus-5-5" },
          fallbacks: [],
          generation: "premium",
        };
      }
      // Free/Base → Luna primary, Sol fallback (оба на polza).
      return {
        primary: { provider: "polza", model: "gpt-6-luna" },
        fallbacks: [{ provider: "polza", model: "gpt-6-sol" }],
        generation: "primary",
      };
    }

    case "validate": {
      return {
        primary: { provider: "polza", model: "deepseek-v4-flash" },
        fallbacks: [],
        generation: "primary",
      };
    }

    case "embed": {
      // text-embedding-3-large — primary (точно есть на polza, проверено).
      // qwen3-embedding-8b — fallback (мультиязычный, для русских текстов;
      // точное имя на polza не подтверждено, может зависнуть если 404 не возвращается).
      return {
        primary: { provider: "polza", model: "text-embedding-3-large" },
        fallbacks: [{ provider: "polza", model: "qwen3-embedding-8b" }],
        generation: "primary",
      };
    }

    case "image-gen":
      // Заглушка на старте — нет провайдера. Вызывающий должен вернуть null.
      return { primary: null, fallbacks: [], generation: "primary" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// callWithFallback
// ─────────────────────────────────────────────────────────────────────────────

export interface CallResult {
  response: LLMResponse;
  provider: string;
  model: string;
  /** Какой pick сработал: 'primary' | 'boost' | 'premium'. */
  generation: "primary" | "boost" | "premium";
}

/**
 * Вызвать LLM с fallback chain.
 *
 * Логика:
 *  1) Попробовать primary.
 *  2) На ошибке — каждый fallback по очереди.
 *  3) Если primary и все fallbacks упали — бросить InternalError.
 *  4) Если primary == null (нет ключа polza) — бросить InternalError.
 */
export async function callWithFallback(
  req: LLMRequest,
  decision: RoutingDecision,
  env: Env,
): Promise<CallResult> {
  const allPicks: ProviderPick[] = [];
  if (decision.primary) allPicks.push(decision.primary);
  allPicks.push(...decision.fallbacks);

  if (allPicks.length === 0) {
    throw new InternalError(
      "LLM: POLZA_API_KEY not configured (set it in wrangler secret put or .dev.vars)",
    );
  }

  let lastError: unknown = null;
  for (let i = 0; i < allPicks.length; i++) {
    const pick = allPicks[i]!;
    const isLast = i === allPicks.length - 1;
    try {
      const provider = getProvider(pick.provider as "polza", env);
      const response = await provider.complete(req, env);
      const generation: "primary" | "boost" | "premium" =
        i === 0
          ? (decision.generation ?? "primary")
          : pick.model.includes("sol")
            ? "boost"
            : "primary";
      logLlmEvent("info", "callWithFallback: success", {
        provider: provider.id,
        model: pick.model,
        generation,
        tokensIn: response.tokensIn,
        tokensOut: response.tokensOut,
        costUsd: response.costUsd,
        latencyMs: response.latencyMs,
      });
      return { response, provider: provider.id, model: pick.model, generation };
    } catch (e) {
      lastError = e;
      const msg = e instanceof Error ? e.message : String(e);
      logLlmEvent("warn", "callWithFallback: attempt failed", {
        provider: pick.provider,
        model: pick.model,
        attempt: i + 1,
        totalAttempts: allPicks.length,
        error: msg.slice(0, 300),
        isLast,
      });
      if (isLast) break;
    }
  }

  throw new InternalError(
    `LLM: all providers failed (${allPicks.length} attempts). Last: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
    { attempts: allPicks.length },
  );
}
