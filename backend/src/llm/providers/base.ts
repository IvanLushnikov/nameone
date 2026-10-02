/**
 * Provider registry + factory.
 *
 * Единая точка входа: getProvider(id, env) → Provider.
 *
 * Каждый provider — lazy singleton (per-isolate). Не пересоздаём клиента на
 * каждый запрос — иначе лишний TCP-handshake в Cloudflare Workers.
 */

import { InternalError } from "../../lib/errors";
import type { Env } from "../../env";
import type { Provider } from "../types";
import { getOpenAIProvider } from "./openai";
import { getAnthropicProvider } from "./anthropic";
import { getDeepSeekProvider } from "./deepseek";
import { getPolzaProvider } from "./polza";

/**
 * ID провайдеров, у которых есть своя реализация complete().
 * OpenRouter проксируется через OpenAI-провайдер, DashScope — через прямой fetch в embed().
 */
export type KnownProviderId = "openai" | "anthropic" | "deepseek" | "polza";

/**
 * Есть ли у провайдера своя реализация `complete()`.
 *
 * `ProviderId` (llm/types.ts) шире `KnownProviderId`: в нём есть openrouter
 * и dashscope, которые не имеют адаптера с complete() — openrouter
 * проксируется через openai-адаптер, dashscope используется только в embed().
 * Роутинг (router.ts) должен уметь отличить «подключён, но не callable»
 * от настоящей ошибки конфигурации.
 */
export function hasCompleteImpl(provider: string): provider is KnownProviderId {
  return (
    provider === "openai" ||
    provider === "anthropic" ||
    provider === "deepseek" ||
    provider === "polza"
  );
}

/**
 * Получить провайдера по ID.
 *
 * Lazy singleton: внутри вызывает getXProvider(env) у соответствующего модуля.
 * Бросает InternalError, если ключа нет — это считается конфигурационной
 * ошибкой (роутер не должен был вызывать этот provider).
 */
export function getProvider(
  provider: KnownProviderId,
  env: Env,
): Provider {
  switch (provider) {
    case "openai":
      return getOpenAIProvider(env);
    case "anthropic":
      return getAnthropicProvider(env);
    case "deepseek":
      return getDeepSeekProvider(env);
    case "polza":
      return getPolzaProvider(env);
    default: {
      // Exhaustiveness check — если добавим новый KnownProviderId без case,
      // компилятор укажет на ошибку здесь.
      const _exhaustive: never = provider;
      throw new InternalError(`Unknown provider: ${String(_exhaustive)}`);
    }
  }
}
