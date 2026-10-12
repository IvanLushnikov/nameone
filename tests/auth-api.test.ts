/**
 * Тесты для `src/lib/auth/api.ts` — клиент /api/auth/* и /api/users/usage,
 * плюс вход по паролю на странице `/login` (ТЗ-23, воркер C).
 *
 * Покрывает функции через `vi.stubGlobal('fetch', vi.fn())`:
 *   1. requestMagicLink(email) — POST /api/auth/magic-link
 *   2. verifyMagicLink(token)  — POST /api/auth/callback
 *   3. getCurrentUser()        — GET  /api/auth/me
 *   4. getUsage()              — GET  /api/users/usage
 *   5. signOutFromApi()        — POST /api/auth/logout (silent fail)
 *   6. loginWithPassword()     — POST /api/auth/login
 *   7. setPassword()           — POST /api/auth/password
 *   8. removePassword()        — DELETE /api/auth/password
 *
 * `credentials: 'include'`, `Content-Type: application/json`,
 * URL = `${NEXT_PUBLIC_API_URL}${path}` — все три проверяются.
 *
 * Тесты страницы входа рендерят настоящий компонент и бьют в тот же мок fetch:
 * так проверяется связка «поле → клиент → ручка», а не клиент в вакууме.
 *
 * Мок fetch'а сделан через vi.stubGlobal (не vi.mock на модуль) — это позволяет
 * проверять ровно те url/init, что уходят наружу, без реэкспорта обёрток.
 *
 * В тестах СТРАНИЦЫ вход считается по адресам `/api/auth/*`, а не по числу
 * вызовов fetch: страница и трекер аналитики делят один глобальный fetch, и
 * события на `/api/track` попадали бы в тот же счётчик (см. `authUrls`).
 * Проверять «fetch вообще не вызывался» нельзя — событие просмотра экрана
 * страница шлёт законно.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Установим NEXT_PUBLIC_API_URL ДО импорта api.ts (модуль читает env на top-level).
// `vi.hoisted` гарантирует, что мутация выполняется до резолва ES-import'ов
// (иначе TypeScript hoists `import` выше нашего присваивания).
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
});

// Страница входа после успешного входа зовёт router.push("/dashboard").
// Мок объявлен через vi.hoisted, чтобы было видно вызовы из тестов.
const routerPush = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

import {
  requestMagicLink,
  verifyMagicLink,
  getCurrentUser,
  getUsage,
  signOutFromApi,
  loginWithPassword,
  setPassword,
  removePassword,
  LOGIN_REFUSED_TEXT,
  RATE_LIMITED_TEXT,
  AuthApiError,
} from "@/lib/auth/api";
import LoginPage from "@/app/login/page";

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

beforeEach(() => {
  // По умолчанию fetch ещё не замокан — каждый тест переустанавливает свой мок.
});

afterEach(() => {
  vi.unstubAllGlobals();
  routerPush.mockClear();
});

// ─────────────────────────────────────────────────────────────────────────────
// requestMagicLink
// ─────────────────────────────────────────────────────────────────────────────

describe("requestMagicLink", () => {
  it("ok=true при response.ok=true", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const r = await requestMagicLink("a@b.c");

    expect(r).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ok=false с error из JSON при response.ok=false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(failResponse(500, { error: "rate_limited" })),
    );

    const r = await requestMagicLink("a@b.c");

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("rate_limited");
  });

  it("ok=false с fallback message при response.ok=false без error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(failResponse(500, {})));

    const r = await requestMagicLink("a@b.c");

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBeTruthy();
      expect(typeof r.error).toBe("string");
    }
  });

  it("ok=false при throw fetch (network)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    );

    const r = await requestMagicLink("a@b.c");

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(typeof r.error).toBe("string");
      expect(r.error.length).toBeGreaterThan(0);
    }
  });

  it("URL, body и credentials соответствуют контракту", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await requestMagicLink("teacher@school.ru");

    const [calledUrl, calledInit] = fetchMock.mock.calls[0]!;
    expect(calledUrl).toBe(`${API_URL}/api/auth/magic-link`);
    expect(calledInit.method).toBe("POST");
    expect(calledInit.credentials).toBe("include");
    expect(JSON.parse(calledInit.body)).toEqual({ email: "teacher@school.ru" });
    expect(calledInit.headers["Content-Type"]).toBe("application/json");
    expect(calledInit.headers.Accept).toBe("application/json");
    expect(calledInit.cache).toBe("no-store");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// verifyMagicLink
// ─────────────────────────────────────────────────────────────────────────────

describe("verifyMagicLink", () => {
  it("ok=true + user при 200 с user", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        okResponse({
          ok: true,
          user: {
            id: "u1",
            email: "a@b.c",
            name: "A",
            plan: "free",
          },
        }),
      ),
    );

    const r = await verifyMagicLink("tok-123");

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.user.id).toBe("u1");
      expect(r.user.plan).toBe("free");
    }
  });

  it("ok=false при 401 — AuthApiError.isAuthError=true даёт human-friendly текст", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(failResponse(401, { error: "invalid_token" })),
    );

    const r = await verifyMagicLink("expired");

    expect(r.ok).toBe(false);
    if (!r.ok) {
      // 401 → AuthApiError(isAuthError=true) → humanError переводит в
      // "Ссылка истекла или уже использована" (UI-формат).
      expect(r.error).toBe("Ссылка истекла или уже использована");
    }
  });

  it("ok=false при 200, но response.ok=false и error=invalid_token (rare edge)", async () => {
    // На случай, если бэк вернёт 200 с ok:false (для anti-enumeration).
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        okResponse({ ok: false, error: "invalid_token" }),
      ),
    );

    const r = await verifyMagicLink("x");

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("invalid_token");
  });

  it("ok=false при throw fetch (network) — не бросает наружу", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    );

    const r = await verifyMagicLink("any");

    expect(r.ok).toBe(false);
  });

  it("URL и body соответствуют контракту", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        ok: true,
        user: { id: "u", email: "e@e.e", name: "N", plan: "free" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await verifyMagicLink("abc-token");

    const [calledUrl, calledInit] = fetchMock.mock.calls[0]!;
    expect(calledUrl).toBe(`${API_URL}/api/auth/callback`);
    expect(JSON.parse(calledInit.body)).toEqual({ token: "abc-token" });
    expect(calledInit.method).toBe("POST");
    expect(calledInit.credentials).toBe("include");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getCurrentUser
// ─────────────────────────────────────────────────────────────────────────────

describe("getCurrentUser", () => {
  it("возвращает AuthUser при 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        okResponse({
          ok: true,
          user: {
            id: "u1",
            email: "a@b.c",
            name: "A",
            plan: "free",
            generationsToday: 1,
            generationsLimit: 3,
          },
        }),
      ),
    );

    const u = await getCurrentUser();

    expect(u).not.toBeNull();
    expect(u?.id).toBe("u1");
    expect(u?.plan).toBe("free");
  });

  it("возвращает null при 401 (аноним)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(failResponse(401)),
    );

    const u = await getCurrentUser();

    expect(u).toBeNull();
  });

  it("возвращает null при throw (network) — не бросает", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    );

    const u = await getCurrentUser();

    expect(u).toBeNull();
  });

  it("GET /api/auth/me, credentials: 'include'", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({ ok: true, user: null }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await getCurrentUser();

    const [calledUrl, calledInit] = fetchMock.mock.calls[0]!;
    expect(calledUrl).toBe(`${API_URL}/api/auth/me`);
    expect(calledInit.method).toBe("GET");
    expect(calledInit.credentials).toBe("include");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getUsage
// ─────────────────────────────────────────────────────────────────────────────

describe("getUsage", () => {
  it("возвращает usage-объект при 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        okResponse({
          ok: true,
          generationsToday: 5,
          generationsLimit: 20,
          generationsResetAt: "2026-10-01T00:00:00Z",
          plan: "base",
        }),
      ),
    );

    const usage = await getUsage();

    expect(usage.generationsToday).toBe(5);
    expect(usage.generationsLimit).toBe(20);
    expect(usage.generationsResetAt).toBe("2026-10-01T00:00:00Z");
    expect(usage.plan).toBe("base");
  });

  it("generationsResetAt приводится к null если отсутствует", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        okResponse({
          ok: true,
          generationsToday: 0,
          generationsLimit: 3,
          plan: "free",
        }),
      ),
    );

    const usage = await getUsage();

    expect(usage.generationsResetAt).toBeNull();
  });

  it("бросает AuthApiError при HTTP ошибке", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(failResponse(401, { error: "no_session" })),
    );

    await expect(getUsage()).rejects.toBeInstanceOf(AuthApiError);
  });

  it("GET /api/users/usage, credentials: 'include'", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        ok: true,
        generationsToday: 0,
        generationsLimit: 3,
        plan: "free",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await getUsage();

    const [calledUrl, calledInit] = fetchMock.mock.calls[0]!;
    expect(calledUrl).toBe(`${API_URL}/api/users/usage`);
    expect(calledInit.method).toBe("GET");
    expect(calledInit.credentials).toBe("include");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// signOutFromApi
// ─────────────────────────────────────────────────────────────────────────────

describe("signOutFromApi", () => {
  it("не бросает при 200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse({ ok: true })));

    await expect(signOutFromApi()).resolves.toBeUndefined();
  });

  it("silent fail при HTTP 500 — не бросает", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(failResponse(500)));

    await expect(signOutFromApi()).resolves.toBeUndefined();
  });

  it("silent fail при network throw — не бросает", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    );

    await expect(signOutFromApi()).resolves.toBeUndefined();
  });

  it("POST /api/auth/logout, credentials: 'include'", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await signOutFromApi();

    const [calledUrl, calledInit] = fetchMock.mock.calls[0]!;
    expect(calledUrl).toBe(`${API_URL}/api/auth/logout`);
    expect(calledInit.method).toBe("POST");
    expect(calledInit.credentials).toBe("include");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AuthApiError
// ─────────────────────────────────────────────────────────────────────────────

describe("AuthApiError", () => {
  it("isAuthError=true для 401 и 403", () => {
    expect(new AuthApiError("x", "m", 401).isAuthError).toBe(true);
    expect(new AuthApiError("x", "m", 403).isAuthError).toBe(true);
  });

  it("isAuthError=false для прочих статусов и 0", () => {
    expect(new AuthApiError("x", "m", 500).isAuthError).toBe(false);
    expect(new AuthApiError("x", "m", 0).isAuthError).toBe(false);
  });
});
// ─────────────────────────────────────────────────────────────────────────────
// loginWithPassword
// ─────────────────────────────────────────────────────────────────────────────

const loginUser = {
  id: "usr_1",
  email: "teacher@school.ru",
  name: "Ирина",
  plan: "free",
  generationsTotal: 0,
  generationsToday: 0,
  generationsLimit: 3,
  createdAt: "2026-09-01T00:00:00.000Z",
};

describe("loginWithPassword", () => {
  it("ok=true + user при 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(okResponse({ ok: true, user: loginUser })),
    );

    const r = await loginWithPassword("teacher@school.ru", "uchlist2026");

    expect(r.ok).toBe(true);
    // «user» в r, а не просто r.ok: со вторым шагом для администратора
    // (ТЗ-24 §8.1) у успешного ответа появилась ещё одна форма.
    if (r.ok && "user" in r) {
      expect(r.user.id).toBe("usr_1");
      expect(r.user.plan).toBe("free");
    }
  });

  it("POST /api/auth/login с {email,password}, credentials: 'include'", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({ ok: true, user: loginUser }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await loginWithPassword("teacher@school.ru", "uchlist2026");

    const [calledUrl, calledInit] = fetchMock.mock.calls[0]!;
    expect(calledUrl).toBe(`${API_URL}/api/auth/login`);
    expect(calledInit.method).toBe("POST");
    expect(calledInit.credentials).toBe("include");
    expect(JSON.parse(calledInit.body)).toEqual({
      email: "teacher@school.ru",
      password: "uchlist2026",
    });
  });

  /**
   * Главный инвариант ТЗ §6: на «нет такого аккаунта» и «пароль не подошёл» —
   * один и тот же текст. Здесь бэк присылает РАЗНЫЕ коды ошибок, и фронт всё
   * равно обязан показать один текст: собираем отказ у себя, а не берём из ответа.
   */
  it("один и тот же текст на «пароль не сошёлся» и «аккаунта нет»", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(failResponse(401, { error: "bad_password" })),
    );
    const wrongPassword = await loginWithPassword("teacher@school.ru", "uchlist2026");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(failResponse(401, { error: "no_user" })),
    );
    const noAccount = await loginWithPassword("test@example.com", "uchlist2026");

    expect(wrongPassword.ok).toBe(false);
    expect(noAccount.ok).toBe(false);
    if (!wrongPassword.ok && !noAccount.ok) {
      expect(wrongPassword.error).toBe(LOGIN_REFUSED_TEXT);
      expect(noAccount.error).toBe(LOGIN_REFUSED_TEXT);
      expect(wrongPassword.error).toBe(noAccount.error);
    }
  });

  it("текст бэка наружу не пробрасывается", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(failResponse(400, { error: "password_hash_mismatch" })),
    );

    const r = await loginWithPassword("teacher@school.ru", "uchlist2026");

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe(LOGIN_REFUSED_TEXT);
      expect(r.error).not.toContain("password_hash_mismatch");
    }
  });

  it("200 с ok:false тоже даёт единый отказ", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(okResponse({ ok: false, error: "no_user" })),
    );

    const r = await loginWithPassword("teacher@school.ru", "uchlist2026");

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(LOGIN_REFUSED_TEXT);
  });

  it("429 — отдельный отказ, причина не раскрывается", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(failResponse(429, { error: "too_many" })),
    );

    const r = await loginWithPassword("teacher@school.ru", "uchlist2026");

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe(RATE_LIMITED_TEXT);
      expect(r.error).not.toBe(LOGIN_REFUSED_TEXT);
    }
  });

  it("обрыв сети не выдаётся за «проверьте пароль»", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    );

    const r = await loginWithPassword("teacher@school.ru", "uchlist2026");

    expect(r.ok).toBe(false);
    if (!r.ok) {
      // Бэк не узнал про этот адрес ничего — отличать тут нечего, но и врать
      // учителю про его пароль при мёртвой сети тоже нельзя.
      expect(r.error).not.toBe(LOGIN_REFUSED_TEXT);
      expect(r.error.length).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// setPassword / removePassword
// ─────────────────────────────────────────────────────────────────────────────

describe("setPassword", () => {
  it("ok=true + setAt при 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        okResponse({ ok: true, setAt: "2026-10-12T12:00:00.000Z" }),
      ),
    );

    const r = await setPassword("uchlist2026");

    expect(r).toEqual({ ok: true, setAt: "2026-10-12T12:00:00.000Z" });
  });

  it("задать пароль — currentPassword в теле нет", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ ok: true, setAt: null }));
    vi.stubGlobal("fetch", fetchMock);

    await setPassword("uchlist2026");

    const [calledUrl, calledInit] = fetchMock.mock.calls[0]!;
    expect(calledUrl).toBe(`${API_URL}/api/auth/password`);
    expect(calledInit.method).toBe("POST");
    expect(calledInit.credentials).toBe("include");
    expect(JSON.parse(calledInit.body)).toEqual({ password: "uchlist2026" });
  });

  it("смена пароля требует старый — currentPassword уходит в теле", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ ok: true, setAt: null }));
    vi.stubGlobal("fetch", fetchMock);

    await setPassword("uchlist2027", "uchlist2026");

    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({
      password: "uchlist2027",
      currentPassword: "uchlist2026",
    });
  });

  it("setAt=null, если бэк даты не прислал", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse({ ok: true })));

    const r = await setPassword("uchlist2026");

    // Не «Invalid Date» в карточке настроек, а явный null.
    expect(r).toEqual({ ok: true, setAt: null });
  });

  it("401 «нет сессии» и 401 «неверный текущий» дают один текст", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(failResponse(401, { error: "no_session" })),
    );
    const noSession = await setPassword("uchlist2027", "uchlist2026");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(failResponse(401, { error: "wrong_current" })),
    );
    const wrongCurrent = await setPassword("uchlist2027", "uchlist2026");

    expect(noSession.ok).toBe(false);
    expect(wrongCurrent.ok).toBe(false);
    if (!noSession.ok && !wrongCurrent.ok) {
      expect(noSession.error).toBe(wrongCurrent.error);
      expect(noSession.error).toBeTruthy();
    }
  });

  it("400 — напоминание правил пароля, а не отказ про аккаунт", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(failResponse(400, { error: "weak_password" })),
    );

    const r = await setPassword("123");

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/8/i);
  });

  it("429 — отдельный отказ", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(failResponse(429)),
    );

    const r = await setPassword("uchlist2027", "uchlist2026");

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(RATE_LIMITED_TEXT);
  });
});

describe("removePassword", () => {
  it("ok=true при 200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse({ ok: true })));

    await expect(removePassword()).resolves.toEqual({ ok: true });
  });

  it("DELETE /api/auth/password без тела", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await removePassword();

    const [calledUrl, calledInit] = fetchMock.mock.calls[0]!;
    expect(calledUrl).toBe(`${API_URL}/api/auth/password`);
    expect(calledInit.method).toBe("DELETE");
    expect(calledInit.body).toBeUndefined();
    expect(calledInit.credentials).toBe("include");
  });

  it("401 — внятный текст, ok=false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(failResponse(401, { error: "no_session" })),
    );

    const r = await removePassword();

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBeTruthy();
  });

  it("network throw — ok=false, а не исключение наружу", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    );

    await expect(removePassword()).resolves.toMatchObject({ ok: false });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Страница входа: два пути рядом (ТЗ §6)
// ─────────────────────────────────────────────────────────────────────────────

const renderLogin = () => render(React.createElement(LoginPage));

/**
 * Мок fetch'а в тестах страницы — форма для хелперов ниже.
 * Типы у vi.fn() размазаны, поэтому описываем только то, что реально читаем.
 */
type FetchMock = { mock: { calls: unknown[][] } };

/**
 * Все адреса, куда реально ходила страница.
 *
 * Зачем хелпер, если есть `fetchMock`: с 12.10.2026 страница шлёт продуктовое
 * событие на `/api/track` (src/lib/track.ts), и этот запрос попадает в тот же
 * мок. Считать «сколько раз позвали fetch» после этого бессмысленно — счётчик
 * зашумлён событиями аналитики, а проверять нас должна авторизация. Поэтому
 * ниже адреса фильтруются, а не вызовы.
 */
const calledUrls = (fetchMock: FetchMock): string[] =>
  fetchMock.mock.calls.map((call) => String(call[0]));

/** Только вызовы авторизации (`/api/auth/*`) — то, что проверяет эта задача. */
const authUrls = (fetchMock: FetchMock): string[] =>
  calledUrls(fetchMock).filter((url) => url.includes("/api/auth/"));

/**
 * Ручки вида «есть ли пароль у этого email» (ТЗ §3, разрыв 4).
 *
 * Отдельная проверка, а не часть `authUrls`: такая ручка может называться и
 * `/api/password-exists`, и в списке `/api/auth/*` не попасть — а предзапрос
 * запрещён независимо от имени. Фильтр по форме имени ловит и то, и другое.
 */
const isPasswordProbe = (url: string): boolean =>
  /has[-_]?password|password[-_]?(exists|check|has|is[-_]?set)/i.test(url);

/** Включает путь «пароль», заполняет оба поля и отмечает согласие. */
const fillPasswordPath = async (
  user: ReturnType<typeof userEvent.setup>,
  password: string,
  email = "teacher@school.ru",
) => {
  await user.click(screen.getByTestId("login-mode-password"));
  await user.type(screen.getByLabelText(/^email$/i), email);
  await user.type(screen.getByTestId("login-password"), password);
  await user.click(screen.getByTestId("login-consent-pdn"));
  // Кнопка отправки ищется по data-testid, а не по названию: после приведения
  // подписей к формулировкам ТЗ §6 слово «Войти по паролю» стоит и на пункте
  // переключателя, и на кнопке — поиск по названию находит две кнопки.
  await user.click(screen.getByTestId("login-submit"));
};

describe("Страница входа — переключатель двух путей", () => {
  it("поле пароля появляется по выбору и прячется обратно", async () => {
    const user = userEvent.setup();
    renderLogin();

    expect(screen.queryByLabelText(/^пароль$/i)).toBeNull();

    await user.click(screen.getByTestId("login-mode-password"));
    expect(screen.getByLabelText(/^пароль$/i)).toBeTruthy();

    await user.click(screen.getByTestId("login-mode-link"));
    expect(screen.queryByLabelText(/^пароль$/i)).toBeNull();
  });

  /**
   * ТЗ §3, разрыв 4: пока введён адрес, фронт не спрашивает про него ничего.
   * Проверяем не текст, а отсутствие запроса — переключаем путь туда-сюда и
   * смотрим, что сеть не тронута.
   *
   * Считаем адреса авторизации, а не вызовы fetch: страница законно шлёт
   * событие `login_view` на `/api/track`, поэтому «fetch не вызывался вообще»
   * здесь проверить нельзя — это проверяло бы чужой код аналитики вместо
   * нашего. Проверка при этом остаётся строгой: ноль запросов к `/api/auth/*`
   * и ноль запросов к ручкам вида «есть ли пароль у этого email».
   */
  it("переключение пути не ходит в сеть — предзапроса по email нет", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText(/^email$/i), "teacher@school.ru");
    await user.click(screen.getByTestId("login-mode-password"));
    await user.click(screen.getByLabelText(/^пароль$/i));
    // Поле действительно раскрылось и получило фокус. Без этой проверки
    // «ни одного запроса» могло бы означать «тест ничего не сделал».
    expect(screen.getByTestId("login-password")).toBeTruthy();
    await user.click(screen.getByTestId("login-mode-link"));
    await user.click(screen.getByTestId("login-mode-password"));

    // Список адресов печатается в сообщении об ошибке — видно, что именно
    // ушло, если проверка вдруг упадёт.
    expect(authUrls(fetchMock)).toEqual([]);
    // Разумно проверить и ручку «есть ли пароль у этого email»: разрыв 4 запрещает
    // сам предзапрос, а не только вызовы по /api/auth/.
    expect(calledUrls(fetchMock).filter(isPasswordProbe)).toEqual([]);
  });

  it("успешный вход по паролю открывает кабинет", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ ok: true, user: loginUser }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderLogin();

    await fillPasswordPath(user, "uchlist2026");

    await waitFor(() => expect(routerPush).toHaveBeenCalledWith("/dashboard"));
    // Ровно один запрос авторизации и ровно в тот адрес. События аналитики
    // (login_view, login_password_submit, login_password_success) сюда не
    // попадают — но и не вычитаются: пропуск любого ЛИШНЕГО запроса
    // авторизации проверка по-прежнему ловит.
    expect(authUrls(fetchMock)).toEqual([`${API_URL}/api/auth/login`]);
    // Профиль записан тем же способом, что и после входа по ссылке, — иначе
    // шапка кабинета осталась бы без имени.
    expect(window.localStorage.getItem("uchlist.profile")).not.toBeNull();
  });

  it("короткий пароль показывает требование и запрос не уходит", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderLogin();

    await fillPasswordPath(user, "корот");

    expect(await screen.findByText(/минимум 8 символов/i)).toBeTruthy();
    // Правило нарушено до сети — ни одного запроса авторизации.
    expect(authUrls(fetchMock)).toEqual([]);
    // Заодно и сам отказ не показан: правила нарушены, а не «не получилось войти».
    expect(screen.queryByTestId("login-password-error")).toBeNull();
  });

  it("пароль без цифры не уходит в сеть", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderLogin();

    // 11 букв — правило длины соблюдено, не хватает только цифры.
    await fillPasswordPath(user, "uchlistpass");

    expect(await screen.findByText(/нужна хотя бы одна цифра/i)).toBeTruthy();
    expect(authUrls(fetchMock)).toEqual([]);
  });

  it("русская раскладка считается буквой: «пароль2026» проходит проверку", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ ok: true, user: loginUser }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderLogin();

    await fillPasswordPath(user, "пароль2026");

    // Запрос ушёл — значит правило про букву не отвергло кириллицу (ТЗ §7.1).
    await waitFor(() =>
      expect(authUrls(fetchMock)).toEqual([`${API_URL}/api/auth/login`]),
    );
    expect(routerPush).toHaveBeenCalledWith("/dashboard");
  });

  it("на экране один и тот же отказ — по тексту не проверить, есть ли аккаунт", async () => {
    const texts: string[] = [];
    // Один адрес — пароль не подошёл, другой — такого адреса нет. Бэк
    // отвечает разными кодами, но текст на экране обязан совпасть (ТЗ §12.3).
    for (const scenario of [
      { email: "teacher@school.ru", body: { error: "bad_password" } },
      { email: "test@example.com", body: { error: "no_user" } },
    ]) {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(failResponse(401, scenario.body)),
      );
      const user = userEvent.setup();
      const view = renderLogin();
      await fillPasswordPath(user, "uchlist2026", scenario.email);

      texts.push(
        (await screen.findByTestId("login-password-error")).textContent ?? "",
      );
      view.unmount();
    }

    expect(texts[0]).toContain(LOGIN_REFUSED_TEXT);
    expect(texts[1]).toContain(LOGIN_REFUSED_TEXT);
    expect(texts[0]).toBe(texts[1]);
    // Через 429 ничего не утекло: успеха не случилось ни в одном случае.
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("путь «получить ссылку» не сломан: шаги email → sent работают", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText(/^email$/i), "teacher@school.ru");
    await user.click(screen.getByTestId("login-consent-pdn"));
    await user.click(screen.getByTestId("login-submit"));

    expect(await screen.findByText(/проверьте почту/i)).toBeTruthy();
    // Адрес ищется среди вызовов, а не по индексу: событие login_view на
    // /api/track идёт первым и сдвигало нумерацию, из-за чего проверка ручки
    // magic-link падала, хотя ручка звалась верно. Строгость та же — ровно
    // один запрос авторизации, и это именно magic-link.
    expect(authUrls(fetchMock)).toEqual([`${API_URL}/api/auth/magic-link`]);
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("экран «Проверьте почту» больше не обещает вход без пароля", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse({ ok: true })));
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText(/^email$/i), "teacher@school.ru");
    await user.click(screen.getByTestId("login-consent-pdn"));
    await user.click(screen.getByTestId("login-submit"));
    await screen.findByText(/проверьте почту/i);

    // Обещание отсутствия пароля ушло вместе с фичей: пароль теперь есть.
    expect(document.body.textContent ?? "").not.toMatch(/пароль не нужен/i);
  });
});
