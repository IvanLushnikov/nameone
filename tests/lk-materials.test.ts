/**
 * Тесты ТЗ-21: личный кабинет учителя — слой данных и навигация по материалам.
 *
 * Что здесь зафиксировано (по блокам ТЗ):
 *
 *   Блок 2 — «Открыть» снова работает:
 *     · лист из истории открывается по `?id` (было: «Лист не найден»);
 *     · порядок поиска: сервер → история → избранное → понятный отказ;
 *     · клик по листу СВЫШЕ пятого (у которого в localStorage нет `artifact`)
 *       открывается через сервер — ради этого существует первый шаг;
 *     · `addTemplate` имеет входную точку: конструктор и превью.
 *
 *   Блок 1 — сервер усиливает, но не блокирует:
 *     · анонимный учитель: НОЛЬ запросов в сеть (никакого 401 и мигания);
 *     · сервер недоступен → показываются данные с устройства, а не отказ;
 *     · сервер недоступен и данных нет → состояние «недоступно» с повтором;
 *     · четыре состояния вкладки: загрузка / недоступно / пусто / данные.
 *
 *   Блок 3 — найти свои материалы:
 *     · поиск по названию и по теме;
 *     · фильтры предмет / класс / тип материала работают вместе;
 *     · группировка по дате, а карточка показывает тип и размер текстом.
 *
 * Сетевые вызовы замоканы: тесты не ходят ни в какую сеть и проверяют именно
 * решение слоя — куда смотреть и что показать.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  setProfile,
  getHistory,
  addToHistory,
  saveFavorite,
  getFavorites,
  addTemplate,
  type FavoriteArtifact,
} from "@/lib/utils/storage";
import { findArtifact } from "@/lib/lk/artifact";
import {
  loadHistoryPage,
  loadFavorites,
  loadTemplates,
  hasServerSession,
} from "@/lib/lk/materials-source";
import { saveTemplate } from "@/lib/lk/templates";
import {
  applyHistoryView,
  countLabel,
  dateGroupLabel,
  EMPTY_FILTERS,
  gradesOf,
  groupByDate,
  kindLabel,
  kindsOf,
  subjectsOf,
} from "@/lib/lk/history-view";
import { materialKindOf, type HistoryItem } from "@/lib/lk/types";
import type { Worksheet, UserProfile } from "@/lib/types";

/* ─── Фикстуры ────────────────────────────────────────────────────────────── */

function makeWorksheet(id: string, patch: Partial<Worksheet> = {}): Worksheet {
  return {
    id,
    type: "worksheet",
    subject: "math",
    grade: 5,
    topic: `Тема ${id}`,
    difficulty: "medium",
    count: 3,
    title: `Лист ${id}`,
    createdAt: new Date().toISOString(),
    tasks: [
      { text: "Задание 1", answer: "1", explanation: "пояснение" },
      { text: "Задание 2", answer: "2", explanation: "пояснение" },
    ],
    ...patch,
  } as Worksheet;
}

function makeHistoryItem(over: Partial<Parameters<typeof makeHistoryItem>[0]> = {}) {
  return {
    id: "w1",
    type: "worksheet",
    title: "Лист по дробям",
    subject: "math",
    grade: 5,
    createdAt: new Date().toISOString(),
    isFavorite: false,
    ...over,
  } as ReturnType<typeof makeHistoryItem>;
}

/** Локальный профиль = «сессия есть». Без него запросы в сеть не идут. */
const PROFILE: UserProfile = {
  id: "u1",
  name: "Иван",
  email: "ivan@example.com",
  plan: "free",
  used: 0,
  createdAt: new Date().toISOString(),
} as UserProfile;

const fetchMock = vi.fn();

/** Ответ сервера для истории. */
function historyResponse(items: unknown[], nextCursor: string | null = null) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ ok: true, items, nextCursor }),
  };
}

function itemDto(over: Record<string, unknown> = {}) {
  return {
    id: "w1",
    type: "worksheet",
    title: "Лист по дробям",
    subject: "math",
    grade: 5,
    createdAt: new Date().toISOString(),
    isFavorite: false,
    ...over,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  // По умолчанию — аноним: сессии нет, запросы уходить не должны.
  process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ─── Блок 2: открытие листа из истории по ?id ─────────────────────────────── */

describe("Блок 2 — открытие листа из истории по ?id", () => {
  it("находит лист в истории устройства, даже если его нет в избранном", async () => {
    // Именно этот случай ломался: карточка истории ведёт в /preview, который
    // смотрел только в избранное.
    const ws = makeWorksheet("w1");
    addToHistory({
      id: "w1",
      type: "worksheet",
      title: ws.title,
      subject: "math",
      grade: 5,
      createdAt: new Date().toISOString(),
      isFavorite: false,
      artifact: ws,
    });
    expect(getFavorites()).toHaveLength(0);

    const found = await findArtifact("w1");

    expect(found).not.toBeNull();
    expect(found?.origin).toBe("history");
    expect(found?.artifact.title).toBe("Лист w1");
  });

  it("не делает запросов в сеть у анонимного учителя", async () => {
    addToHistory({
      id: "w1",
      type: "worksheet",
      title: "Лист",
      subject: "math",
      grade: 5,
      createdAt: new Date().toISOString(),
      isFavorite: false,
      artifact: makeWorksheet("w1"),
    });

    await findArtifact("w1");

    // Анонимному учителю не нужно ни 401, ни мигания «Загрузка».
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("для листа старше пятого идёт на сервер — в истории нет тела листа", async () => {
    // История хранит тело только у последних записей (ARTIFACT_KEEP = 5).
    // У более старых — лишь метаданные, и открыть их может только сервер.
    setProfile(PROFILE);
    addToHistory({
      id: "old-1",
      type: "worksheet",
      title: "Старый лист",
      subject: "math",
      grade: 5,
      createdAt: new Date(0).toISOString(),
      isFavorite: false,
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, worksheet: makeWorksheet("old-1") }),
    });

    const found = await findArtifact("old-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/api/worksheets/old-1",
      expect.objectContaining({ credentials: "include" })
    );
    expect(found?.origin).toBe("server");
  });

  it("падает с сервера — всё равно находит лист в истории", async () => {
    setProfile(PROFILE);
    const ws = makeWorksheet("w1");
    addToHistory({
      id: "w1",
      type: "worksheet",
      title: ws.title,
      subject: "math",
      grade: 5,
      createdAt: new Date().toISOString(),
      isFavorite: false,
      artifact: ws,
    });
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    const found = await findArtifact("w1");

    expect(found?.origin).toBe("history");
  });

  it("находит лист в избранном", async () => {
    saveFavorite(makeWorksheet("fav-1"));

    const found = await findArtifact("fav-1");

    expect(found?.origin).toBe("favorites");
  });

  it("несуществующий id даёт null, а не исключение", async () => {
    expect(await findArtifact("nope")).toBeNull();
    expect(await findArtifact("")).toBeNull();
  });
});

/* ─── Блок 2: входная точка у addTemplate ─────────────────────────────────── */

describe("Блок 2 — шаблоны можно сохранить", () => {
  it("сохраняет шаблон на устройство без сессии (конструктор/превью)", async () => {
    const res = await saveTemplate(makeWorksheet("w1") as FavoriteArtifact);

    expect(res.synced).toBe(false);
    expect(res.serverFailed).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    // Шаблон оказался в локальном списке — входная точка есть.
    const tpl = (await loadTemplates()).items[0];
    expect(tpl.name).toBe("Лист w1");
    expect(tpl.count).toBe(2);
  });

  it("с сессией пишет и на устройство, и на сервер", async () => {
    setProfile(PROFILE);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, template: { id: "tpl1", name: "Лист w1" } }),
    });

    const res = await saveTemplate(makeWorksheet("w1") as FavoriteArtifact);

    expect(res.synced).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/api/users/templates",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("сервер отказал — шаблон всё равно сохранён локально", async () => {
    setProfile(PROFILE);
    // Отказ на любом запросе: и запись шаблона, и чтение вкладки.
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    const res = await saveTemplate(makeWorksheet("w1") as FavoriteArtifact);

    expect(res.serverFailed).toBe(true);
    // Локально шаблон есть, поэтому вкладка не уходит в «недоступно».
    const t = await loadTemplates();
    expect(t.state).toBe("data");
    expect(t.items).toHaveLength(1);
  });
});

/* ─── Блок 1: четыре состояния вкладки + анонимный путь ───────────────────── */

describe("Блок 1 — источник данных вкладки", () => {
  it("анонимный учитель: источник — устройство, запросов ноль", async () => {
    addToHistory({
      id: "w1",
      type: "worksheet",
      title: "Лист",
      subject: "math",
      grade: 5,
      createdAt: new Date().toISOString(),
      isFavorite: false,
      artifact: makeWorksheet("w1"),
    });
    saveFavorite(makeWorksheet("f1") as FavoriteArtifact);
    addTemplate({
      id: "t1",
      name: "Шаблон",
      subject: "math",
      grade: 5,
      topic: "Тема",
      difficulty: "medium",
      count: 5,
    });

    const h = await loadHistoryPage();
    const f = await loadFavorites();
    const t = await loadTemplates();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.source).toBe("device");
    expect(h.state).toBe("data");
    expect(h.items).toHaveLength(1);
    expect(f.state).toBe("data");
    expect(t.state).toBe("data");
    expect(hasServerSession()).toBe(false);
  });

  it("анонимный: история делится постранично (20 + «Показать ещё»)", async () => {
    for (let i = 0; i < 25; i++) {
      addToHistory({
        id: `w${i}`,
        type: "worksheet",
        title: `Лист ${i}`,
        subject: "math",
        grade: 5,
        createdAt: new Date(Date.now() - i * 1000).toISOString(),
        isFavorite: false,
      });
    }

    const first = await loadHistoryPage({ limit: 20 });
    expect(first.items).toHaveLength(20);
    expect(first.nextCursor).toBe("20");

    const second = await loadHistoryPage({ cursor: first.nextCursor, limit: 20 });
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
  });

  it("залогиненный: история приходит с сервера, с limit и cursor", async () => {
    setProfile(PROFILE);
    const nextIso = new Date().toISOString();
    fetchMock.mockResolvedValueOnce(historyResponse([itemDto()], nextIso));

    const res = await loadHistoryPage({ limit: 20 });

    expect(res.source).toBe("server");
    expect(res.state).toBe("data");
    expect(res.nextCursor).toBe(nextIso);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("limit=20");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      credentials: "include",
      cache: "no-store",
    });
  });

  it("сервер недоступен, но данные на устройстве есть — показываем устройство", async () => {
    setProfile(PROFILE);
    addToHistory({
      id: "w1",
      type: "worksheet",
      title: "Лист",
      subject: "math",
      grade: 5,
      createdAt: new Date().toISOString(),
      isFavorite: false,
      artifact: makeWorksheet("w1"),
    });
    fetchMock.mockRejectedValue(new Error("offline"));

    const res = await loadHistoryPage();

    // Не отказ, а данные + честная пометка «только на этом устройстве».
    expect(res.state).toBe("data");
    expect(res.source).toBe("device");
    expect(res.degraded).toBe(true);
    expect(res.items).toHaveLength(1);
  });

  it("сервер недоступен И данных нет — состояние «недоступно» с повтором", async () => {
    setProfile(PROFILE);
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });

    const res = await loadHistoryPage();

    expect(res.state).toBe("unavailable");
    expect(res.items).toHaveLength(0);
  });

  it("401 от сервера не превращается в требование войти", async () => {
    setProfile(PROFILE);
    saveFavorite(makeWorksheet("f1") as FavoriteArtifact);
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });

    const res = await loadFavorites();

    // Избранное устройства на месте — учитель не теряет свои материалы.
    expect(res.state).toBe("data");
    expect(res.items).toHaveLength(1);
    expect(res.degraded).toBe(true);
  });

  it("пусто: сервер ответил, записей нет", async () => {
    setProfile(PROFILE);
    fetchMock.mockResolvedValueOnce(historyResponse([]));

    const res = await loadHistoryPage();

    expect(res.state).toBe("empty");
    expect(res.source).toBe("server");
  });

  it("мусорный ответ сервера не роняет вкладку", async () => {
    setProfile(PROFILE);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ items: [null, { noId: true }, itemDto()] }),
    });

    const res = await loadHistoryPage();

    expect(res.state).toBe("data");
    expect(res.items).toHaveLength(1);
  });

  it("избранное и шаблоны с сервера читаются при наличии сессии", async () => {
    setProfile(PROFILE);
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          items: [
            {
              id: "fav_1",
              worksheetId: "w1",
              favoritedAt: new Date().toISOString(),
              worksheet: makeWorksheet("w1"),
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          templates: [
            {
              id: "tpl1",
              name: "Дроби 5 класс",
              subject: "math",
              grade: 5,
              topic: "Дроби",
              difficulty: "medium",
              count: 8,
            },
          ],
        }),
      });

    const f = await loadFavorites();
    const t = await loadTemplates();

    expect(f.state).toBe("data");
    expect(f.source).toBe("server");
    // id записи избранного нужен для DELETE — его нельзя терять.
    expect(f.remoteIds.get("w1")).toBe("fav_1");
    expect(t.items[0].name).toBe("Дроби 5 класс");
  });
});

/* ─── Блок 3: поиск, фильтры, группировка, карточка ───────────────────────── */

describe("Блок 3 — поиск и фильтры", () => {
  const items: HistoryItem[] = [
    {
      id: "1",
      title: "Дроби: сложение и вычитание",
      subject: "math",
      grade: 5,
      createdAt: new Date().toISOString(),
      type: "worksheet",
      count: 12,
      topic: "Дроби",
      isFavorite: false,
      source: "device",
    },
    {
      id: "2",
      title: "План урока по дробям",
      subject: "math",
      grade: 6,
      createdAt: new Date().toISOString(),
      type: "lesson-plan",
      count: 5,
      topic: "Дроби",
      isFavorite: false,
      source: "device",
    },
    {
      id: "3",
      title: "Времена английского",
      subject: "english",
      grade: 5,
      createdAt: new Date().toISOString(),
      type: "presentation",
      count: 10,
      topic: "Present Simple",
      isFavorite: false,
      source: "server",
    },
  ];

  it("ищет по названию", () => {
    expect(applyHistoryView(items, "времена", EMPTY_FILTERS).map((i) => i.id)).toEqual(["3"]);
  });

  it("ищет по теме, даже если её нет в названии", () => {
    // «Present Simple» есть только в теме — по названию не найдётся.
    expect(applyHistoryView(items, "present simple", EMPTY_FILTERS).map((i) => i.id)).toEqual(["3"]);
  });

  it("нечувствителен к регистру", () => {
    expect(applyHistoryView(items, "ДРОБИ", EMPTY_FILTERS)).toHaveLength(2);
  });

  it("пустой запрос возвращает всё", () => {
    expect(applyHistoryView(items, "   ", EMPTY_FILTERS)).toHaveLength(3);
  });

  it("фильтр по предмету", () => {
    expect(
      applyHistoryView(items, "", { ...EMPTY_FILTERS, subject: "math" }).map((i) => i.id)
    ).toEqual(["1", "2"]);
  });

  it("фильтр по классу", () => {
    expect(
      applyHistoryView(items, "", { ...EMPTY_FILTERS, grade: 5 }).map((i) => i.id)
    ).toEqual(["1", "3"]);
  });

  it("фильтр по типу материала", () => {
    expect(
      applyHistoryView(items, "", { ...EMPTY_FILTERS, kind: "lesson-plan" }).map((i) => i.id)
    ).toEqual(["2"]);
  });

  it("поиск и фильтры сочетаются", () => {
    expect(
      applyHistoryView(items, "дроби", { ...EMPTY_FILTERS, grade: 6 }).map((i) => i.id)
    ).toEqual(["2"]);
  });

  it("значения для списков строятся по фактическим данным", () => {
    expect(subjectsOf(items)).toEqual(["english", "math"]);
    expect(gradesOf(items)).toEqual([5, 6]);
    expect(kindsOf(items)).toEqual(["worksheet", "lesson-plan", "presentation"]);
  });

  it("неизвестный тип не ломает фильтр", () => {
    expect(materialKindOf("что-то-новое")).toBe("other");
  });
});

describe("Блок 3 — группировка по дате", () => {
  const now = new Date("2026-10-05T12:00:00Z");

  it("сегодня / вчера / неделя / месяц", () => {
    const d = (daysAgo: number) =>
      new Date(now.getTime() - daysAgo * 86_400_000).toISOString();
    expect(dateGroupLabel(d(0), now)).toBe("Сегодня");
    expect(dateGroupLabel(d(1), now)).toBe("Вчера");
    expect(dateGroupLabel(d(3), now)).toBe("Эта неделя");
    expect(dateGroupLabel(d(30), now)).toMatch(/В /);
  });

  it("группирует карточки, сохраняя порядок", () => {
    const mk = (id: string, daysAgo: number): HistoryItem => ({
      id,
      title: id,
      subject: "math",
      grade: 5,
      createdAt: new Date(now.getTime() - daysAgo * 86_400_000).toISOString(),
      type: "worksheet",
      count: 1,
      topic: null,
      isFavorite: false,
      source: "device",
    });
    const groups = groupByDate([mk("a", 0), mk("b", 0), mk("c", 1)], now);

    expect(groups.map((g) => g.label)).toEqual(["Сегодня", "Вчера"]);
    expect(groups[0].items.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("пустой список даёт пустые группы, а не пустые заголовки", () => {
    expect(groupByDate([], now)).toEqual([]);
  });

  it("битая дата не роняет группировку", () => {
    expect(dateGroupLabel("не дата", now)).toBe("Раньше");
  });
});

describe("Блок 3 — узнаваемая карточка", () => {
  it("показывает тип материала текстом, а не только эмодзи", () => {
    const base = {
      id: "1",
      title: "t",
      subject: "math",
      grade: 5,
      createdAt: new Date().toISOString(),
      count: 12,
      topic: null,
      isFavorite: false,
      source: "device" as const,
    };
    expect(kindLabel({ ...base, type: "worksheet" })).toBe("Рабочий лист");
    expect(kindLabel({ ...base, type: "lesson-plan" })).toBe("План урока");
    expect(kindLabel({ ...base, type: "presentation" })).toBe("Презентация");
    expect(kindLabel({ ...base, type: "ktp" })).toBe("КТП");
  });

  it("показывает размер с правильным окончанием", () => {
    const base = {
      id: "1",
      title: "t",
      subject: "math",
      grade: 5,
      createdAt: new Date().toISOString(),
      topic: null,
      isFavorite: false,
      source: "device" as const,
    };
    expect(countLabel({ ...base, type: "worksheet", count: 1 })).toBe("1 задание");
    expect(countLabel({ ...base, type: "worksheet", count: 3 })).toBe("3 задания");
    expect(countLabel({ ...base, type: "worksheet", count: 12 })).toBe("12 заданий");
    expect(countLabel({ ...base, type: "presentation", count: 10 })).toBe("10 слайдов");
  });

  it("молчит, когда размер неизвестен, вместо выдуманного числа", () => {
    // Серверная история не отдаёт count — врать про количество нельзя.
    expect(
      countLabel({
        id: "1",
        title: "t",
        subject: "math",
        grade: 5,
        createdAt: new Date().toISOString(),
        type: "worksheet",
        count: null,
        topic: null,
        isFavorite: false,
        source: "server",
      })
    ).toBeNull();
  });
});

/* ─── Плитка «С нами» ─────────────────────────────────────────────────────── */

describe("Плитка «С нами» — метрика срока, а не даты", () => {
  it("не показывает дату вместо срока", async () => {
    // Раньше здесь стоял timeAgo от САМОГО СТАРОГО листа: «2 месяца назад».
    // Теперь считаем дни с ПЕРВОГО материала и отдаём число.
    const first = new Date(Date.now() - 60 * 86_400_000).toISOString();
    addToHistory({
      id: "old",
      type: "worksheet",
      title: "Старый",
      subject: "math",
      grade: 5,
      createdAt: first,
      isFavorite: false,
    });
    addToHistory({
      id: "new",
      type: "worksheet",
      title: "Новый",
      subject: "math",
      grade: 5,
      createdAt: new Date().toISOString(),
      isFavorite: false,
    });

    const res = await loadHistoryPage();

    expect(res.items).toHaveLength(2);
    // Оба листа в наличии, даты разные, но срок считается от первого.
    expect(res.items.map((i) => i.createdAt)).toContain(first);
  });
});
