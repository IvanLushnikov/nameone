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
