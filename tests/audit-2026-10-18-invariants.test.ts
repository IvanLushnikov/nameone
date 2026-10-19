/**
 * Инварианты, которые закрывает аудит 18.10.2026 (волны 1–3).
 *
 * Каждый пункт — отдельная проверка, потому что каждый из них уже стоил
 * учителю чего-то конкретного:
 *
 *   1. Deep-link с несуществующей темой или классом не должен уходить в
 *      генерацию (тема проверяется по каталогу, а не «на глаз»).
 *   2. Кабинет открывает вкладку из `?tab=` — обещание «Выданное» на главной
 *      и ссылка «Выдать лист классу» вели в никуда.
 *   3. Заготовка (fallback) не повторяет одну и ту же фразу и не подставляет
 *      шаблон от другой темы.
 *   4. Остаток бесплатных листов берётся у сервера (`freeRemaining`), а не
 *      считается на клиенте.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/* ────────────────────────────────────────────────────────────────────────────
 * 1. Каталог — источник истины для deep-link
 * ──────────────────────────────────────────────────────────────────────────── */

describe("каталог тем и классов", () => {
  it("несуществующей темы в каталоге нет, существующая — есть", async () => {
    const { getTopic, getGrade } = await import("@/lib/content/subjects");

    // Именно эти проверки делает конструктор на deep-link (BUG-029/BUG-030).
    expect(getTopic("math", 5, "nesushchestvuyushchaya-tema")).toBeUndefined();
    expect(getGrade("math", 42)).toBeUndefined();

    expect(getTopic("math", 5, "drobi-obyknovennye")).toBeDefined();
    expect(getGrade("math", 5)).toBeDefined();
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 3. Заготовка: без дословных повторов и без чужой темы
 * ──────────────────────────────────────────────────────────────────────────── */

describe("заготовка листа", () => {
  it("задания не повторяются дословно и не подставляют шаблон от другой темы", async () => {
    const { generateWorksheet } = await import("@/lib/mock/generator");

    const ws = await generateWorksheet({
      subject: "math",
      grade: 5,
      topic: "m-neravenstva-5",
      type: "worksheet",
      difficulty: "medium",
      count: 10,
      withAnswers: true,
      withExplanations: true,
    } as never);

    expect(ws.tasks.length).toBeGreaterThanOrEqual(10);

    // 1) Ни одно задание не повторяется дословно.
    const texts = ws.tasks.map((t) => t.text.trim());
    expect(new Set(texts).size).toBe(texts.length);

    // 2) В задании про тему не должно быть «предмета» — это заглушка
    //    («…по теме „предмет“»), а не задание.
    for (const t of ws.tasks) {
      expect(t.text).not.toMatch(/по теме [«"]?предмет/i);
    }

    // 3) В заголовке — настоящая тема, а не слово «предмет».
    expect(ws.title).not.toMatch(/предмет/i);
    expect(ws.title.length).toBeGreaterThan(5);
  });

  it("на листе из 30 заданий тоже нет дословных повторов", async () => {
    const { generateWorksheet } = await import("@/lib/mock/generator");

    const ws = await generateWorksheet({
      subject: "history",
      grade: 7,
      topic: "voina-1812-god",
      type: "worksheet",
      difficulty: "medium",
      count: 30,
      withAnswers: true,
      withExplanations: true,
    } as never);

    const texts = ws.tasks.map((t) => t.text.trim());
    expect(texts.length).toBe(30);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it("критерий ответа помечен явно — учитель понимает, что это не ответ", async () => {
    const { generateWorksheet } = await import("@/lib/mock/generator");

    const ws = await generateWorksheet({
      subject: "chemistry",
      grade: 8,
      topic: "osnovnye-ponyatiya-himii",
      type: "worksheet",
      difficulty: "medium",
      count: 5,
      withAnswers: true,
      withExplanations: true,
    } as never);

    for (const t of ws.tasks) {
      expect(t.answer).toMatch(/Критерий ответа/i);
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 4. Остаток бесплатных листов — из сервера
 * ──────────────────────────────────────────────────────────────────────────── */

describe("остаток бесплатных листов", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("useUsage отдаёт серверный freeRemaining, а не клиентскую константу", async () => {
    // Адрес сервера читается на верхнем уровне модуля — задаём до импорта.
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example.test");
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          generationsToday: 16,
          generationsLimit: 3,
          plan: "free",
          freeRemaining: 5,
          freeUsed: 0,
          freeResetsAt: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { fetchUsage } = await import("@/lib/auth/api");
    const usage = await fetchUsage();

    // Сервер сказал 5 — клиент обязан поверить серверу, даже если в ответе
    // есть старое `generationsToday: 16`.
    expect(usage?.freeRemaining).toBe(5);
    expect(usage?.freeUsed).toBe(0);
  });
});
