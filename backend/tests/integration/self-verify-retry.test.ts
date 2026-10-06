/**
 * Повтор первого прохода self-verify при пустом ответе провайдера (06.10.2026).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ЛОВИТ ЭТОТ ТЕСТ
 *
 * На проде ручка POST /api/llm/verify периодически отвечала 500 с телом
 * «LLM: all providers failed (1 attempts). Last: polza вернул пустой content».
 * Замер на ОДНОЙ И ТОЙ ЖЕ задаче («Сколько будет 2/5 + 3/5?»), 6 одинаковых
 * запросов подряд: 4 успеха, 2 отказа. Промпт один, temperature: 0 — значит
 * ответ не детерминирован и повтор той же задачи реально помогает.
 *
 * Тест закрывает ровно три свойства этой правки:
 *   1. пустой ответ → повтор происходит РОВНО ОДИН раз, и если повтор успешен,
 *      ручка отвечает нормальным 200-ответом с вердиктом;
 *   2. два пустых ответа подряд → отказ, и запросов к провайдеру ровно ДВА
 *      (никакого шторма: бесконечный повтор сжигал бы деньги на платном API);
 *   3. успешный первый ответ → повтора нет вообще (вызовов ровно два:
 *      solve + verify).
 *
 * Плюс проверяется, что повтор не становится «бесплатным вызовом, которого не
 * видно в счёте»: он попадает в llm_logs и recordUsage ровно так же, как
 * обычный вызов — тест считает строки INSERT в llm_logs.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * КАК ПОДМЕНЕНА СЕТЬ
 *
 * Тот же приём, что в polza-cost-regression.test.ts: `vi.stubGlobal("fetch")`.
 * Реальный polza.ai не трогаем — это платный API, и тест не должен ни стучаться
 * в сеть, ни зависеть от неё. Здесь важно, что подменяется ИМЕННО сетевой вызов
 * (fetch внутри providers/polza.ts), а не какой-то внутренний хелпер: тест идёт
 * через настоящий код провайдера, роутера и verifySelfTask.
 *
 * D1 здесь — простая заглушка: реальной базы в node-пуле нет, а verifySelfTask
 * на плане "free" с userId=null вообще не ходит в usage_counters (recordUsage
 * возвращает null). Именно поэтому план "free": он позволяет проверять учёт
 * расхода по llm_logs, не поднимая схему подписок и квот.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { verifySelfTask } from "../../src/llm";
import { _resetPolzaSingleton } from "../../src/llm/providers/polza";
import type { Env } from "../../src/env";

const FAKE_ENV = {
  POLZA_API_KEY: "test-key",
  APP_ENV: "test",
  APP_BASE_URL: "http://localhost:8787",
  FRONTEND_URL: "http://localhost:3000",
  JWT_SECRET: "test-secret",
} as unknown as Env;

const TASK = {
  subject: "math",
  grade: 5,
  topic: "drobi",
  text: "Сколько будет 2/5 + 3/5? Напишите только числовую дробь.",
  expectedAnswer: "1",
};

/** Ответ polza с НЕПУСТЫМ content — успешный вызов. */
function okResponse(content: string): unknown {
  return {
    model: "deepseek/deepseek-v4-flash",
    choices: [{ message: { content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 },
  };
}

/**
 * Ответ polza с ПУСТЫМ content и finish_reason: "length" — картина
 * «лимит токенов съеден размышлением». Именно её разбирает новая диагностика
 * в providers/polza.ts.
 */
function emptyContentResponse(): unknown {
  return {
    model: "deepseek/deepseek-v4-flash",
    choices: [{ message: { content: "" }, finish_reason: "length" }],
    usage: {
      prompt_tokens: 120,
      completion_tokens: 800,
      total_tokens: 920,
      completion_tokens_details: { reasoning_tokens: 800 },
    },
  };
}

/** Одна вставленная строка llm_logs: позиционные параметры logLlmCall. */
interface LoggedCall {
  sql: string;
  args: unknown[];
}

/**
 * Заглушка D1: verifySelfTask пишет в llm_logs, и нам нужно видеть, что туда
 * попало. Никакой настоящей схемы не требуется — план "free" не доходит до
 * usage_counters (recordUsage выходит сразу по userId === null).
 */
function fakeDb(logged: LoggedCall[]): unknown {
  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async run() {
              logged.push({ sql, args });
              return { success: true };
            },
          };
        },
      };
    },
  };
}

/** Тело запроса к провайдеру — нужно, чтобы проверить max_tokens. */
function sentBodies(fetchMock: ReturnType<typeof vi.fn>): Array<Record<string, unknown>> {
  return fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)) as Record<string, unknown>);
}

/**
 * Запустить verifySelfTask на подменённой сети.
 * `responses` — что провайдер отвечает на 1-й, 2-й, 3-й вызов; на последнем
 * ответе повторяется (если вызовов окажется больше, чем ожидаем, тест это
 * поймает счётчиком, а не тихо пройдёт).
 */
async function runWithResponses(responses: unknown[]): Promise<{
  fetchMock: ReturnType<typeof vi.fn>;
  logged: LoggedCall[];
  result: Awaited<ReturnType<typeof verifySelfTask>>;
}> {
  const logged: LoggedCall[] = [];
  let i = 0;
  const fetchMock = vi.fn(async () => {
    const body = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  const result = await verifySelfTask(
    { task: TASK, userId: null, plan: "free" },
    FAKE_ENV,
    fakeDb(logged) as never,
  );
  return { fetchMock, logged, result };
}

describe("verifySelfTask: повтор при пустом ответе первого прохода", () => {
  beforeEach(() => {
    // Провайдер — синглтон на isolate: без сброса второй тест получил бы
    // baseUrl/ключ из первого и мы бы проверяли не то окружение.
    _resetPolzaSingleton();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    _resetPolzaSingleton();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("пустой solve → один повтор → успех, а не 500", async () => {
    const solveText = "Шаг 1: складываем дроби с одним знаменателем\nШаг 2: (2+3)/5 = 5/5\nОтвет: 1";
    const { fetchMock, result } = await runWithResponses([
      emptyContentResponse(),
      okResponse(solveText),
      okResponse('{"verified": true, "reason": "ответ верный"}'),
    ]);

    // Вызовов ровно три: solve (пустой), solve (повтор), verify.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.verified).toBe(true);
    expect(result.answer).toBe("1");
  });

  it("два пустых ответа подряд → отказ, и запросов ровно два (повтор не превращается в цикл)", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(emptyContentResponse()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const logged: LoggedCall[] = [];
    // Ни одного успешного ответа нет → verify-проход не должен даже начинаться.
    await expect(
      verifySelfTask({ task: TASK, userId: null, plan: "free" }, FAKE_ENV, fakeDb(logged) as never),
    ).rejects.toThrow();

    // Ровно два: первая попытка + РОВНО один повтор. Третьего вызова нет.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Проверочный проход не запускался — незачем платить за вызов, который
    // всё равно не с чем сверять.
    expect(sentBodies(fetchMock).some((b) => b.response_format !== undefined)).toBe(false);
  });

  it("успешный первый ответ → повтора нет: ровно два вызова (solve + verify)", async () => {
    const solveText = "Шаг 1: общий знаменатель 5\nШаг 2: 2/5 + 3/5 = 5/5 = 1\nОтвет: 1";
    const { fetchMock, result } = await runWithResponses([
      okResponse(solveText),
      okResponse('{"verified": true, "reason": "ответ верный"}'),
    ]);

    // Два вызова — значит solve не повторялся: пустого ответа не было.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.verified).toBe(true);
  });

  it("повтор виден в счёте: в llm_logs попадают обе строки — solve и verify", async () => {
    const solveText = "Шаг 1: 2/5 + 3/5\nОтвет: 1";
    const { logged } = await runWithResponses([
      emptyContentResponse(),
      okResponse(solveText),
      okResponse('{"verified": true, "reason": "ответ верный"}'),
    ]);

    const inserts = logged.filter((c) => c.sql.includes("INSERT INTO llm_logs"));
    // Ровно две строки на два УСПЕШНЫХ вызова. Неуспешная попытка отдельной
    // строки не даёт: провайдер за пустой ответ не берёт деньги, тарифицировать
    // нечего. Важно, что повтор не спрятан — он и есть строка solve.
    expect(inserts).toHaveLength(2);

    // cost_usd по позициям logLlmCall: tokensIn, tokensOut, costUsd — подтверждаем,
    // что учёт не нулевой (иначе повтор был бы «бесплатным вызовом»).
    const solveRow = inserts[0]!.args;
    expect(solveRow[2]).toBe("validate");
    expect(Number(solveRow[7])).toBeGreaterThan(0);
    expect(Number(solveRow[8])).toBeGreaterThan(0);
  });

  it("лимит токенов solve поднят до 2000, у verify остался 800", async () => {
    // 800 был потолком для всего развёрнутого решения, и на модели с
    // размышлением его съедало внутреннее «обдумывание» (finish_reason=length).
    // Проверяем числа запроса, а не комментарий.
    const solveText = "Ответ: 1";
    const { fetchMock } = await runWithResponses([
      okResponse(solveText),
      okResponse('{"verified": true, "reason": "ответ верный"}'),
    ]);

    const bodies = sentBodies(fetchMock);
    expect(bodies[0]!.max_tokens).toBe(2000);
    // Проверочный проход отдаёт короткий JSON — трогать его лимит не было
    // оснований, он и не при чём в отказе.
    expect(bodies[1]!.max_tokens).toBe(800);
  });
});