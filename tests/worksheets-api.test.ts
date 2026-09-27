/**
 * Тесты для `src/lib/worksheets/api.ts` — клиент POST /api/worksheets/save.
 *
 * Покрывает:
 *   1. saveWorksheet при 200  → { ok: true, worksheetId, generationsToday, generationsLimit }
 *   2. saveWorksheet при 401  → { ok: false, error: "unauthorized" } — silent skip для анонов
 *   3. saveWorksheet при 400  → { ok: false, error: "validation", details }
 *   4. saveWorksheet при fetch throw → { ok: false, error: "network" }
 *   5. saveWorksheet при 500  → { ok: false, error: "internal" }
 *   6. useUsage() хук: initial loading=true, после resolve — usage/generationsToday
 *   7. useUsage() хук: при fetch fail — usage = null
 *   8. saveWorksheet: URL и body/shape соответствуют контракту
 *   9.  saveWorksheet: lesson-plan payload → 200 (п.3 ЛК учителя)
 *   10. saveWorksheet: ktp payload → 200 (п.3 ЛК учителя)
 *   11. useUsage: refresh после saveWorksheet → usage обновился (п.2 ЛК учителя)
 *
 * Мок fetch'а через vi.stubGlobal — как в tests/auth-api.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as React from "react";

// Установим NEXT_PUBLIC_API_URL ДО импорта api.ts (модуль читает env на top-level).
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
});

import {
  saveWorksheet,
  type SaveWorksheetInput,
} from "@/lib/worksheets/api";
import { useUsage } from "@/lib/hooks/useUsage";

const API_URL = "https://api.example.test";

const okResponse = (body: unknown, status = 200) =>
  ({
    ok: true,
    status,
    statusText: "OK",
    json: async () => body,
  }) as unknown as Response;

const failResponse = (status: number, body: unknown = {}) =>
  ({
    ok: false,
    status,
    statusText: "Error",
    json: async () => body,
  }) as unknown as Response;

const validInput: SaveWorksheetInput = {
  subject: "math",
  grade: 7,
  topic: "algebra",
  title: "Лист 1",
  difficulty: "medium",
  tasks: [
    {
      number: 1,
      text: "2 + 2 = ?",
      type: "short-answer",
      answer: "4",
      points: 1,
      verified: true,
    },
  ],
  type: "worksheet",
  source: "mock",
};

beforeEach(() => {
  // Каждый тест переустановит мок fetch.
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// saveWorksheet: успех
// ─────────────────────────────────────────────────────────────────────────────

describe("saveWorksheet", () => {
  it("ok=true при 200 с полным контрактом", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        okResponse({
          ok: true,
          worksheetId: "ws_abc123",
          generationsToday: 1,
          generationsLimit: 3,
        }),
      ),
    );

    const r = await saveWorksheet(validInput);

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.worksheetId).toBe("ws_abc123");
      expect(r.generationsToday).toBe(1);
      expect(r.generationsLimit).toBe(3);
    }
  });

  it("ok=true при 200 для base/plus плана — generationsLimit = -1", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        okResponse({
          ok: true,
          worksheetId: "ws_base",
          generationsToday: 42,
          generationsLimit: -1,
        }),
      ),
    );

    const r = await saveWorksheet(validInput);

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.generationsLimit).toBe(-1);
    }
  });

  it("ok=true при невалидном shape от бэка — fallback в { ok:false, error:'internal' }", async () => {
    // Бэк по идее всегда отвечает консистентно, но если что-то пошло не так —
    // защищаемся через типизированный error, а не вываливаем undefined.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        okResponse({
          ok: true,
          // missing worksheetId
          generationsToday: 1,
          generationsLimit: 3,
        }),
      ),
    );

    const r = await saveWorksheet(validInput);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("internal");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// saveWorksheet: ошибки
// ─────────────────────────────────────────────────────────────────────────────

describe("saveWorksheet — ошибки", () => {
  it("401 → { ok:false, error:'unauthorized' }", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        failResponse(401, { error: "unauthorized" }),
      ),
    );

    const r = await saveWorksheet(validInput);

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("unauthorized");
    }
  });

  it("400 + details → { ok:false, error:'validation', details }", async () => {
    const details = [
      { path: "subject", message: "Required" },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        failResponse(400, { error: "validation", details }),
      ),
    );

    const r = await saveWorksheet(validInput);

    expect(r.ok).toBe(false);
    if (!r.ok && r.error === "validation") {
      expect(r.details).toEqual(details);
    } else {
      throw new Error("expected validation error");
    }
  });

  it("500 → { ok:false, error:'internal' }", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(failResponse(500, {})));

    const r = await saveWorksheet(validInput);

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("internal");
    }
  });

  it("fetch throw → { ok:false, error:'network' }", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    );

    const r = await saveWorksheet(validInput);

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("network");
    }
  });

  it("NEXT_PUBLIC_API_URL не задан → { ok:false, error:'network' } (silent skip)", async () => {
    const prev = process.env.NEXT_PUBLIC_API_URL;
    // Намеренно зануляем env чтобы протестить fallback-ветку (тихий skip
    // для dev-режима без API_URL). Затем перезагружаем модуль — top-level
    // `const API_URL = process.env...` прочитает уже пустое значение.
    Reflect.deleteProperty(process.env, "NEXT_PUBLIC_API_URL");
    try {
      vi.resetModules();
      const mod = await import("@/lib/worksheets/api");
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(okResponse({ ok: true })),
      );
      const r = await mod.saveWorksheet(validInput);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        // Нет URL — не пытаемся fetch'ить, сразу network-error.
        expect(r.error).toBe("network");
      }
    } finally {
      process.env.NEXT_PUBLIC_API_URL = prev;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// saveWorksheet: контракт fetch
// ─────────────────────────────────────────────────────────────────────────────

describe("saveWorksheet — контракт fetch", () => {
  it("POST /api/worksheets/save, credentials: 'include', Content-Type JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        ok: true,
        worksheetId: "ws_x",
        generationsToday: 0,
        generationsLimit: 3,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await saveWorksheet(validInput);

    const [calledUrl, calledInit] = fetchMock.mock.calls[0]!;
    expect(calledUrl).toBe(`${API_URL}/api/worksheets/save`);
    expect(calledInit.method).toBe("POST");
    expect(calledInit.credentials).toBe("include");
    expect(calledInit.headers["Content-Type"]).toBe("application/json");
    expect(calledInit.cache).toBe("no-store");
    const body = JSON.parse(calledInit.body as string);
    expect(body.subject).toBe("math");
    expect(body.grade).toBe(7);
    expect(body.tasks[0].text).toBe("2 + 2 = ?");
    expect(body.source).toBe("mock");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// useUsage хук (React Testing Library)
// ─────────────────────────────────────────────────────────────────────────────

import { render, waitFor, act } from "@testing-library/react";

describe("useUsage хук", () => {
  it("хук возвращает useUsageResult-shape и initial loading=true / usage=null", async () => {
    // Даже если fetch идёт долго — на первом рендере isLoading=true, usage=null.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        () =>
          new Promise(() => {
            // никогда не резолвится — проверяем именно initial state
          }),
      ),
    );

    let captured: ReturnType<typeof useUsage> | undefined;
    function Probe() {
      captured = useUsage();
      return null;
    }

    render(React.createElement(Probe));

    expect(captured).toBeDefined();
    expect(captured!.isLoading).toBe(true);
    expect(captured!.usage).toBeNull();
    expect(typeof captured!.refresh).toBe("function");
  });

  it("refresh при успешном fetch переводит usage в объект с generationsToday", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        okResponse({
          ok: true,
          generationsToday: 7,
          generationsLimit: -1,
          generationsResetAt: "2026-10-01T00:00:00Z",
          plan: "base",
        }),
      ),
    );

    let captured: ReturnType<typeof useUsage> | undefined;
    function Probe() {
      captured = useUsage();
      return null;
    }

    render(React.createElement(Probe));

    // Ждём пока mount-effect отработает и поставит usage с бэка.
    await waitFor(() => {
      expect(captured!.usage).not.toBeNull();
    });

    expect(captured!.usage!.generationsToday).toBe(7);
    expect(captured!.usage!.generationsLimit).toBe(-1);
    expect(captured!.usage!.plan).toBe("base");
    expect(captured!.isLoading).toBe(false);
  });

  it("refresh при 401 (AuthApiError) оставляет usage = null", async () => {
    // getUsage бросает AuthApiError на non-2xx. Наш useUsage ловит в catch → null.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(failResponse(401, { error: "no_session" })),
    );

    let captured: ReturnType<typeof useUsage> | undefined;
    function Probe() {
      captured = useUsage();
      return null;
    }

    render(React.createElement(Probe));

    // Даём mount-effect дойти до fetch и упасть в catch.
    await waitFor(() => {
      expect(captured!.isLoading).toBe(false);
    });

    // usage должен остаться null — анонимный flow / 401.
    expect(captured!.usage).toBeNull();
  });

  it("refresh после первого fetch можно вызвать вручную и стейт обновится", async () => {
    let resolveFn: (v: unknown) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveFn = resolve;
          }),
      ),
    );

    let captured: ReturnType<typeof useUsage> | undefined;
    function Probe() {
      captured = useUsage();
      return null;
    }

    render(React.createElement(Probe));
    expect(captured!.isLoading).toBe(true);

    // Дёргаем refresh вручную, контролируя когда fetch резолвится.
    const refreshPromise = act(async () => {
      await captured!.refresh();
    });

    // Завершаем fetch.
    resolveFn!(
      okResponse({
        ok: true,
        generationsToday: 99,
        generationsLimit: 3,
        generationsResetAt: null,
        plan: "free",
      }),
    );
    await refreshPromise;

    expect(captured!.usage).not.toBeNull();
    expect(captured!.usage!.generationsToday).toBe(99);
    expect(captured!.isLoading).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// п.2 + п.3 ЛК учителя: saveWorksheet для всех 4 типов + useUsage refresh
// ─────────────────────────────────────────────────────────────────────────────

describe("saveWorksheet — 3 новых типа артефактов (п.3 ЛК учителя)", () => {
  it("lesson-plan payload → 200 ok + contract", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        okResponse({
          ok: true,
          worksheetId: "ws_lp",
          generationsToday: 1,
          generationsLimit: 3,
        }),
      ),
    );

    const r = await saveWorksheet({
      type: "lesson-plan",
      subject: "math",
      grade: 7,
      topic: "algebra",
      title: "План урока · Алгебра",
      difficulty: "medium",
      goals: { educational: ["знать определения"], developmental: ["логика"], nurturing: ["аккуратность"] },
      equipment: ["доска", "мел"],
      stages: [
        {
          kind: "org-moment",
          title: "Оргмомент",
          durationMin: 2,
          teacherActions: "Приветствует",
          studentActions: "Приветствуют учителя",
        },
        {
          kind: "new-topic",
          title: "Объяснение нового",
          durationMin: 20,
          teacherActions: "Вводит понятие",
          studentActions: "Слушают",
        },
      ],
      homework: { text: "стр. 50 №5", alternatives: ["стр. 52 №3"] },
      fgosRef: "§ 7",
      source: "mock",
    });

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.worksheetId).toBe("ws_lp");
      expect(r.generationsToday).toBe(1);
      expect(r.generationsLimit).toBe(3);
    }

    // Проверяем, что body в fetch содержит type=lesson-plan и stages[].
    const fetchMock = vi.mocked(fetch);
    const [, calledInit] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(calledInit!.body as string);
    expect(body.type).toBe("lesson-plan");
    expect(Array.isArray(body.stages)).toBe(true);
    expect(body.stages).toHaveLength(2);
    expect(body.stages[0].kind).toBe("org-moment");
    expect(body.stages[1].kind).toBe("new-topic");
    expect(body.homework.text).toBe("стр. 50 №5");
    expect(body.fgosRef).toBe("§ 7");
  });

  it("presentation payload → 200 ok + contract", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        okResponse({
          ok: true,
          worksheetId: "ws_pres",
          generationsToday: 1,
          generationsLimit: 3,
        }),
      ),
    );

    const r = await saveWorksheet({
      type: "presentation",
      subject: "math",
      grade: 7,
      topic: "algebra",
      title: "Презентация · Линейные уравнения",
      slideCount: 5,
      slides: [
        { kind: "title", title: "Титул", bullets: ["7 класс"] },
        { kind: "definition", title: "Определение" },
        { kind: "example", title: "Пример" },
        { kind: "bullets", title: "Алгоритм" },
        { kind: "summary", title: "Итог" },
      ],
      theme: "default",
      source: "mock",
    });

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.worksheetId).toBe("ws_pres");
    }

    const fetchMock = vi.mocked(fetch);
    const [, calledInit] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(calledInit!.body as string);
    expect(body.type).toBe("presentation");
    expect(body.slideCount).toBe(5);
    expect(body.slides).toHaveLength(5);
    expect(body.slides[0].kind).toBe("title");
    expect(body.theme).toBe("default");
  });

  it("ktp payload → 200 ok + contract", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        okResponse({
          ok: true,
          worksheetId: "ws_ktp",
          generationsToday: 1,
          generationsLimit: 3,
        }),
      ),
    );

    const r = await saveWorksheet({
      type: "ktp",
      subject: "math",
      grade: 7,
      title: "КТП · Алгебра · 7 класс · 2026/2027",
      schoolYear: "2026/2027",
      totalHours: 68,
      weeks: [
        {
          weekNum: 1,
          entries: [
            { num: 1, dates: "01.09-05.09", topic: "Вводный урок", kind: "lesson", hours: 1 },
            { num: 2, dates: "01.09-05.09", topic: "Числовые выражения", kind: "lesson", hours: 1 },
          ],
        },
        {
          weekNum: 2,
          entries: [
            { num: 3, dates: "08.09-12.09", topic: "Контрольная (входная)", kind: "control", hours: 1 },
          ],
        },
      ],
      source: "mock",
    });

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.worksheetId).toBe("ws_ktp");
    }

    const fetchMock = vi.mocked(fetch);
    const [, calledInit] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(calledInit!.body as string);
    expect(body.type).toBe("ktp");
    expect(body.schoolYear).toBe("2026/2027");
    expect(body.totalHours).toBe(68);
    expect(Array.isArray(body.weeks)).toBe(true);
    expect(body.weeks).toHaveLength(2);
    expect(body.weeks[0].entries).toHaveLength(2);
    expect(body.weeks[1].entries[0].kind).toBe("control");
  });
});

describe("useUsage refresh после saveWorksheet (п.2 ЛК учителя)", () => {
  it("после успешного saveWorksheet → refreshUsage() обновляет usage.generationsToday", async () => {
    // Шаг 1: mount useUsage — usage начинает с 1 (например, после входа).
    let fetchCallCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        fetchCallCount++;
        // Первый запрос (mount) — generationsToday=1.
        // Второй запрос (refresh после save) — generationsToday=2.
        const today = fetchCallCount === 1 ? 1 : 2;
        return okResponse({
          ok: true,
          generationsToday: today,
          generationsLimit: 3,
          generationsResetAt: null,
          plan: "free",
        });
      }),
    );

    let captured: ReturnType<typeof useUsage> | undefined;
    function Probe() {
      captured = useUsage();
      return null;
    }

    render(React.createElement(Probe));

    // Ждём пока mount-effect отработает.
    await waitFor(() => {
      expect(captured!.usage).not.toBeNull();
    });
    expect(captured!.usage!.generationsToday).toBe(1);

    // Шаг 2: имитируем успешный saveWorksheet (отдельный endpoint — мок не критичен).
    // Главное — после save мы вызываем refreshUsage() и usage должен обновиться.
    await act(async () => {
      await captured!.refresh();
    });

    await waitFor(() => {
      expect(captured!.usage!.generationsToday).toBe(2);
    });
    expect(captured!.usage!.generationsToday).toBe(2);
    expect(captured!.isLoading).toBe(false);
    // Минимум 2 fetch-запроса: mount + refresh.
    expect(fetchCallCount).toBeGreaterThanOrEqual(2);
  });
});
