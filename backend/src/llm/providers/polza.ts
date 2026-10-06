/**
 * Polza.ai provider — заглушка.
 *
 * Polza — primary провайдер для РФ (юрлица, ФЗ-152, ₽), OpenAI-совместимый API
 * (см. llm/config.ts, docs/02-llm-architecture.md). Файл был удалён, импорты
 * остались — этот stub восстанавливает API чтобы билд прошёл и существующие
 * вызовы не падали в module-not-found.
 *
 * Что stub делает:
 *   * getPolzaProvider() — возвращает провайдер, который вызывает polza через
 *     OpenAI-совместимый /chat/completions с POLZA_API_KEY.
 *   * callPolzaEmbedding() — отдельный helper для embeddings через
 *     /embeddings. Поддержка text-embedding-3-large.
 *
 * Что нужно сделать дальше (отдельная задача):
 *   1. Добавить покрытие тестами: поднять mock-сервер polza и прогнать
 *      generateWorksheet через эту реализацию.
 *   2. Добавить retry / circuit breaker (как у openai.ts).
 *   3. Перенести тарифы из llm/config.ts в llm/cost.ts, чтобы они применялись
 *      и в провайдере, а не только в роутере.
 */

import { InternalError } from "../../lib/errors";
import { calcCost } from "../cost";
import { getBaseUrl, MODEL_CATALOG } from "../config";
import { logLlmEvent } from "../log";
import type { Env } from "../../env";
import type { LLMResponse, Provider } from "../types";

interface PolzaProviderState {
  baseUrl: string;
  apiKey: string;
}

let cached: PolzaProviderState | null = null;

export function _resetPolzaSingleton(): void {
  cached = null;
}

function getState(env: Env): PolzaProviderState {
  if (cached) return cached;
  const apiKey = env.POLZA_API_KEY;
  if (!apiKey) {
    throw new InternalError("POLZA_API_KEY не задан — polza-провайдер недоступен");
  }
  // baseUrl берём через getBaseUrl(env, "polza"): в типе Env есть только
  // POLZA_API_KEY, поля POLZA_BASE_URL не существует. Раньше здесь стояло
  // env.POLZA_BASE_URL — файл не компилировался.
  const baseUrl = getBaseUrl(env, "polza");
  cached = { baseUrl, apiKey };
  return cached;
}

/**
 * Имя модели для polza: `apiName` из MODEL_CATALOG.
 *
 * Единственное место в коде, где внутренний id превращается в имя, которое
 * понимает провайдер. Модели нет в каталоге (кастомный override из env) —
 * отдаём как есть: лучше отправить то, что пришло, чем упасть на ровном месте.
 */
export function apiNameFor(modelId: string): string {
  return MODEL_CATALOG[modelId]?.apiName ?? modelId;
}

export function getPolzaProvider(env: Env): Provider {
  const state = getState(env);

  return {
    id: "polza",
    name: "Polza.ai (OpenAI-compat)",
    async complete(args, _env, _opts): Promise<LLMResponse> {
      void _env;
      const body: Record<string, unknown> = {
        // В polza уходит apiName из MODEL_CATALOG (`openai/gpt-6-luna`), а не
        // наш внутренний id (`gpt-6-luna`). Раньше сюда уезжал внутренний id,
        // и поле `apiName`, объявленное в каталоге, не читалось НИГДЕ — то есть
        // оно было мёртвым, а провайдер получал имя, которое мы ему не обещали.
        // Сейчас оно единственный источник имени для провайдера; если модели
        // нет в каталоге, уходит id как раньше — это лучше, чем упасть.
        model: apiNameFor(args.model),
        // TZ-11 §4.4: content может быть строкой (все существующие задачи) или
        // массивом content-part с картинкой (photo-check). Провайдер polza
        // OpenAI-совместимый, поэтому массив уходит без преобразований —
        // ровно в том формате, который ждёт /chat/completions.
        messages: args.messages.map((m) => ({ role: m.role, content: m.content })),
        max_tokens: args.maxTokens ?? 4096,
        temperature: args.temperature ?? 0.7,
      };
      if (args.responseFormat === "json") body.response_format = { type: "json_object" };

      const start = Date.now();
      let res: Response;
      try {
        res = await fetch(`${state.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${state.apiKey}`,
          },
          body: JSON.stringify(body),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logLlmEvent("error", "polza network error", {
          provider: "polza",
          model: args.model,
          error: msg,
          latencyMs: Date.now() - start,
        });
        throw new InternalError(`polza network error: ${msg}`);
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        logLlmEvent("error", `polza HTTP ${res.status}`, {
          provider: "polza",
          model: args.model,
          error: text.slice(0, 200),
          latencyMs: Date.now() - start,
        });
        throw new InternalError(`polza HTTP ${res.status}: ${text.slice(0, 200)}`);
      }

      // Разбор ответа. `finish_reason` и детали usage добавлены 06.10.2026 для
      // диагностики пустого content — раньше они не парсились вообще, и по логу
      // было невозможно отличить «лимит токенов съеден размышлением» от других
      // причин пустого ответа.
      //
      // Все новые поля ОПЦИОНАЛЬНЫ и только читаются: провайдер, который их не
      // отдаёт, разбирается ровно как раньше (значение станет `null`), ничего
      // другого провайдера это не затрагивает — тип локальный для polza.ts.
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string }; finish_reason?: string | null }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
          prompt_tokens_details?: { cached_tokens?: number };
          /**
           * Токены внутреннего размышления. OpenAI-совместимое поле — у одних
           * провайдеров `usage.completion_tokens_details.reasoning_tokens`,
           * у других (deepseek-подобные) — плоский `usage.reasoning_tokens`.
           * Читаем оба, иначе причина пустого ответа снова останется невидимой.
           */
          completion_tokens_details?: { reasoning_tokens?: number };
          reasoning_tokens?: number;
        };
        model?: string;
      };
      const content = data.choices?.[0]?.message?.content ?? "";
      const finishReason = data.choices?.[0]?.finish_reason ?? null;
      const reasoningTokens =
        data.usage?.completion_tokens_details?.reasoning_tokens ??
        data.usage?.reasoning_tokens ??
        null;
      const tokensIn = data.usage?.prompt_tokens ?? 0;
      const tokensOut = data.usage?.completion_tokens ?? 0;
      const cachedTokens = data.usage?.prompt_tokens_details?.cached_tokens ?? 0;
      const latencyMs = Date.now() - start;

      // Ключевой момент: тариф берём по ID модели из MODEL_CATALOG, а не по
      // имени провайдера. Раньше здесь было calcCost("polza", model, ...) —
      // первый аргумент попадал в параметр `model`, MODEL_COSTS["polza"]
      // не существует, и ВСЕ вызовы polza тарифицировались как 0 USD.
      // Подробности: docs/tz/11-photo-check.md §2.5 (расхождение №2).
      const costUsd = calcCost(args.model, tokensIn, tokensOut);

      logLlmEvent("info", "polza.complete ok", {
        provider: "polza",
        model: data.model ?? args.model,
        inputTokens: tokensIn,
        outputTokens: tokensOut,
        costUsd,
        latencyMs,
        finishReason,
      });

      if (!content) {
        // ─────────────────────────────────────────────────────────────────
        // ДИАГНОСТИКА ПУСТОГО ОТВЕТА (06.10.2026)
        //
        // Пустой content — это не «модель не знает ответ», это обрыв ответа:
        // провайдер вернул 200 и usage, но текста нет. Самая частая причина,
        // если модель с размышлением: короткий max_tokens целиком съеден
        // внутренним «обдумыванием», на ответ не осталось ничего.
        //
        // Логируем ровно то, по чему эти причины различаются:
        //   finish_reason === "length" + completion_tokens около maxTokens
        //       → лимит токенов съеден размышлением (finish_reason=length);
        //   finish_reason === "stop" при completion_tokens заметно меньше
        //       → ответ дошёл до конца, пустым его сделало что-то другое
        //         (содержание, фильтр, сбой на стороне провайдера);
        //   finish_reason === null (поле не отдано)
        //       → провайдер не сообщает причину, судить можно только по usage.
        //   completion_tokens === 0 при ненулевом prompt_tokens
        //       → модель не сгенерировала ничего вообще, reasoning не при чём.
        //
        // В лог идут ТОЛЬКО числа и finish_reason: ни промпта, ни ответа,
        // ни ключа — секретов тут нет. maxTokens дублируем, чтобы по логу
        // было видно, во что упёрся вызов (args.maxTokens может быть undefined,
        // а тело запроса уходит с дефолтом 4096).
        //
        // Текст ошибки НЕ меняем: по строке «polza вернул пустой content»
        // в других местах ловится причина отказа (см. retry в verifySelfTask),
        // и фронт показывает её пользователю в теле 500.
        //
        // А вот ДЕТАЛИ идут вторым аргументом: без них причина отказа жила
        // только в console воркера (логи Workers недолговечны и без Logpush
        // их не видно постфактум), то есть восстановить «почему провайдер
        // вернул пустоту» было невозможно ни ретроспективно, ни по факту.
        // `callWithFallback` перехватывает эту ошибку и кладёт детали в
        // llm_logs.error — после этого отказ виден в базе и по нему можно
        // построить разбор «отказы по причинам».
        throw new InternalError("polza вернул пустой content", {
          finishReason,
          inputTokens: tokensIn,
          outputTokens: tokensOut,
          reasoningTokens,
          requestedMaxTokens: args.maxTokens ?? 4096,
          model: data.model ?? args.model,
        });
      }

      return {
        content,
        tokensIn,
        tokensOut,
        costUsd,
        latencyMs,
        cached: cachedTokens > 0,
        raw: data,
      };
    },
  };
}

/**
 * Embeddings через polza.ai (OpenAI-совместимый /embeddings endpoint).
 *
 * Используется для text-embedding-3-large и qwen/qwen3-embedding-8b (см. config.ts).
 */
export async function callPolzaEmbedding(args: {
  env: Env;
  model: string; // например "openai/text-embedding-3-large"
  input: string[];
}): Promise<{ vectors: number[][]; model: string; costUsd: number; tokensIn: number }> {
  const state = getState(args.env);
  const start = Date.now();

  // Сетевой сбой раньше улетал наружу сырым исключением fetch, минуя
  // InternalError, — из-за чего верхний слой видел два разных типа ошибок
  // от одной ручки. Обёртываем так же, как основной chat/completions.
  let res: Response;
  try {
    res = await fetch(`${state.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${state.apiKey}`,
      },
      body: JSON.stringify({ model: args.model, input: args.input }),
    });
  } catch (e) {
    logLlmEvent("error", "polza embed network failure", {
      provider: "polza",
      model: args.model,
      error: String(e),
      latencyMs: Date.now() - start,
    });
    throw new InternalError(`polza embed network failure: ${String(e)}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logLlmEvent("error", `polza embed HTTP ${res.status}`, {
      provider: "polza",
      model: args.model,
      error: text.slice(0, 200),
      latencyMs: Date.now() - start,
    });
    throw new InternalError(`polza embed HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  // 200 с не-JSON телом бросалось сырым SyntaxError из res.json() — тот же
  // разнобой типов ошибок, что и выше.
  let data: {
    data?: Array<{ embedding: number[] }>;
    model?: string;
    usage?: { prompt_tokens?: number; total_tokens?: number };
  };
  try {
    data = (await res.json()) as typeof data;
  } catch (e) {
    logLlmEvent("error", "polza embed returned non-JSON body", {
      provider: "polza",
      model: args.model,
      error: String(e),
      latencyMs: Date.now() - start,
    });
    throw new InternalError("polza embed returned a non-JSON body");
  }

  const vectors = (data.data ?? []).map((d) => d.embedding);
  const totalTokens = data.usage?.prompt_tokens ?? data.usage?.total_tokens ?? 0;
  // Раньше было calcCost("polza", args.model, totalTokens, 0) — 4 аргумента
  // против сигнатуры (model, tokensIn, tokensOut, opts). "polza" уезжал в
  // параметр model, MODEL_COSTS["polza"] не существует → 0 USD.
  const costUsd = calcCost(args.model, totalTokens, 0);

  return { vectors, model: data.model ?? args.model, costUsd, tokensIn: totalTokens };
}