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
 * `callWithFallback` — обёртка: пробует primary, на ошибке — fallbacks.
 * На полном падении бросает InternalError.
 */

import type { Env } from "../env";
import { InternalError } from "../lib/errors";
import { logLlmEvent } from "./log";
import { isProviderEnabled } from "./config";
import { getProvider } from "./providers/base";
import type { LLMRequest, LLMResponse, ProviderPick, RoutingDecision, GenerationKind, Plan } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Routing matrix
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Возвращает primary + fallbacks для заданной задачи и тарифа.
 * Если подходящий провайдер не сконфигурирован в env — primary = null
 * (вызывающий код должен fallback'нуть на mock или бросить ошибку).
 */
export function pickModel(task: GenerationKind, plan: Plan, env: Env): RoutingDecision {
  switch (task) {
    case "worksheet-gen":
    case "exam-gen":
      if (plan === "plus") {
        // Plus → Opus 5.5 с prompt cache. Нет fallback (Opus — premium, не хотим деградировать).
        return {
          primary: isProviderEnabled(env, "anthropic")
            ? { provider: "anthropic", model: "claude-opus-5-5" }
            : null,
          fallbacks: [],
          generation: "premium",
        };
      }
      // Free/Base → Luna primary, Sol fallback.
      return {
        primary: isProviderEnabled(env, "openai")
          ? { provider: "openai", model: "gpt-6-luna" }
          : null,
        fallbacks: isProviderEnabled(env, "openai")
          ? [{ provider: "openai", model: "gpt-6-sol" }]
          : [],
        generation: "primary",
      };

    case "validate":
      return {
        primary: isProviderEnabled(env, "deepseek")
          ? { provider: "deepseek", model: "deepseek-v4-flash" }
          : null,
        fallbacks: [],
        generation: "primary",
      };

    case "embed":
      return {
        primary: isProviderEnabled(env, "dashscope")
          ? { provider: "dashscope", model: "qwen3-embedding-8b" }
          : isProviderEnabled(env, "openai")
            ? { provider: "openai", model: "text-embedding-3-large" }
            : null,
        fallbacks: isProviderEnabled(env, "openai")
          ? [{ provider: "openai", model: "text-embedding-3-large" }]
          : [],
        generation: "primary",
      };

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
 *  4) Если primary == null (нет ключа) — пробуем первый fallback.
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
    throw new InternalError("LLM: no providers configured (set API keys in env)");
  }

  let lastError: unknown = null;
  for (let i = 0; i < allPicks.length; i++) {
    const pick = allPicks[i]!;
    const isLast = i === allPicks.length - 1;
    try {
      const provider = getProvider(pick.provider as "openai" | "anthropic" | "deepseek", env);
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
