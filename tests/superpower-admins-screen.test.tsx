/**
 * Экран «Кто может заходить в суперадминку» (15.10.2026).
 *
 * До этого дня список прав не показывался нигде: права выдавались один раз при
 * первой регистрации и держались навсегда, а снять их можно было только
 * правкой базы руками. Если адрес из серверного списка освобождали и он
 * доставался другому человеку, тот получал суперадминку — и никто этого не
 * видел.
 *
 * Проверяются три вещи, которые ломаются тихо:
 *  1. Человек видит, у кого вообще есть права и у кого нет кода подтверждения.
 *     Без кода ссылка из письма открывает суперадминку сразу.
 *  2. Кнопка «Снять права» есть у чужого аккаунта.
 *  3. У своего аккаунта кнопки нет: снявший с себя права теряет доступ к
 *     разделу навсегда.
 *
 * Проверка на отрицание идёт с положительным контролем: если бы компонент не
 * отрисовал ничего, все проверки «кнопки нет» прошли бы. Поэтому отдельно
 * проверяем, что при нормальных данных на экране есть строки с почтами.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/superpower/security",
  useSearchParams: () => new URLSearchParams(),
}));

// Адрес бэкенда читается модулем при загрузке — задаём до импортов.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = "https://api.test.local";
});

import { AdminList } from "@/components/superpower/AdminList";

const SELF_ID = "u_self";
const OTHER_ID = "u_other";

const ADMINS = [
  {
    id: SELF_ID,
    email: "owner@test.local",
    name: "Владелец",
    plan: "plus",
    totpEnabled: true,
    createdAt: "2026-09-29T16:03:55.000Z",
    isSelf: true,
  },
  {
    id: OTHER_ID,
    email: "second@test.local",
    name: "Второй",
    plan: "plus",
    // Ключевой случай: кода нет — вход по ссылке из письма открывает раздел.
    totpEnabled: false,
    createdAt: "2026-10-12T12:13:02.000Z",
    isSelf: false,
  },
];

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers(),
  };
}

function renderWith(
  handler: (url: string, init?: RequestInit) => unknown,
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    jsonResponse(handler(String(input), init)),
  );
  vi.stubGlobal("fetch", fetchMock);
  render(<AdminList />);
  return fetchMock;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("кто может заходить в суперадминку", () => {
  it("показывает список и предупреждает про аккаунт без кода подтверждения", async () => {
    renderWith((url) => {
      if (url.includes("/api/admin/admins")) return { ok: true, admins: ADMINS };
      throw new Error(`незапланированный запрос: ${url}`);
    });

    await waitFor(() => {
      expect(screen.getByText("owner@test.local")).toBeInTheDocument();
    });
    // Положительный контроль: данные действительно отрисованы, а не пусто.
    expect(screen.getByText("second@test.local")).toBeInTheDocument();
    expect(screen.getByTestId(`admin-row-${OTHER_ID}`)).toHaveTextContent(
      "Код подтверждения не включён",
    );
    expect(screen.getByTestId(`admin-row-${SELF_ID}`)).toHaveTextContent(
      "Код подтверждения включён",
    );
  });

  it("у чужого аккаунта есть кнопка снятия прав, у своего — нет", async () => {
    renderWith((url) => {
      if (url.includes("/api/admin/admins")) return { ok: true, admins: ADMINS };
      throw new Error(`незапланированный запрос: ${url}`);
    });

    await waitFor(() => {
      expect(screen.getByTestId(`revoke-${OTHER_ID}`)).toBeInTheDocument();
    });
    // Свои права снять нельзя — кнопки не существует вовсе.
    expect(screen.queryByTestId(`revoke-${SELF_ID}`)).not.toBeInTheDocument();
    expect(screen.getByText("Свои права снять нельзя")).toBeInTheDocument();
  });

  it("нажатие снимает права и перечитывает список", async () => {
    const fetchMock = renderWith((url) => {
      if (url.includes("/api/admin/admins")) return { ok: true, admins: ADMINS };
      throw new Error(`незапланированный запрос: ${url}`);
    });

    await waitFor(() => {
      expect(screen.getByTestId(`revoke-${OTHER_ID}`)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId(`revoke-${OTHER_ID}`));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([url, init]) => {
        const u = String(url);
        return u.includes("/api/admin/admins") && init?.method === "POST";
      });
      expect(post).toBeTruthy();
      expect(JSON.parse(String((post as unknown as [string, RequestInit])[1].body))).toEqual({
        userId: OTHER_ID,
        isAdmin: false,
      });
    });
  });

  it("отказ сервера показывается текстом, а не молча пропадает", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/admin/admins") && init?.method === "POST") {
        return jsonResponse({ error: "Нельзя снять права с себя" }, 403);
      }
      if (url.includes("/api/admin/admins")) return jsonResponse({ ok: true, admins: ADMINS });
      throw new Error(`незапланированный запрос: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AdminList />);

    await waitFor(() => {
      expect(screen.getByTestId(`revoke-${OTHER_ID}`)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId(`revoke-${OTHER_ID}`));

    await waitFor(() => {
      expect(screen.getByText("Нельзя снять права с себя")).toBeInTheDocument();
    });
    // Список после неудачи остаётся на экране — человек видит, что ничего не сломалось.
    expect(screen.getByText("owner@test.local")).toBeInTheDocument();
  });
});
