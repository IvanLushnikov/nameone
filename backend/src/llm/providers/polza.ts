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
 *
 * ── PROMPT CACHE (ТЗ-41) ────────────────────────────────────────────────────
 *
 * polza.ai — единственный провайдер в проде, и до ТЗ-41 кэш промпта не
 * просил НИКТО: флаг `cacheSystemPrompt` выставлял `llm/index.ts`, а читала
 * его только `providers/anthropic.ts` — провайдер, который в проде не
 * используется. Здесь флаг читается по-настоящему: system-сообщение уходит
 * массивом content-parts с `cache_control: {type: "ephemeral"}` — тот формат,
 * который polza.ai документирует для Claude в OpenAI-совместимом
 * `/chat/completions` (https://polza.ai/docs/osobennosti/caching).
 *
 * Если провайдер такой формат отвергает (400) — запрос повторяется в
 * плоском виде, генерация не падает, а кэш в этом воркере выключается
 * (см. `cacheControlRejected`).
 */

import { InternalError } from "../../lib/errors";
import { calcCost } from "../cost";
import { getBaseUrl, MODEL_CATALOG, MODEL_COSTS } from "../config";
import { logLlmEvent } from "../log";
import { cachedTextBlock, shouldRequestPromptCache } from "./cache-control";
import type { Env } from "../../env";
import type { LLMResponse, Provider } from "../types";

interface PolzaProviderState {
  baseUrl: string;
  apiKey: string;
  /**
   * Провайдер отверг `cache_control` (400) — в этом воркере кэш больше не
   * просим.
   *
   * Флаг живёт в состоянии провайдера (singleton на изолят), а не в
   * конфигурации: решение «здесь кэш не работает» — это факт о провайдере
   * в этом окружении, а не о коде. Провайдер отверг кэш один раз — дальше
   * запросы идут без него, иначе каждый вызов платил бы за заведомо
   * обречённый 400-й запрос.
   */
  cacheControlRejected: boolean;
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
  cached = { baseUrl, apiKey, cacheControlRejected: false };
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
      /**
       * Собрать тело запроса.
       *
       * `withCache` — просить ли кэш у провайдера. Разница между двумя
       * вариантами ОДНА: system-сообщение либо строка, либо массив
       * content-parts с `cache_control`. Всё остальное (модель, max_tokens,
       * temperature, response_format) — одинаково.
       *
       * Кэш ставится ТОЛЬКО на первом system-сообщении: кэшируется ПРЕФИКС
       * запроса, то есть всё, что стоит до точки кэширования. Точек больше
       * одной не делаем: у Anthropic их максимум четыре, а смысла ставить вторую
       * у нас нет (system у нас один).
       */
      const buildBody = (withCache: boolean): Record<string, unknown> => {
        let cachePointUsed = false;
        const messages = args.messages.map((m) => {
          // TZ-11 §4.4: content может быть строкой (все существующие задачи) или
          // массивом content-part с картинкой (photo-check). Провайдер polza
          // OpenAI-совместимый, поэтому массив уходит без преобразований —
          // ровно в том формате, который ждёт /chat/completions.
          if (!withCache || cachePointUsed || m.role !== "system" || typeof m.content !== "string") {
            return { role: m.role, content: m.content };
          }
          cachePointUsed = true;
          // System как content-parts с `cache_control` — формат, который
          // polza.ai документирует для Claude в OpenAI-совместимом пути
          // (https://polza.ai/docs/osobennosti/caching).
          return { role: m.role, content: [cachedTextBlock(m.content, true)] };
        });

        const body: Record<string, unknown> = {
          // В polza уходит apiName из MODEL_CATALOG (`openai/gpt-6-luna`), а не
          // наш внутренний id (`gpt-6-luna`). Раньше сюда уезжал внутренний id,
          // и поле `apiName`, объявленное в каталоге, не читалось НИГДЕ — то есть
          // оно было мёртвым, а провайдер получал имя, которое мы ему не обещали.
          // Сейчас оно единственный источник имени для провайдера; если модели
          // нет в каталоге, уходит id как раньше — это лучше, чем упасть.
          model: apiNameFor(args.model),
          messages,
          max_tokens: args.maxTokens ?? 4096,
          temperature: args.temperature ?? 0.7,
        };
        if (args.responseFormat === "json") body.response_format = { type: "json_object" };
        return body;
      };

      // Кэш просим, только если: (1) вызывающий выставил флаг, (2) модель его
      // держит (есть цена чтения в MODEL_COSTS), (3) провайдер в этом воркере
      // его ещё не отверг.
      const wantCache =
        shouldRequestPromptCache(args.model, args.cacheSystemPrompt) && !state.cacheControlRejected;

      const start = Date.now();

      const send = async (body: Record<string, unknown>): Promise<Response> => {
        try {
          return await fetch(`${state.baseUrl}/chat/completions`, {
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
      };

      let res = await send(buildBody(wantCache));

      // ── ОТКАТ ПРИ ОТКАЗЕ В ФОРМАТЕ ───────────────────────────────────────
      // Если провайдер не принимает content-parts с `cache_control` — он
      // отвечает 400. Это НЕ повод ронять генерацию: повторяем запрос в
      // плоском формате (без кэша, зато гарантированно рабочем) и дальше в
      // этом воркере кэш не просим.
      //
      // Откат срабатывает только на «плохой запрос» (400/422). На 5xx мы не
      // откатываемся: это не про формат, это про провайдера, и прятать 5xx под
      // «плоский формат» нельзя — потеряется причина отказа.
      if (!res.ok && wantCache && (res.status === 400 || res.status === 422)) {
        const rejected = await res.text().catch(() => "");
        logLlmEvent("warn", "polza: cache_control отклонён — откат на плоский формат", {
          provider: "polza",
          model: args.model,
          status: res.status,
          error: rejected.slice(0, 200),
          latencyMs: Date.now() - start,
        });
        res = await send(buildBody(false));
        if (res.ok) {
          state.cacheControlRejected = true;
          logLlmEvent("warn", "polza: cache_control в этом воркере отключён — запросы идут без кэша", {
            provider: "polza",
            model: args.model,
          });
        }
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
          /**
           * Счётчики prompt cache.
           *
           * `cached_tokens` — сколько входа прочитано из кэша провайдера,
           * `cache_write_tokens` — сколько в кэш записано этим вызовом.
           * Оба лежат ВНУТРИ `prompt_tokens`, то есть `prompt_tokens` — это
           * весь вход целиком, а эти два поля лишь расшифровывают его части
           * (https://polza.ai/docs/osobennosti/usage).
           */
          prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
          /**
           * Токены внутреннего размышления. OpenAI-совместимое поле — у одних
           * провайдеров `usage.completion_tokens_details.reasoning_tokens`,
           * у других (deepseek-подобные) — плоский `usage.reasoning_tokens`.
           * Читаем оба, иначе причина пустого ответа снова останется невидимой.
           */
          completion_tokens_details?: { reasoning_tokens?: number };
          reasoning_tokens?: number;
          /**
           * Фактическое списание в рублях — polza.ai кладёт его в каждый ответ
           * вместе с токенами («готовая стоимость в рублях, уже списанная»,
           * https://polza.ai/docs/osobennosti/usage). До 12.10.2026 это поле
           * приходило и молча игнорировалось: в `llm_logs` попадал только наш
           * расчёт по прайсу-снимку, а по счёту провайдера никто не сверялся.
           *
           * Поле опциональное и может прийти строкой (у polza суммы — строки с
           * восемью знаками, как и в balance API), поэтому Number(...) с проверкой
           * на NaN, а не прямое присваивание.
           */
          cost_rub?: number | string;
          /** Алиас polza.ai к cost_rub. */
          cost?: number | string;
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
      const cacheWriteTokens = data.usage?.prompt_tokens_details?.cache_write_tokens ?? 0;
      const latencyMs = Date.now() - start;

      // ── ДЕНЬГИ ───────────────────────────────────────────────────────────
      // Ключевой момент: тариф берём по ID модели из MODEL_CATALOG, а не по
      // имени провайдера. Раньше здесь было calcCost("polza", model, ...) —
      // первый аргумент попадал в параметр `model`, MODEL_COSTS["polza"]
      // не существует, и ВСЕ вызовы polza тарифицировались как 0 USD.
      // Подробности: docs/tz/11-photo-check.md §2.5 (расхождение №2).
      //
      // С КЭШОМ вход делится на части. polza отдаёт `prompt_tokens` = весь
      // вход ЦЕЛИКОМ, а `cached_tokens` / `cache_write_tokens` — часть этого
      // входа. Калькулятор (`llm/cost.ts`) считает кэш по семантике
      // Anthropic: `cacheRead` и `cacheWrite` идут СВЕРХ `tokensIn`. Если
      // отдать ему полный вход И счётчики кэша, кэшированная часть
      // посчитается дважды — и «экономия» превратится в переплату. Поэтому в
      // `tokensIn` уходит только то, что в кэш не попало.
      //
      // Если цену кэша в MODEL_COSTS мы не знаем (у модели нет
      // `cacheReadPer1M`) — считаем весь вход по полной цене. Это завышает
      // оценку, но не занижает: переоценка расхода видна, а выдуманная
      // экономия — нет.
      const cachePart = cachedTokens + cacheWriteTokens;
      const cachePriced = MODEL_COSTS[args.model]?.cacheReadPer1M != null;
      const cacheCounted = cachePart > 0 && cachePart <= tokensIn && cachePriced;
      const costUsd = calcCost(
        args.model,
        cacheCounted ? tokensIn - cachePart : tokensIn,
        tokensOut,
        cacheCounted ? { cacheRead: cachedTokens, cacheWrite: cacheWriteTokens } : undefined,
      );

      // Фактическое списание от провайдера. Если поля нет (старый ответ,
      // другой формат) — остаётся null, и работа продолжается на расчёте по
      // прайсу: НЕ подставляем ноль и НЕ падаем. Ноль здесь был бы ложью
      // («потратили 0 рублей»), и именно он потом тихо занизил бы расходы в
      // /superpower.
      const rawCostRub = data.usage?.cost_rub ?? data.usage?.cost;
      const parsedCostRub = rawCostRub === undefined ? Number.NaN : Number(rawCostRub);
      const costRub = Number.isFinite(parsedCostRub) ? parsedCostRub : null;

      if (costRub === null && rawCostRub !== undefined) {
        logLlmEvent("warn", "polza: usage.cost_rub не число — фактическое списание не записано", {
          provider: "polza",
          model: data.model ?? args.model,
          rawCostRub,
        });
      }

      logLlmEvent("info", "polza.complete ok", {
        provider: "polza",
        model: data.model ?? args.model,
        inputTokens: tokensIn,
        outputTokens: tokensOut,
        // Только числа: сколько входа провайдер прочитал из кэша и сколько
        // записал. Текста промпта в логе нет и не должно быть.
        cachedTokens,
        cacheWriteTokens,
        costUsd,
        costRub,
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
        // ТЗ-41: счётчики кэша доезжают до вызывающего. Раньше провайдер их
        // читал, но в ответ не клал — деньги за кэш нельзя было ни посчитать,
        // ни показать.
        cacheReadTokens: cachedTokens,
        cacheWriteTokens: cacheWriteTokens,
        costUsd,
        costRub,
        latencyMs,
        cached: cachedTokens > 0,
        // ТЗ-25, разрыв 4: причина остановки идёт в успешный ответ.
        // Раньше `finishReason` читался только для диагностики пустого content
        // и вверх не уходил, поэтому обрыв по `length` для иностранных
        // предметов проходил как нормальный результат.
        finishReason,
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