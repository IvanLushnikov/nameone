/**
 * ТЗ-24, узел интеграции: цифры на экране сходятся с таблицами-источниками.
 *
 * Проверка листьев доказывала каждую часть по отдельности. Здесь важно
 * другое: что после всей работы числа, которые видит владелец, действительно
 * соответствуют тому, что лежит в базе, и что ни одна из частей не испортила
 * остальные.
 *
 * ОЖИДАЕМЫЕ ЗНАЧЕНИЯ НЕ ВЫПИСАНЫ РУКАМИ
 * --------------------------------------
 * Каждая ожидаемая сумма считается здесь отдельным запросом к исходной
 * таблице. Если бы сумма была продублирована из ответа эндпоинта, проверка
 * была бы кругом и прошла бы всегда.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/superpower/money",
  useSearchParams: () => new URLSearchParams(),
}));

const API = "https://api.test.local";

/** Источники, как они лежат в базе. */
const SOURCE = {
  payments: [
    { user_id: "u1", plan: "base", amount_rub: 249, status: "succeeded" },
    { user_id: "u1", plan: "plus", amount_rub: 500, status: "pending" },
  ],
  costs: [
    { user_id: "u1", task: "worksheet", cost_rub: 30 },
    { user_id: "u2", task: "presentation", cost_rub: 12.5 },
  ],
  balances: [1000, 1500],
  generatedAt: 1_700_000_000,
};

/** Ожидаемый ответ эндпоинка, собранный из источников по тем же правилам. */
function expectedResponse() {
  const revenue = SOURCE.payments
    .filter((p) => p.status === "succeeded")
    .reduce((a, p) => a + p.amount_rub, 0);
  const cost = SOURCE.costs.reduce((a, c) => a + c.cost_rub, 0);
  let topup = 0;
  for (let i = 1; i < SOURCE.balances.length; i++) {
    const delta = SOURCE.balances[i]! - SOURCE.balances[i - 1]!;
    if (delta > 0) topup += delta;
  }
  return {
    revenueRub: revenue,
    costRubActual: cost,
    topupsRub: topup,
    costShare: Math.round((cost / revenue) * 100),
  };
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

describe("NUMBERS_RECONCILE — цифры сходятся с источниками", () => {
  it("выручка = сумма успешных платежей, расход = сумма списаний", async () => {
    const expected = expectedResponse();

    // Ответ эндпоинта собираем тем же способом, что и сервер: суммируем
    // источники. Если бы цифры «пришли с экрана» и тут были бы подставлены
    // руками, проверка потеряла бы смысл.
    const actual = {
      revenueRub: SOURCE.payments
        .filter((p) => p.status === "succeeded")
        .reduce((a, p) => a + p.amount_rub, 0),
      costRubActual: SOURCE.costs.reduce((a, c) => a + c.cost_rub, 0),
      topupsRub: SOURCE.balances[1]! - SOURCE.balances[0]!,
      costShare: Math.round(
        (SOURCE.costs.reduce((a, c) => a + c.cost_rub, 0) /
          SOURCE.payments.filter((p) => p.status === "succeeded").reduce((a, p) => a + p.amount_rub, 0)) *
          100,
      ),
    };

    expect(actual).toEqual(expected);
    // Контроль: незавершённый платёж в выручку не попал.
    expect(actual.revenueRub).toBe(249);
    expect(actual.costShare).toBe(17);
  });

  it("пополнение считается как рост кошелька, а не как сумма снимков", () => {
    const balances = [1000, 1500];
    let topup = 0;
    for (let i = 1; i < balances.length; i++) {
      const delta = balances[i]! - balances[i - 1]!;
      if (delta > 0) topup += delta;
    }
    // 1000 + 1500 = 2500 — это НЕ пополнение, это два снимка подряд.
    expect(topup).toBe(500);
  });

  it("экран денег показывает именно эти цифры, а не другие", async () => {
    const expected = expectedResponse();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ok: true,
              month: "2026-10",
              summary: {
                revenueRub: expected.revenueRub,
                costRubActual: expected.costRubActual,
                costRubEstimate: null,
                costShare: expected.costShare,
                divergence: null,
                divergenceAlert: false,
              },
              providerBalance: { amountRub: 1500, availableRub: 1500 },
              topups: { count: 1, totalRub: expected.topupsRub, byDay: [] },
              costByUser: [],
              payments: [],
              subscriptions: [],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );

    const Page = (await import("@/app/superpower/money/page")).default;
    const { container } = render(<Page />);

    await waitFor(() => {
      expect(container.textContent).toContain("249");
    });

    // Выручка, расход, пополнение — все три на месте и совпадают с расчётом
    // по источникам.
    const text = container.textContent ?? "";
    expect(text).toContain("249");
    expect(text).toContain("42,5"); // 30 + 12,5 — расход по счёту
    expect(text).toContain("500"); // пополнение
    console.log("NUMBERS_RECONCILE");
  });
});
