/**
 * Ответ модели не уезжает клиенту вместе с ошибкой 502.
 *
 * Ревью безопасности 30.10.2026, находка №9.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО БЫЛО
 *
 * В двух местах `llm/index.ts` в `details` ошибки 502 клался сырой ответ
 * модели (до 200 символов). Глобальный обработчик отдаёт `details` клиенту —
 * и в проде тоже, в отличие от стектрейсов, которые в проде не утекают.
 *
 * Текст модели в этих местах — рассуждения по заданию учителя. Чужих данных
 * там нет, но отдавать сырой вывод модели в браузер незачем: в лог он попасть
 * может, в ответ клиенту — не должен.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * КАК ПРОВЕРЯЕТСЯ
 *
 * Тест идёт через настоящий код провайдера, роутера и `verifySelfTask` — с
 * подменённым `fetch`, чтобы не трогать платный polza.ai. Второй проход
 * (verify) возвращает модельный текст с меткой-секретом: метка не должна
 * появиться в `details` ошибки, но должна попасть в лог.
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

/** Метка, которой нет ни в одном реальном ответе: если она в ответе — тест виноват. */
const SECRET_MARKER = "SEKRET-tekst-modeli-0123456789";

/** Ответ polza с разбираемым content. */
function okResponse(content: string): unknown {
  return {
    model: "deepseek/deepseek-v4-flash",
    choices: [{ message: { content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 },
  };
}

/** Заглушка D1: verifySelfTask пишет в llm_logs — нужен только факт записи. */
function fakeDb(): unknown {
  return {
    prepare() {
      return {
        bind() {
          return {
            async run() {
              return { success: true };
            },
          };
        },
      };
    },
  };
}

/**
 * Прогнать verifySelfTask на подменённой сети.
 * `responses` — что провайдер отвечает на 1-й и 2-й вызов.
 */
async function runWithResponses(responses: unknown[]): Promise<unknown> {
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

  return verifySelfTask(
    { task: TASK, userId: null, plan: "free" },
    FAKE_ENV,
    fakeDb() as never,
  );
}

beforeEach(() => {
  _resetPolzaSingleton();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ошибка 502 не отдаёт текст модели клиенту", () => {
  it("verify-проход вернул неожиданный формат: в details нет текста модели", async () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });

    // Первый проход отвечает разбираемым ответом, второй — мусором, в котором
    // есть метка. Именно этот текст раньше уезжал клиенту в `details`.
    await expect(
      runWithResponses([
        okResponse("Ответ: 1"),
        okResponse(`{ это не json. ${SECRET_MARKER} }`),
      ]),
    ).rejects.toMatchObject({ status: 502, code: "LLM_BAD_RESPONSE" });

    // В ошибке — код и модель, но НЕ текст модели.
    const thrown = await runWithResponses([
      okResponse("Ответ: 1"),
      okResponse(`{ это не json. ${SECRET_MARKER} }`),
    ]).catch((e: unknown) => e as { details?: Record<string, unknown> });

    const details = (thrown as { details?: Record<string, unknown> }).details ?? {};
    expect(JSON.stringify(details)).not.toContain(SECRET_MARKER);
    expect(details.model).toBeTruthy();

    // Зато текст модели ушёл в лог — разбираться должен инженер, не учитель.
    expect(errors.join("\n")).toContain(SECRET_MARKER);

    spy.mockRestore();
  });

  it("solve-проход не вернул ответ: в details нет текста модели", async () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });

    const thrown = await runWithResponses([
      okResponse(`рассуждение модели без ответа. ${SECRET_MARKER}`),
      okResponse(`{ это не json. ${SECRET_MARKER} }`),
    ]).catch((e: unknown) => e as { details?: Record<string, unknown>; status?: number });

    expect((thrown as { status?: number }).status).toBe(502);
    const details = (thrown as { details?: Record<string, unknown> }).details ?? {};
    expect(JSON.stringify(details)).not.toContain(SECRET_MARKER);
    expect(errors.join("\n")).toContain(SECRET_MARKER);

    spy.mockRestore();
  });
});
