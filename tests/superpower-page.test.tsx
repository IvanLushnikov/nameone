/**
 * ТЗ-24, лист-4: страницы `/superpower`.
 *
 * Проверяются вещи, которые ломаются тихо:
 *
 *  1. ОХРАНА. До 12.10.2026 `AdminGuard` был заглушкой «пропускает всех» —
 *     теперь не-администратор не должен увидеть содержимое страницы вообще.
 *
 *  2. ЧЕТЫРЕ ЭКРАНА ТЯНУТ ДАННЫЕ С БЭКЕНДА, а не показывают заглушку. Если
 *     страница начнёт подставлять правдоподобные демо-цифры при упавшем бэке,
 *     человек уйдёт с ложным выводом о состоянии продукта.
 *
 *  3. ПУСТЫЕ ДАННЫЕ НЕ ДАЮТ «NaN», «Infinity» или «undefined». Ноль и «нет
 *     данных» — разные вещи: ноль означал бы «потратили ноль».
 *
 * Проверка на отрицание везде идёт с ПОЛОЖИТЕЛЬНЫМ контролем: если бы страница
 * не показывала ничего вовсе, все негативные проверки прошли бы. Поэтому
 * отдельно проверяем, что при нормальных данных цифры на экране есть.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/superpower",
  useSearchParams: () => new URLSearchParams(),
}));

const API = "https://api.test.local";

/** Нормальный ответ светофора. */
const OVERVIEW_OK = {
  ok: true,
  month: "2026-10",
  today: { events: 42, generations: 7, signups: 3 },
  last30: { events: 900, activeUsers: 55, generations: 300 },
  money: {
    revenueRub: 249,
    costRubActual: 30,
    costRubEstimate: 34.48,
    costShare: 12,
    divergence: 0.13,
    divergenceAlert: true,
  },
  activeSubscriptions: 4,
  providerBalance: { amountRub: 1250.5, availableRub: 1200.06 },
};

/** Ответ без единого числа — так выглядит первый день после запуска. */
const OVERVIEW_EMPTY = {
  ok: true,
  month: "2026-10",
  today: { events: 0, generations: 0, signups: 0 },
  last30: { events: 0, activeUsers: 0, generations: 0 },
  money: {
    revenueRub: 0,
    costRubActual: null,
    costRubEstimate: null,
    costShare: null,
    divergence: null,
    divergenceAlert: false,
  },
  activeSubscriptions: 0,
  providerBalance: null,
};

/** Собирает fetch-заглушку, которая отвечает по адресу. */
function stubApi(routes: Record<string, unknown>, options: { status?: number } = {}) {
  const calls: string[] = [];
  const fn = vi.fn(async (url: string) => {
    const key = String(url).replace(API, "").split("?")[0] ?? "";
    calls.push(String(url));
    if (options.status && options.status !== 200) {
      return new Response("{}", { status: options.status });
    }
    return new Response(JSON.stringify(routes[key] ?? {}), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

/** Текущий пользователь для getCurrentUser. */
function stubUser(user: unknown) {
  const fetchMock = vi.fn(async (url: string) => {
    if (String(url).includes("/api/auth/me")) {
      return new Response(JSON.stringify({ ok: true, user }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("{}", { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", API);
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("G1: охрана админки перестала быть заглушкой", () => {
  it("не-администратор не видит содержимого страницы", async () => {
    stubUser({ id: "u1", email: "t@test.local", name: "Учитель", plan: "free", isAdmin: false });
    const { AdminGuard } = await import("@/components/admin/AdminGuard");

    render(
      <AdminGuard>
        <div>СЕКРЕТНАЯ ВЫРУЧКА 249 ₽</div>
      </AdminGuard>,
    );

    await waitFor(() => {
      expect(screen.getByText("Это не админский раздел")).toBeInTheDocument();
    });
    // Собственно то, что проверяем: содержимое не отрисовано.
    expect(screen.queryByText(/СЕКРЕТНАЯ ВЫРУЧКА/)).toBeNull();
  });

  it("аноним видит предложение войти, а не содержимое", async () => {
    stubUser(null);
    const { AdminGuard } = await import("@/components/admin/AdminGuard");

    render(
      <AdminGuard>
        <div>СЕКРЕТНАЯ ВЫРУЧКА 249 ₽</div>
      </AdminGuard>,
    );

    await waitFor(() => {
      expect(screen.getByText("Нужен вход")).toBeInTheDocument();
    });
    expect(screen.queryByText(/СЕКРЕТНАЯ ВЫРУЧКА/)).toBeNull();
  });

  it("администратор видит содержимое — положительный контроль к двум проверкам выше", async () => {
    stubUser({ id: "u0", email: "a@test.local", name: "Владелец", plan: "plus", isAdmin: true });
    const { AdminGuard } = await import("@/components/admin/AdminGuard");

    render(
      <AdminGuard>
        <div>СЕКРЕТНАЯ ВЫРУЧКА 249 ₽</div>
      </AdminGuard>,
    );

    await waitFor(() => {
      expect(screen.getByText(/СЕКРЕТНАЯ ВЫРУЧКА/)).toBeInTheDocument();
    });
  });
});

describe("G2: четыре экрана тянут данные с бэкенда", () => {
  it("светофор запрашивает /api/admin/overview и показывает цифры", async () => {
    const calls = stubApi({ "/api/admin/overview": OVERVIEW_OK });
    const Page = (await import("@/app/superpower/page")).default;
    const view = render(<Page />);
    await waitFor(() => {
      expect(view.container.textContent ?? "").toContain("249");
    });
    // Положительный контроль: именно сумма, а не просто число где-то на экране.
    expect(view.container.textContent ?? "").toMatch(/249[^0-9]/);
    expect(calls.some((c) => c.includes("/api/admin/overview"))).toBe(true);
  });

  it("экраны запрашивают /api/admin/screens", async () => {
    const calls = stubApi({
      "/api/admin/screens": {
        ok: true,
        days: 30,
        events: [{ event: "login_view", total: 10, byDay: [{ date: "2026-10-12", count: 10 }] }],
        funnel: [{ step: "login_view", label: "Открыл вход", users: 10, fromPrev: null }],
        totals: { events: 10, byDay: [{ date: "2026-10-12", count: 10 }] },
      },
    });
    const Page = (await import("@/app/superpower/screens/page")).default;
    render(<Page />);

    await waitFor(() => {
      expect(screen.getByText("login_view")).toBeInTheDocument();
    });
    expect(calls.some((c) => c.includes("/api/admin/screens"))).toBe(true);
  });

  it("генерации запрашивают /api/admin/generations", async () => {
    const calls = stubApi({
      "/api/admin/generations": {
        ok: true,
        days: 30,
        totals: { calls: 120, failed: 3, fallback: 2, cached: 30, cacheRate: 25 },
        byTask: [{ task: "worksheet", calls: 100, costRubActual: 30 }],
        byDay: [{ date: "2026-10-12", calls: 10, failed: 0 }],
      },
    });
    const Page = (await import("@/app/superpower/generations/page")).default;
    render(<Page />);

    await waitFor(() => {
      expect(screen.getByText("120")).toBeInTheDocument();
    });
    expect(calls.some((c) => c.includes("/api/admin/generations"))).toBe(true);
  });

  it("деньги запрашивают /api/admin/money", async () => {
    const calls = stubApi({
      "/api/admin/money": {
        ok: true,
        month: "2026-10",
        summary: OVERVIEW_OK.money,
        providerBalance: { amountRub: 1250.5, availableRub: 1200.06 },
        topups: { count: 1, totalRub: 500, byDay: [{ date: "2026-10-11", amountRub: 500 }] },
        costByUser: [],
        payments: [],
        subscriptions: [],
      },
    });
    const Page = (await import("@/app/superpower/money/page")).default;
    render(<Page />);

    await waitFor(() => {
      expect(screen.getByText(/Пополнено за месяц/)).toBeInTheDocument();
    });
    expect(calls.some((c) => c.includes("/api/admin/money"))).toBe(true);
  });

  it("упавший бэкенд даёт честную ошибку, а не правдоподобные цифры", async () => {
    stubApi({}, { status: 500 });
    const Page = (await import("@/app/superpower/page")).default;
    const { container } = render(<Page />);

    await waitFor(() => {
      expect(screen.getByText(/Сервер ответил ошибкой/)).toBeInTheDocument();
    });
    // Ни одной цифры из «нормального» ответа на экране быть не должно.
    expect(container.textContent).not.toContain("249");
    expect(container.textContent).not.toContain("1250");
  });

  it("403 на экране денег объясняет, что нужен вход администратора", async () => {
    stubApi({}, { status: 403 });
    const Page = (await import("@/app/superpower/money/page")).default;
    render(<Page />);

    await waitFor(() => {
      expect(screen.getByText("Нужен вход администратора")).toBeInTheDocument();
    });
  });
});

describe("G3: пустые данные не превращаются в NaN", () => {
  it("светофор при нулевых данных не показывает NaN, Infinity и undefined", async () => {
    stubApi({ "/api/admin/overview": OVERVIEW_EMPTY });
    const Page = (await import("@/app/superpower/page")).default;
    const { container } = render(<Page />);

    await waitFor(() => {
      expect(screen.getByText("Событий сегодня")).toBeInTheDocument();
    });

    const text = container.textContent ?? "";
    expect(text).not.toContain("NaN");
    expect(text).not.toContain("Infinity");
    expect(text).not.toContain("undefined");
    // Ноль показывается нулём — событий действительно не было.
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
  });

  it("«нет данных» на месте расхода, а не «0 ₽» — это разные утверждения", async () => {
    stubApi({ "/api/admin/overview": OVERVIEW_EMPTY });
    const Page = (await import("@/app/superpower/page")).default;
    const { container } = render(<Page />);

    await waitFor(() => {
      expect(screen.getByText("Событий сегодня")).toBeInTheDocument();
    });

    // Выручка за месяц правда нулевая, и показывать «0 ₽» здесь верно.
    // Ошибочным был бы ноль В БЛОКЕ РАСХОДА: счёт ещё не забирался, а
    // «0 ₽» означало бы «потратили ноль». Проверяем именно это.
    const costCard = screen.getByText("Расходы по счёту polza.ai").closest("div")?.parentElement;
    expect(costCard?.textContent).toContain("нет данных");
    expect(costCard?.textContent).not.toContain("0\u00A0₽");
    // Положительный контроль: честная подпись на месте.
    expect(screen.getAllByText("нет данных").length).toBeGreaterThan(0);
  });

  it("прочерк вместо нуля там, где сравнивать не с чем", async () => {
    stubApi({
      "/api/admin/screens": {
        ok: true,
        days: 30,
        events: [],
        funnel: [{ step: "login_view", label: "Открыл вход", users: 0, fromPrev: null }],
        totals: { events: 0, byDay: [] },
      },
    });
    const Page = (await import("@/app/superpower/screens/page")).default;
    const { container } = render(<Page />);

    await waitFor(() => {
      // Метка шага есть и в плитке, и в таблице воронки — берём все вхождения.
      expect(screen.getAllByText("Открыл вход").length).toBeGreaterThan(0);
    });

    const text = container.textContent ?? "";
    expect(text).not.toContain("NaN");
    // Первый шаг воронки: сравнивать не с чем — прочерк, не 0%.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});

describe("итог листа-4", () => {
  it("ADMIN_GUARD_ENFORCED — содержимое скрыто от не-админа", async () => {
    stubUser({ id: "u1", email: "t@test.local", name: "Учитель", plan: "free", isAdmin: false });
    const { AdminGuard } = await import("@/components/admin/AdminGuard");

    render(
      <AdminGuard>
        <div>СЕКРЕТНАЯ ВЫРУЧКА</div>
      </AdminGuard>,
    );
    await waitFor(() => {
      expect(screen.getByText("Это не админский раздел")).toBeInTheDocument();
    });
    expect(screen.queryByText("СЕКРЕТНАЯ ВЫРУЧКА")).toBeNull();
    console.log("ADMIN_GUARD_ENFORCED");
  });

  it("FOUR_SCREENS_READ_DATA — все четыре экрана берут данные с бэкенда", async () => {
    const calls = stubApi({
      "/api/admin/overview": OVERVIEW_OK,
      "/api/admin/screens": {
        ok: true,
        days: 30,
        events: [{ event: "login_view", total: 10, byDay: [] }],
        funnel: [{ step: "login_view", label: "Открыл вход", users: 10, fromPrev: null }],
        totals: { events: 10, byDay: [] },
      },
      "/api/admin/generations": {
        ok: true,
        days: 30,
        totals: { calls: 120, failed: 0, fallback: 0, cached: 30, cacheRate: 25 },
        byTask: [],
        byDay: [],
      },
      "/api/admin/money": {
        ok: true,
        month: "2026-10",
        summary: OVERVIEW_OK.money,
        providerBalance: null,
        topups: { count: 0, totalRub: 0, byDay: [] },
        costByUser: [],
        payments: [],
        subscriptions: [],
      },
    });

    const OverviewPage = (await import("@/app/superpower/page")).default;
    const ScreensPage = (await import("@/app/superpower/screens/page")).default;
    const GenerationsPage = (await import("@/app/superpower/generations/page")).default;
    const MoneyPage = (await import("@/app/superpower/money/page")).default;

    for (const Page of [OverviewPage, ScreensPage, GenerationsPage, MoneyPage]) {
      const view = render(<Page />);
      await waitFor(() => {
        expect(view.container.textContent).not.toBe("");
      });
      view.unmount();
    }

    for (const ep of ["overview", "screens", "generations", "money"]) {
      expect(calls.some((c) => c.includes(`/api/admin/${ep}`)), `экран ${ep} не запросил данные`).toBe(
        true,
      );
    }
    console.log("FOUR_SCREENS_READ_DATA");
  });

  it("EMPTY_STATE_SAFE — на пустых данных нет NaN и ложных нулей", async () => {
    stubApi({ "/api/admin/overview": OVERVIEW_EMPTY });
    const Page = (await import("@/app/superpower/page")).default;
    const { container } = render(<Page />);

    await waitFor(() => {
      expect(screen.getByText("Событий сегодня")).toBeInTheDocument();
    });

    const text = container.textContent ?? "";
    expect(text).not.toContain("NaN");
    expect(text).not.toContain("Infinity");
    expect(text).not.toContain("undefined");
    console.log("EMPTY_STATE_SAFE");
  });
});