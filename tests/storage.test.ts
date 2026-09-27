/**
 * Тесты для `src/lib/utils/storage.ts` — F-06 аудит, чтобы зафиксировать
 * контракт хранилища после фиксов B-3 (toggleFavorite unification) и
 * B-4 (discriminated union в getFavorites).
 *
 * Скоуп: все публичные функции storage. Покрывает:
 *   1. addToHistory — добавляет, дедуплицирует, ограничивает 50.
 *   2. removeFromHistory — удаляет по id.
 *   3. toggleFavorite — флипает флаг И синхронизирует KEY_FAVORITES (если передан item).
 *   4. getTemplates / addTemplate / removeTemplate — CRUD.
 *   5. getProfile / setProfile / signOut — set/get, signOut чистит все ключи.
 *   6. saveFavorite / removeFavorite / isFavorited — для всех 4 типов артефактов.
 *   7. logEvent / getEvents — добавляет, ограничивает 500.
 *
 * localStorage-jsdom подключён через `environment: 'jsdom'` (см. vitest.config.ts).
 * Чтобы тесты не зависели от данных других тестов, чистим localStorage в beforeEach.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type {
  UserHistoryItem,
  Worksheet,
  LessonPlan,
  Presentation,
  Ktp,
} from "@/lib/types";
import {
  addToHistory,
  getHistory,
  removeFromHistory,
  toggleFavorite,
  getTemplates,
  addTemplate,
  removeTemplate,
  getProfile,
  setProfile,
  signOut,
  getFavorites,
  saveFavorite,
  removeFavorite,
  isFavorited,
  logEvent,
  getEvents,
  type FavoriteArtifact,
} from "@/lib/utils/storage";

/** Хелпер для детерминированной метки времени. */
const FIXED_TS = "2026-09-27T10:00:00.000Z";

/** Хелпер для генерации минимального валидного Worksheet. */
function mkWorksheet(over: Partial<Worksheet> = {}): Worksheet {
  return {
    id: "ws-1",
    title: "Дроби",
    subject: "math",
    grade: 5,
    topic: "drobi",
    difficulty: "medium",
    tasks: [
      {
        number: 1,
        text: "2+2",
        type: "computation",
        answer: "4",
        points: 1,
      },
    ],
    createdAt: FIXED_TS,
    ...over,
  };
}

function mkLessonPlan(over: Partial<LessonPlan> = {}): LessonPlan {
  return {
    id: "lp-1",
    title: "План урока",
    subject: "math",
    grade: 5,
    topic: "drobi",
    goals: { educational: ["a"], developmental: ["b"], nurturing: ["c"] },
    equipment: ["Доска"],
    stages: [
      {
        kind: "org-moment",
        title: "Орг. момент",
        durationMin: 2,
        teacherActions: "Приветствие",
        studentActions: "Приветствуют",
      },
    ],
    homework: { text: "Стр. 10 №5" },
    createdAt: FIXED_TS,
    ...over,
  };
}

function mkPresentation(over: Partial<Presentation> = {}): Presentation {
  return {
    id: "pres-1",
    title: "Презентация",
    subject: "math",
    grade: 5,
    topic: "drobi",
    slideCount: 5,
    slides: [{ kind: "title", title: "Тема", bullets: ["п1", "п2"] }],
    theme: "default",
    createdAt: FIXED_TS,
    ...over,
  };
}

function mkKtp(over: Partial<Ktp> = {}): Ktp {
  return {
    id: "ktp-1",
    title: "КТП",
    subject: "math",
    grade: 5,
    schoolYear: "2026/2027",
    totalHours: 68,
    weeks: [
      {
        weekNum: 1,
        entries: [
          {
            num: 1,
            dates: "01.09–05.09",
            topic: "Дроби",
            kind: "lesson",
            hours: 1,
          },
        ],
      },
    ],
    createdAt: FIXED_TS,
    ...over,
  };
}

function mkHistoryItem(over: Partial<UserHistoryItem> = {}): UserHistoryItem {
  return {
    id: "h-1",
    type: "worksheet",
    title: "Дроби",
    subject: "math",
    grade: 5,
    createdAt: FIXED_TS,
    isFavorite: false,
    ...over,
  };
}

function mkTemplate(over: Partial<ReturnType<typeof getTemplates>[number]> = {}) {
  return {
    id: "t-1",
    name: "Шаблон: дроби 5 класс",
    subject: "math" as const,
    grade: 5,
    topic: "drobi",
    difficulty: "medium" as const,
    count: 10,
    ...over,
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("addToHistory", () => {
  it("добавляет элемент в начало списка", () => {
    addToHistory(mkHistoryItem({ id: "a" }));
    addToHistory(mkHistoryItem({ id: "b" }));

    const h = getHistory();
    expect(h.map((x) => x.id)).toEqual(["b", "a"]);
  });

  it("дедуплицирует по id (новый перезаписывает старый, наверху)", () => {
    addToHistory(mkHistoryItem({ id: "a", title: "v1" }));
    addToHistory(mkHistoryItem({ id: "b", title: "B" }));
    addToHistory(mkHistoryItem({ id: "a", title: "v2" }));

    const h = getHistory();
    expect(h.map((x) => x.id)).toEqual(["a", "b"]);
    expect(h[0].title).toBe("v2");
  });

  it("ограничивает 50 элементами (FIFO по голове списка)", () => {
    for (let i = 0; i < 60; i += 1) {
      addToHistory(mkHistoryItem({ id: String(i) }));
    }
    const h = getHistory();
    expect(h.length).toBe(50);
    // Самый новый — id=59, самый старый из хранимых — id=10.
    expect(h[0].id).toBe("59");
    expect(h[49].id).toBe("10");
  });
});

describe("removeFromHistory", () => {
  it("удаляет элемент по id", () => {
    addToHistory(mkHistoryItem({ id: "a" }));
    addToHistory(mkHistoryItem({ id: "b" }));
    addToHistory(mkHistoryItem({ id: "c" }));

    removeFromHistory("b");
    const h = getHistory();
    expect(h.map((x) => x.id)).toEqual(["c", "a"]);
  });

  it("no-op если id нет", () => {
    addToHistory(mkHistoryItem({ id: "a" }));
    removeFromHistory("missing");
    expect(getHistory().map((x) => x.id)).toEqual(["a"]);
  });
});

describe("toggleFavorite", () => {
  it("флипает флаг isFavorite в истории (fallback без item)", () => {
    addToHistory(mkHistoryItem({ id: "a", isFavorite: false }));
    toggleFavorite("a");
    expect(getHistory().find((x) => x.id === "a")?.isFavorite).toBe(true);
    toggleFavorite("a");
    expect(getHistory().find((x) => x.id === "a")?.isFavorite).toBe(false);
  });

  it("с item: добавляет в KEY_FAVORITES при первом toggle, удаляет при повторном", () => {
    const ws = mkWorksheet({ id: "ws-x" });
    addToHistory(mkHistoryItem({ id: "ws-x" }));

    // First toggle with item — save into favorites.
    toggleFavorite("ws-x", ws);
    expect(isFavorited("ws-x")).toBe(true);
    expect(getFavorites()).toHaveLength(1);
    expect((getFavorites()[0] as Worksheet).tasks.length).toBe(1);

    // Second toggle — remove from favorites (and flip flag back).
    toggleFavorite("ws-x", ws);
    expect(isFavorited("ws-x")).toBe(false);
    expect(getFavorites()).toHaveLength(0);
  });

  it("с item: если id уже в KEY_FAVORITES, удаляет; иначе — добавляет", () => {
    // Pre-seed favorites directly (constructor flow).
    const ws = mkWorksheet({ id: "ws-y" });
    saveFavorite(ws);
    addToHistory(mkHistoryItem({ id: "ws-y" }));

    // Pass same item: should remove from favorites (existing check).
    toggleFavorite("ws-y", ws);
    expect(isFavorited("ws-y")).toBe(false);
  });
});

describe("templates CRUD", () => {
  it("addTemplate добавляет в начало", () => {
    addTemplate(mkTemplate({ id: "t1" }));
    addTemplate(mkTemplate({ id: "t2" }));
    expect(getTemplates().map((t) => t.id)).toEqual(["t2", "t1"]);
  });

  it("removeTemplate удаляет по id", () => {
    addTemplate(mkTemplate({ id: "t1" }));
    addTemplate(mkTemplate({ id: "t2" }));
    removeTemplate("t1");
    expect(getTemplates().map((t) => t.id)).toEqual(["t2"]);
  });

  it("getTemplates возвращает [] если хранилище пусто", () => {
    expect(getTemplates()).toEqual([]);
  });
});

describe("profile", () => {
  it("setProfile + getProfile", () => {
    setProfile({
      id: "u1",
      email: "a@b.ru",
      name: "A",
      plan: "free",
      generationsTotal: 0,
      generationsToday: 0,
      generationsLimit: 3,
      createdAt: FIXED_TS,
    });
    const p = getProfile();
    expect(p?.email).toBe("a@b.ru");
    expect(p?.plan).toBe("free");
  });

  it("signOut чистит профиль, историю и шаблоны", () => {
    setProfile({
      id: "u1",
      email: "a@b.ru",
      name: "A",
      plan: "free",
      generationsTotal: 0,
      generationsToday: 0,
      generationsLimit: 3,
      createdAt: FIXED_TS,
    });
    addToHistory(mkHistoryItem({ id: "h1" }));
    addTemplate(mkTemplate({ id: "t1" }));
    saveFavorite(mkWorksheet({ id: "ws-z" }));

    signOut();

    expect(getProfile()).toBeNull();
    expect(getHistory()).toEqual([]);
    expect(getTemplates()).toEqual([]);
    // getFavorites НЕ чистится signOut — это by-design (favorites хранятся отдельно).
    // Проверяем отдельно:
    expect(isFavorited("ws-z")).toBe(true);
  });

  it("signOut диспатчит PROFILE_CHANGED_EVENT (same-tab refresh для UI)", () => {
    // Контракт: после signOut Header (и другие подписчики в той же вкладке)
    // должны узнать об изменении через CustomEvent 'profile-changed'.
    // `storage` event выстреливает только cross-tab, поэтому без явного
    // dispatchEvent UI не обновится до перезагрузки.
    setProfile({
      id: "u1",
      email: "a@b.ru",
      name: "A",
      plan: "free",
      generationsTotal: 0,
      generationsToday: 0,
      generationsLimit: 3,
      createdAt: FIXED_TS,
    });

    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    signOut();

    const fired = dispatchSpy.mock.calls.some(
      ([evt]) => evt instanceof Event && evt.type === "profile-changed",
    );
    expect(fired).toBe(true);

    dispatchSpy.mockRestore();
  });

  it("signOut диспатчит PROFILE_CHANGED_EVENT даже если профиля не было", () => {
    // signOut должен уведомлять UI в любом случае — иначе выход без
    // активного профиля оставит UI в потенциально stale состоянии.
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    signOut();

    const fired = dispatchSpy.mock.calls.some(
      ([evt]) => evt instanceof Event && evt.type === "profile-changed",
    );
    expect(fired).toBe(true);

    dispatchSpy.mockRestore();
  });
});

describe("favorites (saveFavorite / removeFavorite / isFavorited)", () => {
  // F-06 B-4: должен принимать все 4 типа артефактов без потери данных.
  const cases: Array<{ name: string; mk: () => FavoriteArtifact; id: string }> = [
    { name: "Worksheet", mk: () => mkWorksheet({ id: "f-ws" }), id: "f-ws" },
    { name: "LessonPlan", mk: () => mkLessonPlan({ id: "f-lp" }), id: "f-lp" },
    { name: "Presentation", mk: () => mkPresentation({ id: "f-pr" }), id: "f-pr" },
    { name: "Ktp", mk: () => mkKtp({ id: "f-ktp" }), id: "f-ktp" },
  ];

  for (const c of cases) {
    it(`saveFavorite сохраняет ${c.name} и isFavorited возвращает true`, () => {
      const a = c.mk();
      saveFavorite(a);
      expect(isFavorited(c.id)).toBe(true);
      const fav = getFavorites();
      expect(fav).toHaveLength(1);
      expect(fav[0].id).toBe(c.id);
    });
  }

  it("saveFavorite дедуплицирует по id и ставит в начало", () => {
    const a = mkWorksheet({ id: "x", title: "v1" });
    const b = mkWorksheet({ id: "y", title: "Y" });
    const a2 = mkWorksheet({ id: "x", title: "v2" });
    saveFavorite(a);
    saveFavorite(b);
    saveFavorite(a2);

    const fav = getFavorites();
    expect(fav.map((x) => x.id)).toEqual(["x", "y"]);
    expect((fav[0] as Worksheet).title).toBe("v2");
  });

  it("saveFavorite ограничивает 30 элементами", () => {
    for (let i = 0; i < 35; i += 1) {
      saveFavorite(mkWorksheet({ id: `ws-${i}` }));
    }
    expect(getFavorites().length).toBe(30);
  });

  it("removeFavorite удаляет по id", () => {
    saveFavorite(mkWorksheet({ id: "a" }));
    saveFavorite(mkLessonPlan({ id: "b" }));
    removeFavorite("a");
    expect(getFavorites().map((x) => x.id)).toEqual(["b"]);
  });
});

describe("logEvent / getEvents", () => {
  it("добавляет событие в начало списка", () => {
    logEvent("foo");
    logEvent("bar", { x: 1 });
    const evs = getEvents();
    expect(evs[0].name).toBe("bar");
    expect(evs[0].data).toEqual({ x: 1 });
    expect(evs[1].name).toBe("foo");
  });

  it("ограничивает 500 событиями (FIFO по голове)", () => {
    for (let i = 0; i < 510; i += 1) {
      logEvent(`e-${i}`);
    }
    const evs = getEvents();
    expect(evs.length).toBe(500);
    // Самое новое событие в начале (e-509), самое старое — e-10.
    expect(evs[0].name).toBe("e-509");
    expect(evs[499].name).toBe("e-10");
  });

  it("timestamp формируется как ISO-строка", () => {
    logEvent("ts-test");
    const evs = getEvents();
    expect(evs[0].ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});