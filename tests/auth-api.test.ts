/**
 * Тесты для `src/lib/auth/api.ts` — клиент /api/auth/* и /api/users/usage.
 *
 * Покрывает все 5 функций через `vi.stubGlobal('fetch', vi.fn())`:
 *   1. requestMagicLink(email) — POST /api/auth/magic-link
 *   2. verifyMagicLink(token)  — POST /api/auth/callback
 *   3. getCurrentUser()        — GET  /api/auth/me
 *   4. getUsage()              — GET  /api/users/usage
 *   5. signOutFromApi()        — POST /api/auth/logout (silent fail)
 *
 * `credentials: 'include'`, `Content-Type: application/json`,
 * URL = `${NEXT_PUBLIC_API_URL}${path}` — все три проверяются.
 *
 * Мок fetch'а сделан через vi.stubGlobal (не vi.mock на модуль) — это позволяет
 * проверять ровно те url/init, что уходят наружу, без реэкспорта обёрток.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Установим NEXT_PUBLIC_API_URL ДО импорта api.ts (модуль читает env на top-level).
// `vi.hoisted` гарантирует, что мутация выполняется до резолва ES-import'ов
// (иначе TypeScript hoists `import` выше нашего присваивания).
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
});

import {
  requestMagicLink,
  verifyMagicLink,
  getCurrentUser,
  getUsage,
  signOutFromApi,
  AuthApiError,
} from "@/lib/auth/api";

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