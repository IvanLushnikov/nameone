/**
 * ТЗ-43: экран денег показывает ФАКТ про баланс провайдера.
 *
 * ─── ЧТО БЫЛО ───────────────────────────────────────────────────────────────
 * На `/superpower/money` блок «Кошелёк у провайдера» показывал «Снимков баланса
 * ещё нет» — и показывал бы это даже тогда, когда снимок есть, просто
 * подключён он был только к экрану, а не к крону. Второй блок — «Пополнения» —
 * показывал «0 ₽» даже при одном снимке, хотя по одному снимку о пополнениях
 * не известно ничего.
 *
 * ─── ЧТО ПРОВЕРЯЕМ ──────────────────────────────────────────────────────────
 *
 * Э1. Свежий снимок: на экране сумма и «снято сегодня», а не «снимков ещё нет».
 * Э2. Вчерашний снимок: «сегодня ещё не снимали» + дата последнего снимка.
 *     Это разные вещи с «снимков баланса ещё нет»: первое — механизм работает,
 *     второе — не работает (или не отработал ни разу).
 * Э3. Снимков не было ни разу: экран прямо говорит, что крон не отработал.
 * Э4. Пополнения при одном снимке — «нет данных», а НЕ «0 ₽».
 * Э5. Пополнения при двух снимках без роста — «0 ₽» и «пополнений не было»,
 *     и это не выглядит как ошибка.
 *
 * Время снимка подставляется в ответе сервера (`at`, unix-секунды): именно
 * его сервер отдаёт, и по нему экран отличает сегодняшний снимок от
 * вчерашнего.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

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
const NOW = Math.floor(Date.now() / 1000);

/** Ответ `/api/admin/money` с правками поверх нормального. */
function moneyResponse(overrides: Record<string, unknown> = {}): unknown {
  return {
    ok: true,
    month: "2026-10",
    summary: {
      revenueRub: 249,
      costRubActual: 30,
      costRubEstimate: 34.48,
      costShare: 12,
      divergence: 0.13,
      divergenceAlert: false,
    },
    providerBalance: { amountRub: 1250.5, availableRub: 1200.06, at: NOW },
    topups: { count: 1, totalRub: 500, byDay: [{ date: "2026-10-28", amountRub: 500 }], snapshots: 2 },
    costByUser: [],
    payments: [],
    subscriptions: [],
    ...overrides,
  };
}

/** Заглушка API: отвечает по адресу из `routes`. */
function stubApi(routes: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const key = String(url).replace(API, "").split("?")[0] ?? "";
      return new Response(JSON.stringify(routes[key] ?? {}), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

/** Отрисовать экран денег с заданным ответом бэка. */
async function renderMoney(response: unknown) {
  stubApi({ "/api/admin/money": response });
  const Page = (await import("@/app/superpower/money/page")).default;
  const view = render(<Page />);
  await waitFor(() => {
    expect(view.container.textContent ?? "").not.toBe("");
  });
  return view;
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

describe("ТЗ-43: баланс провайдера на экране денег", () => {
  it("Э1: свежий снимок — сумма и «снято сегодня»", async () => {
    const { container } = await renderMoney(moneyResponse());
    const text = container.textContent ?? "";

    expect(text).toMatch(/1\s250,5/);
    expect(text).toContain("Снято сегодня");
    // Старое сообщение про отсутствие снимков тут быть не должно.
    expect(text).not.toContain("Снимков баланса ещё нет");
    expect(text).not.toContain("сегодня ещё не снимали");
  });

  it("Э2: вчерашний снимок — «сегодня ещё не снимали», а не «снимков ещё нет»", async () => {
    const { container } = await renderMoney(
      moneyResponse({
        providerBalance: { amountRub: 1250.5, availableRub: 1200.06, at: NOW - 3 * 24 * 3600 },
      }),
    );
    const text = container.textContent ?? "";

    expect(text).toContain("Сегодня ещё не снимали");
    expect(text).toContain("Последний снимок");
    expect(text).not.toContain("Снимков баланса ещё нет");
  });

  it("Э3: снимков не было ни разу — экран говорит, что крон не отработал", async () => {
    const { container } = await renderMoney(moneyResponse({ providerBalance: null }));
    const text = container.textContent ?? "";

    expect(text).toContain("Сегодня ещё не снимали");
    expect(text).toContain("снимков баланса пока нет вообще");
    expect(text).not.toContain("Снимков баланса ещё нет");
  });

  it("Э4: при одном снимке пополнения — «нет данных», а не «0 ₽»", async () => {
    const { container } = await renderMoney(
      moneyResponse({
        topups: { count: 0, totalRub: null, byDay: [], snapshots: 1 },
      }),
    );
    const text = container.textContent ?? "";

    const card = screen.getByText("Пополнено за месяц").closest("div")?.parentElement;
    expect(card?.textContent).toContain("нет данных");
    expect(card?.textContent).not.toContain("0\u00A0₽");
    // И объяснение, чего не хватает, — чтобы «нет данных» не выглядело ошибкой.
    expect(text).toContain("Нужны два снимка");
  });

  it("Э5: без роста кошелька — «пополнений не было», и это не ошибка", async () => {
    const { container } = await renderMoney(
      moneyResponse({
        topups: { count: 0, totalRub: 0, byDay: [], snapshots: 2 },
      }),
    );
    const text = container.textContent ?? "";

    expect(text).toContain("Пополнений не было");
    const card = screen.getByText("Пополнено за месяц").closest("div")?.parentElement;
    expect(card?.textContent).toContain("0\u00A0₽");
  });
});
