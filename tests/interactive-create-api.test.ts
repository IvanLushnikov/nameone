/**
 * Клиентский `createInteractive` (TZ-13 §4.5).
 *
 * Проверяем контракт с бэкендом, а не «что-то вернулось»: раньше функции не
 * существовало вообще, и `POST /api/interactives` не вызывался из интерфейса.
 * Теперь это единственная точка появления игры, поэтому форма запроса и
 * разбор ответа зафиксированы тестом — иначе регрессия выглядит как «кнопка
 * нажимается, а игры нет».
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  // Клиент читает API_URL из окружения на этапе импорта модуля, поэтому
  // подменяем переменную до `vi.resetModules()` и динамического импорта.
  vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.test");
  vi.resetModules();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function loadApi() {
  return await import("@/lib/interactives/api");
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("createInteractive — контракт с бэкендом", () => {
  it("шлёт POST с worksheetId, format и options", async () => {
    const { createInteractive } = await loadApi();
    fetchMock.mockResolvedValue(
      jsonResponse({
        ok: true,
        id: "int_abc",
        shareToken: "tok123",
        url: "https://uchlist.ru/play/?t=tok123",
        qrPayload: "https://uchlist.ru/play/?t=tok123",
      }),
    );

    const res = await createInteractive({
      worksheetId: "ws-1",
      format: "jeopardy",
      options: { itemCount: 12 },
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.test/api/interactives");
    expect(init.method).toBe("POST");
    // Cookie нужны: эндпоинт учительский, под requireAuth.
    expect(init.credentials).toBe("include");
    expect(JSON.parse(init.body as string)).toEqual({
      worksheetId: "ws-1",
      format: "jeopardy",
      options: { itemCount: 12 },
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.interactive.shareToken).toBe("tok123");
      expect(res.interactive.url).toContain("t=tok123");
    }
  });

  it("401 превращается в unauthorized, а не в «готово»", async () => {
    const { createInteractive } = await loadApi();
    fetchMock.mockResolvedValue(jsonResponse({ error: "UNAUTHORIZED" }, 401));
    const res = await createInteractive({ worksheetId: "ws-1", format: "quiz-race" });
    expect(res).toEqual({ ok: false, error: "unauthorized" });
  });

  it("ответ без shareToken считается внутренней ошибкой, а не успехом", async () => {
    const { createInteractive } = await loadApi();
    // Регрессия именно такого вида опасна: учитель увидел бы «игра готова»
    // без ссылки, и ученик не смог бы войти.
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, id: "int_abc" }));
    const res = await createInteractive({ worksheetId: "ws-1", format: "quiz-race" });
    expect(res).toEqual({ ok: false, error: "internal" });
  });
});
