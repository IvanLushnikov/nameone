/**
 * Честность генерации: заготовка не должна выдаваться за готовый лист.
 *
 * Аудит 18.10.2026, BUG-013/BUG-018:
 *   - сервер просил подтвердить, что запрос отправил человек (409
 *     TURNSTILE_REQUIRED), а подтвердить было нечем (sitekey не задан);
 *   - клиент на это возвращал `null`, а `null` означал «упади в мок»;
 *   - учитель получал типовой лист с зелёным тостом «Готово!» и уходил
 *     отдавать его классу.
 *
 * Что проверяется здесь:
 *   1. Сервер ответил 5xx — заготовка НЕ подставляется, бросается честная
 *      ошибка.
 *   2. Сервер попросил капчу, а капчу взять нечем — отдельная ошибка
 *      CHALLENGE_UNAVAILABLE, а не заготовка.
 *   3. В сборке вообще без адреса сервера (dev/стенд) — заготовка допустима
 *      и честно помечена: isDemo + demoReason = "no_backend".
 *   4. Тип без серверного эндпоинта («урок целиком») — заготовка и есть
 *      реализация, там она допустима.
 *
 * Клиент читает `NEXT_PUBLIC_API_URL` на верхнем уровне модуля, поэтому на
 * каждый случай модуль импортируется заново (vi.resetModules + динамический
 * import) — иначе все тесты видели бы адрес из первого импорта.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const REQUEST = {
  subject: "math",
  grade: 5,
  topic: "drobi-obyknovennye",
  type: "worksheet" as const,
  difficulty: "medium" as const,
  count: 10,
  withAnswers: true,
  withExplanations: true,
} as const;

/** Перезагружает клиентский модуль с нужным адресом сервера. */
async function loadClient(apiUrl: string | undefined) {
  vi.resetModules();
  if (apiUrl === undefined) {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "");
  } else {
    vi.stubEnv("NEXT_PUBLIC_API_URL", apiUrl);
  }
  return await import("@/lib/client/llm");
}

/** Ответ сервера: нужный статус и тело. */
function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("заготовка не подставляется вместо ответа сервера", () => {
  it("5xx от сервера — честная ошибка, а не типовой лист", async () => {
    const { generateWorksheetSmart } = await loadClient("https://api.example.test");
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(reply(500, { error: "boom" }));

    await expect(generateWorksheetSmart(REQUEST)).rejects.toThrow(
      /Сервер не ответил/,
    );
  });

  it("сервер ответил 200, но листа в ответе нет — тоже ошибка, а не заготовка", async () => {
    const { generateWorksheetSmart } = await loadClient("https://api.example.test");
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(reply(200, { ok: true }));

    await expect(generateWorksheetSmart(REQUEST)).rejects.toThrow(/Сервер не ответил/);
  });

  it("капчу просят, а взять нечем — CHALLENGE_UNAVAILABLE, а не заготовка", async () => {
    const { generateWorksheetSmart, BackendError } = await loadClient(
      "https://api.example.test",
    );
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      reply(409, { error: " captcha required", code: "TURNSTILE_REQUIRED" }),
    );

    const err = await generateWorksheetSmart(REQUEST).catch((e) => e);
    expect(err).toBeInstanceOf(BackendError);
    expect(err.isChallengeUnavailable).toBe(true);
    expect(err.isChallengeRequired).toBe(false);
  });

  it("в сборке без адреса сервера заготовка допустима, но честно помечена", async () => {
    const { generateWorksheetSmart } = await loadClient(undefined);
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(reply(500, {}));

    const r = await generateWorksheetSmart(REQUEST);
    expect(r.isDemo).toBe(true);
    expect(r.demoReason).toBe("no_backend");
    // Заготовка — это заготовка: у неё нет «проверенных» заданий.
    expect(r.worksheet.tasks.length).toBeGreaterThan(0);
  });

  it("ошибка квоты и ошибка тарифа — ответы сервера, а не заготовка", async () => {
    const { generateWorksheetSmart, BackendError } = await loadClient(
      "https://api.example.test",
    );
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      reply(429, { error: "квота кончилась", code: "RATE_LIMIT" }),
    );

    const err = await generateWorksheetSmart(REQUEST).catch((e) => e);
    expect(err).toBeInstanceOf(BackendError);
    expect(err.isQuotaExceeded).toBe(true);
  });
});
