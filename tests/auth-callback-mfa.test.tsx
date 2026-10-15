/**
 * Вход по ссылке из письма: администратору показывается ввод кода подтверждения.
 *
 * Найдено 15.10.2026 при аудите доступа к суперадминке: `/api/auth/callback`
 * отдавал администратору полную сессию сразу, минуя код подтверждения. Второй
 * фактор защищал только вход по паролю, то есть ровно наполовину.
 *
 * Здесь проверяется видимая часть: что страница после ссылки СПРАШИВАЕТ код и
 * не пускает человека в кабинет без него. Серверная часть — в
 * backend/tests/unit/totp-flow.test.ts.
 *
 * Проверка на отрицание идёт с положительным контролем: если бы страница вообще
 * ничего не показывала, проверка «нет кода на экране» прошла бы. Поэтому
 * отдельно проверяем, что обычный вход по ссылке по-прежнему работает.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

// Роутер создаётся ОДИН раз: если отдавать новый объект на каждый вызов
// useRouter(), компонент получает новую зависимость, эффект входа перезапускается
// и страница уходит в бесконечный рендер (воркер падает по памяти).
const { pushMock, routerMock } = vi.hoisted(() => {
  const push = vi.fn();
  return {
    pushMock: push,
    routerMock: {
      push,
      replace: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      refresh: vi.fn(),
      prefetch: vi.fn(),
    },
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
  usePathname: () => "/auth/callback",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/track", () => ({ trackEvent: vi.fn() }));

// Адрес бэкенда читается модулем ОДИН раз при загрузке, поэтому переменная
// окружения ставится до импортов, а не в beforeEach: иначе клиент сразу
// отвечает «вход недоступен» и страница уходит в «ссылка не сработала».
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = "https://api.test.local";
});

import { AuthCallbackInner } from "@/app/auth/callback/AuthCallbackInner";

const API = "https://api.test.local";

const USER = {
  id: "u1",
  email: "admin@test.local",
  name: "Владелец",
  plan: "plus" as const,
  generationsTotal: 5,
  generationsToday: 0,
  generationsLimit: -1,
  createdAt: "2026-10-01T00:00:00.000Z",
};

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers(),
  };
}

/** Ответ сервера на конкретный адрес: /callback или /totp/verify. */
function routeFetch(routes: Record<string, () => unknown>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [needle, make] of Object.entries(routes)) {
      if (url.includes(needle)) return jsonResponse(make());
    }
    throw new Error(`незапланированный запрос: ${url}`);
  });
}

/** Открыть страницу входа по ссылке с токеном из письма. */
function openWithToken(token = "tok-123") {
  window.history.replaceState({}, "", `/auth/callback?token=${token}`);
  return render(<AuthCallbackInner />);
}

beforeEach(() => {
  pushMock.mockClear();

  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("вход по ссылке без кода подтверждения", () => {
  it("обычный вход открывает кабинет и экран кода не показывает", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({ "/api/auth/callback": () => ({ ok: true, user: USER }) }),
    );

    openWithToken();

    await waitFor(() => {
      expect(screen.getByTestId("auth-callback-success")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("auth-callback-mfa-code")).not.toBeInTheDocument();
  });
});

describe("вход по ссылке администратору с кодом подтверждения", () => {
  it("просит код и не открывает кабинет без него", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({
        "/api/auth/callback": () => ({
          ok: true,
          mfaRequired: true,
          pendingToken: "pend_abc123",
          message: "Введите код из приложения-аутентификатора",
        }),
      }),
    );

    openWithToken();

    const input = await screen.findByTestId("auth-callback-mfa-code");
    expect(input).toBeInTheDocument();
    // Главное утверждение: без кода в кабинет не уходим.
    expect(screen.queryByTestId("auth-callback-success")).not.toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("верный код доводит до входа", async () => {
    const fetchMock = routeFetch({
      "/api/auth/callback": () => ({
        ok: true,
        mfaRequired: true,
        pendingToken: "pend_abc123",
        message: "Введите код из приложения-аутентификатора",
      }),
      "/api/admin/totp/verify": () => ({ ok: true, method: "totp", user: USER }),
    });
    vi.stubGlobal("fetch", fetchMock);

    openWithToken();
    const input = await screen.findByTestId("auth-callback-mfa-code");

    fireEvent.change(input, { target: { value: "123456" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => {
      expect(screen.getByTestId("auth-callback-success")).toBeInTheDocument();
    });

    // Второй шаг ушёл с временным токеном, который выдал первый.
    const verifyCall = fetchMock.mock.calls.find((call) =>
      String(call[0]).includes("/api/admin/totp/verify"),
    ) as unknown as [string, RequestInit] | undefined;
    expect(verifyCall).toBeTruthy();
    expect(JSON.parse(String(verifyCall![1].body))).toEqual({
      code: "123456",
      pendingToken: "pend_abc123",
    });
  });

  it("неверный код оставляет на экране ввода и показывает ошибку", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/auth/callback")) {
        return jsonResponse({
          ok: true,
          mfaRequired: true,
          pendingToken: "pend_abc123",
          message: "Введите код из приложения-аутентификатора",
        });
      }
      // Сервер на неверный код отвечает именно так: статус 400 и текст ошибки.
      if (url.includes("/api/admin/totp/verify")) {
        return jsonResponse({ ok: false, error: "Код не подошёл" }, 400);
      }
      throw new Error(`незапланированный запрос: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    openWithToken();
    const input = await screen.findByTestId("auth-callback-mfa-code");

    fireEvent.change(input, { target: { value: "000000" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => {
      expect(screen.getByTestId("auth-callback-mfa-error")).toHaveTextContent("Код не подошёл");
    });
    // Экран остаётся: человек вводит код заново, а не начинает с нуля.
    expect(screen.getByTestId("auth-callback-mfa-code")).toBeInTheDocument();
    expect(screen.queryByTestId("auth-callback-success")).not.toBeInTheDocument();
  });
});
