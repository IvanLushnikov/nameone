/**
 * Тесты настроек профиля и «Моих классов» (ТЗ-21, блок 5).
 *
 * Покрывает `src/lib/lk/profile-api.ts`:
 *   1. сохранение имени и почты на устройстве (анонимный путь — основной);
 *   2. сохранение классов: добавление, нормализация, дубликаты, лимит;
 *   3. применение классов: класс по умолчанию для фильтра кабинета;
 *   4. серверный путь: PATCH уходит с классом, ответ становится источником правды;
 *   5. честность: без сессии экран не говорит «войдите» и отдаёт устройство;
 *   6. обрыв связи не стирает локальные классы.
 *
 * Мок fetch — тот же приём, что в `tests/auth-api.test.ts`: `vi.stubGlobal`,
 * чтобы видеть ровно те url/init, что уходят наружу.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
});

import {
  deviceView,
  getClassNames,
  getDefaultClass,
  getLocalClasses,
  loadProfile,
  normalizeClassName,
  patchServerProfile,
  saveLocalProfile,
  setDefaultClass,
  toggleLocalClass,
  LK_PROFILE_CHANGED_EVENT,
} from "@/lib/lk/profile-api";

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

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("профиль без аккаунта (устройство)", () => {
  it("имя и почта сохраняются и переживают перезагрузку страницы", () => {
    saveLocalProfile({ name: "  Иван   Лушников ", email: "ivan@example.ru" });

    // «Перезагрузка» = чтение заново, как на следующем визите.
    const view = deviceView();
    expect(view.name).toBe("Иван Лушников");
    expect(view.email).toBe("ivan@example.ru");
    expect(view.source).toBe("device");
    // Честная пометка: без аккаунта почту подтвердить некому.
    expect(view.emailIsLocal).toBe(true);
  });

  it("анонимный путь не требует входа: источник — устройство, а не отказ", () => {
    const fetchMock = vi.fn(async () => okResponse({ ok: true, user: null }));
    vi.stubGlobal("fetch", fetchMock);

    return loadProfile().then((res) => {
      expect(res.status).toBe("ready");
      if (res.status !== "ready") return;
      expect(res.view.source).toBe("device");
      // Ровно один запрос — проверка сессии. Никаких «войдите, чтобы увидеть».
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});

describe("«Мои классы»", () => {
  it("классы сохраняются на устройстве и читаются обратно", () => {
    toggleLocalClass("5А");
    toggleLocalClass("5Б");
    toggleLocalClass("7А");

    expect(getClassNames()).toEqual(["5А", "5Б", "7А"]);
    expect(getLocalClasses()[0].id).toBe("5А");
  });

  it("«5а» и «5А» — один и тот же класс: повторное нажатие снимает отметку", () => {
    toggleLocalClass("5А");
    expect(getClassNames()).toEqual(["5А"]);

    // Чекбокс: тот же класс в другом регистре снимает отметку, а не создаёт
    // второй — иначе фильтр расползёлся бы на «5А / 5а».
    toggleLocalClass("5а");
    expect(getClassNames()).toEqual([]);
  });

  it("название нормализуется: пробелы, длина, мусор", () => {
    expect(normalizeClassName("  5   А ")).toBe("5 А");
    expect(normalizeClassName("x".repeat(40))).toHaveLength(16);
    expect(normalizeClassName(undefined)).toBe("");
    expect(normalizeClassName(42)).toBe("");
  });

  it("лимит классов не превышается", () => {
    for (let i = 0; i < 20; i++) toggleLocalClass(`${i}А`);
    expect(getClassNames().length).toBe(12);
  });
});

describe("класс по умолчанию (применение в фильтре)", () => {
  it("выбранный класс сохраняется и сбрасывается, если класса больше нет", () => {
    toggleLocalClass("5А");
    setDefaultClass("5А");
    expect(getDefaultClass()).toBe("5А");

    // Учитель снял отметку — фильтр не должен остаться висеть на пустом классе.
    toggleLocalClass("5А");
    expect(getDefaultClass()).toBeNull();
  });

  it("изменение настроек сообщает подписчикам в этой же вкладке", () => {
    const events: string[] = [];
    const handler = () => events.push("changed");
    window.addEventListener(LK_PROFILE_CHANGED_EVENT, handler);
    try {
      toggleLocalClass("5А");
      setDefaultClass("5А");
      expect(events.length).toBe(2);
    } finally {
      window.removeEventListener(LK_PROFILE_CHANGED_EVENT, handler);
    }
  });
});

describe("серверный путь", () => {
  it("профиль с сервера становится источником правды и зеркалится на устройство", async () => {
    const profile = {
      id: "usr_1",
      email: "teacher@example.ru",
      name: "Иван",
      // «6А» и «6а» — один класс: сервер тоже нормализует, и фронт
      // не должен доверять такому списку слепо.
      classes: ["6А", "6а", "7Б"],
      pendingEmailChange: null,
    };
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/api/auth/me")) {
        return okResponse({
          ok: true,
          user: { id: "usr_1", email: "teacher@example.ru", name: "Иван", plan: "base" },
        });
      }
      if (url.includes("/api/account/profile")) return okResponse({ ok: true, profile });
      return failResponse(404, { ok: false, code: "NOT_FOUND" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await loadProfile();
    expect(res.status).toBe("ready");
    if (res.status !== "ready") return;
    expect(res.view.source).toBe("account");
    expect(res.view.emailIsLocal).toBe(false);
    expect(res.view.classes).toEqual(["6А", "7Б"]);
    // Серверный ответ зеркалится на устройство: следующий визит без сети
    // обязан показать те же классы.
    expect(getClassNames()).toEqual(["6А", "7Б"]);
  });

  it("PATCH уходит на сервер целиком со списком классов", async () => {
    toggleLocalClass("5А");
    const sent: Array<{ url: string; body: unknown }> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        sent.push({ url, body: JSON.parse(String(init.body)) });
        return okResponse({
          ok: true,
          profile: { id: "usr_1", email: "t@example.ru", name: "Иван", classes: ["5А"], pendingEmailChange: null },
        });
      }
      return failResponse(404);
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await patchServerProfile({ classes: ["5А"] });
    expect(res.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toContain("/api/account/profile");
    expect(sent[0].body).toEqual({ classes: ["5А"] });
  });

  it("обрыв связи не стирает локальные классы и не показывает пустоту", async () => {
    toggleLocalClass("5А");
    toggleLocalClass("5Б");

    const fetchMock = vi.fn(async () => {
      throw new Error("offline");
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await loadProfile();
    expect(res.status).toBe("ready");
    if (res.status !== "ready") return;
    expect(res.view.source).toBe("device");
    expect(getClassNames()).toEqual(["5А", "5Б"]);
  });

  it("локальный класс по умолчанию переживает серверный ответ, если он ещё есть", async () => {
    toggleLocalClass("5А");
    setDefaultClass("5А");

    const fetchMock = vi.fn(async () =>
      okResponse({
        ok: true,
        user: { id: "usr_1", email: "t@example.ru", name: "Иван", plan: "base" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    // Сессия есть, но профиль с сервера не пришёл (401 на /api/auth/me и /profile).
    const res = await loadProfile();
    expect(res.status).toBe("ready");
    if (res.status !== "ready") return;
    expect(res.view.source).toBe("device");
    expect(getDefaultClass()).toBe("5А");
  });
});
