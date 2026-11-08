/**
 * Общий слой «попросить провайдера закэшировать префикс промпта».
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЗАЧЕМ ОТДЕЛЬНЫЙ ФАЙЛ
 *
 * Кэш просили дважды и оба раза мимо:
 *
 *   * `providers/anthropic.ts` — умел `cache_control`, но этот провайдер в проде
 *     НЕ используется: прод ходит через polza (см. llm/config.ts, llm/router.ts);
 *   * `providers/polza.ts` — единственный в проде — кэш не просил вообще, и
 *     флаг `cacheSystemPrompt`, который честно выставляет `llm/index.ts`
 *     (по свойству модели), просто игнорировался.
 *
 * Итог: prompt cache не работал НИ для одной модели. У контрольной на Sonnet
 * system-промпт — 12 799 токенов, и он тарифицировался по полной входной
 * цене при каждом вызове.
 *
 * Теперь «как просить кэш» описано ОДИН раз — здесь, а каждый провайдер
 * переносит это в свой формат: у нативного Anthropic `system` — отдельное
 * поле, у OpenAI-совместимого polza — первый элемент `messages`. Два пути
 * «попросить кэш» в одном репозитории — это ровно тот класс ошибок, который
 * приводит к «в коде кэш есть, а в проде его нет».
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ФОРМАТ, КОТОРЫЙ ЖДЁТ ПРОВАЙДЕР
 *
 * Anthropic-формат (`cache_control` внутри блока) поддерживает и сам polza.ai
 * в OpenAI-совместимом `/chat/completions` — это описано в его документации
 * (https://polza.ai/docs/osobennosti/caching): system-сообщение уходит
 * массивом content-parts, и у блока с `cache_control: {type: "ephemeral"}`
 * провайдер запоминает префикс.
 *
 * Нативный эндпоинт Anthropic — это `/v1/messages`, там счётчики приходят
 * отдельными полями (`cache_read_input_tokens` / `cache_creation_input_tokens`).
 * Мы ходим в OpenAI-совместимый путь, поэтому счётчики приходят в
 * `usage.prompt_tokens_details` (`cached_tokens`, `cache_write_tokens`) — их и
 * читает провайдер.
 */

import { supportsPromptCache } from "../config";

/**
 * Маркер «запиши этот префикс в кэш провайдера».
 *
 * `ephemeral` — стандартный маркер Anthropic; polza.ai принимает его в
 * OpenAI-совместимом пути без перевода.
 */
export interface CacheControlEphemeral {
  type: "ephemeral";
}

/**
 * Текстовый блок с необязательным запросом кэша.
 *
 * Формат совпадает с `Anthropic.Messages.TextBlockParam`, поэтому блок
 * кладётся и в нативный `system`, и в `messages[].content` у polza.
 */
export interface CacheableTextBlock {
  type: "text";
  text: string;
  cache_control?: CacheControlEphemeral;
}

/**
 * Собрать текстовый блок system-сообщения.
 *
 * @param text      текст блока
 * @param withCache true → просим провайдера закэшировать этот префикс
 */
export function cachedTextBlock(text: string, withCache: boolean): CacheableTextBlock {
  return withCache
    ? { type: "text", text, cache_control: { type: "ephemeral" } }
    : { type: "text", text };
}

/**
 * Просить ли кэш у провайдера в этом вызове.
 *
 * Два условия, оба обязательны:
 *
 * 1. `cacheSystemPrompt` — флаг выставил вызывающий (`llm/index.ts`) по
 *    свойству модели. Это «разрешение», а не «команда»: провайдер решает по
 *    своим правилам.
 * 2. Модель умеет кэш — `supportsPromptCache` смотрит на наличие цены чтения
 *    кэша в `MODEL_COSTS`.
 *
 * Второе условие — не перестраховка, а защита от безымянной экономии: если у
 * модели нет тарифа на чтение кэша, мы не сможем посчитать деньги за него, а
 * провайдер посчитает. Считать «вход дешевле, потому что кэш» без цены —
 * это выдумывать деньги, а не экономить их.
 */
export function shouldRequestPromptCache(
  model: string,
  cacheSystemPrompt: boolean | undefined,
): boolean {
  return cacheSystemPrompt === true && supportsPromptCache(model);
}
