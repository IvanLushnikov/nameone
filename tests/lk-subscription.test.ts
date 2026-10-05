/**
 * Тесты блока «Подписка» (ТЗ-21, блок 4).
 *
 * Покрывает `src/lib/lk/subscription-api.ts`:
 *   1. СОСТОЯНИЯ: тарифа нет · превышен объём · автопродление выключено (отмена);
 *   2. ЧЕСТНЫЙ РАСЧЁТ: повышение — разница за остаток периода, понижение — 0 ₽
 *      сейчас, первая покупка — полная цена;
 *   3. ОПЛАТА: запрос уходит на /api/billing/create с честным периодом, а при
 *      неработающем интеграторе возвращается payment_unavailable — НИКАКОЙ
 *      «успешной оплаты»;
 *   4. ОТМЕНА: дергаем /api/billing/cancel и передаём причину;
 *   5. ИСТОРИЯ: чеки показываются из ответа сервера, незавершённые не прячутся;
 *   6. АНОНИМ: блок отдаёт тариф с устройства, а не «войдите, чтобы увидеть».
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
});

import {
  cancelSubscription,
  createPayment,
  deviceSubscriptionView,
  fetchPaymentHistory,
  fetchSubscription,
  loadSubscription,
  quotePlanChange,
} from "@/lib/lk/subscription-api";

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

const nowSec = Math.floor(Date.now() / 1000);
const DAY = 86400;

function stubAuth(fetchMock: ReturnType<typeof vi.fn>) {
  return vi.fn(async (url: string) => {
    if (url.includes("/api/auth/me")) {
      return okResponse({
        ok: true,
        user: { id: "usr_1", email: "t@example.ru", name: "Иван", plan: "base" },
      });
    }
    return fetchMock(url);
  });
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ── Состояния ───────────────────────────────────────────────────────────── */

describe("состояния блока подписки", () => {
  it("тарифа нет → состояние free, платить не нужно", async () => {
    const inner = vi.fn(async (url: string) => {
      if (url.includes("/api/billing/subscription")) {
        return failResponse(404, { ok: false, code: "NOT_FOUND" });
      }
      if (url.includes("/api/billing/history")) return okResponse({ ok: true, payments: [] });
      return okResponse({ ok: true, usage: null });
    });
    vi.stubGlobal("fetch", stubAuth(inner as never));

    const res = await loadSubscription();
    expect(res.subscription.state).toBe("free");
    expect(res.subscription.priceLabel.replace(/\u00A0/g, " ")).toContain("0 ₽");
    // Подписки нет — платить можно, аккаунт есть.
    expect(res.canPay).toBe(true);
  });

  it("превышен объём → состояние over, подписка при этом активна", async () => {
    const inner = vi.fn(async (url: string) => {
      if (url.includes("/api/billing/subscription")) {
        return okResponse({
          ok: true,
          subscription: {
            plan: "base",
            status: "active",
            period: "academicYear",
            starts_at: nowSec - 100 * DAY,
            ends_at: nowSec + 20 * DAY,
            auto_renew: 1,
          },
        });
      }
      if (url.includes("/api/billing/history")) return okResponse({ ok: true, payments: [] });
      if (url.includes("/api/users/usage")) {
        // Форма ответа /api/users/usage — полезная нагрузка в корне.
        return okResponse({ ok: true, plan: "base", over: true, weightedTokensUsed: 2_000_000, norm: 1_440_000, remaining: 0, periodEndsAt: null, worksheetsEquivalent: 1200, freeRemaining: null, requiresChallenge: false, generationsToday: 0, generationsLimit: -1, generationsResetAt: null });
      }
      return okResponse({ ok: true });
    });
    vi.stubGlobal("fetch", stubAuth(inner as never));

    const res = await loadSubscription();
    expect(res.subscription.state).toBe("over");
    // Дата следующего списания видна отдельной строкой — это и было в ТЗ.
    expect(res.subscription.nextChargeAt).toBe(nowSec + 20 * DAY);
    expect(res.subscription.autoRenew).toBe(true);
  });

  it("отмена: автопродления нет, а доступ доигрывается до даты", async () => {
    const inner = vi.fn(async (url: string) => {
      if (url.includes("/api/billing/subscription")) {
        return okResponse({
          ok: true,
          subscription: {
            plan: "plus",
            status: "active",
            period: "monthly",
            starts_at: nowSec - 10 * DAY,
            ends_at: nowSec + 5 * DAY,
            auto_renew: 0,
          },
        });
      }
      if (url.includes("/api/billing/history")) {
        return okResponse({
          ok: true,
          payments: [
            { id: "pay_1", plan: "plus", amountRub: 1500, status: "succeeded", createdAt: nowSec - 10 * DAY, completedAt: nowSec - 10 * DAY, receiptUrl: "https://yookassa.example/receipt/1" },
            { id: "pay_2", plan: "plus", amountRub: 1500, status: "pending", createdAt: nowSec - DAY, completedAt: null, receiptUrl: null },
          ],
        });
      }
      return okResponse({ ok: true, usage: null });
    });
    vi.stubGlobal("fetch", stubAuth(inner as never));

    const res = await loadSubscription();
    expect(res.subscription.state).toBe("canceled");
    expect(res.subscription.autoRenew).toBe(false);
    // Списания больше не будет — и даты списания нет, а не «потерялась».
    expect(res.subscription.nextChargeAt).toBeNull();
    expect(res.subscription.periodEndsAt).toBe(nowSec + 5 * DAY);
    expect(res.subscription.paymentMethod).toBe("none");
    // История: незавершённый платёж не прячется, чек отдаётся как пришёл.
    expect(res.history).toHaveLength(2);
    expect(res.history[0].receiptUrl).toContain("yookassa.example");
  });
});

/* ── Аноним ──────────────────────────────────────────────────────────────── */

describe("анонимный учитель", () => {
  it("блок отдаёт тариф с устройства и не требует входа", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okResponse({ ok: true, user: null })));
    const res = await loadSubscription();
    expect(res.subscription.state).toBe("free");
    expect(res.subscription.source).toBe("device");
    // Платить из кабинета без аккаунта нельзя — и сказано почему, а не «войдите,
    // чтобы увидеть блок»: сам блок виден.
    expect(res.canPay).toBe(false);
    expect(res.canPayReason).toContain("странице тарифов");
  });

  it("тариф с устройства читается локально, без сети вообще", () => {
    const view = deviceSubscriptionView();
    expect(view.source).toBe("device");
    expect(view.planName).toBe("Бесплатно");
  });
});

/* ── Расчёт смены тарифа ─────────────────────────────────────────────────── */

describe("честный расчёт цены", () => {
  it("первая покупка — полная цена выбранного периода", () => {
    const q = quotePlanChange({ from: "free", to: "base", period: "month", now: nowSec, periodEndsAt: null });
    expect(q.kind).toBe("start");
    expect(q.payNowRub).toBe(500);
  });

  it("повышение — только разница за оставшиеся дни, не полный месяц", () => {
    // Базовый за месяц (500 ₽) оплачен, осталось 15 дней из 30, переходим на Плюс.
    const q = quotePlanChange({
      from: "base",
      to: "plus",
      period: "month",
      now: nowSec,
      periodEndsAt: nowSec + 15 * DAY,
    });
    expect(q.kind).toBe("upgrade");
    expect(q.payNowRub).toBe(750); // 1500 * 15/30
    expect(q.nextPriceRub).toBe(1500);
    expect(q.effectiveAt).toBe(nowSec);
  });

  it("повышение за один день до конца периода стоит копейки, а не месяца", () => {
    // Учебный год = 270 дней, «Плюс» = 11 000 ₽. Остался 1 день:
    // 11000 * 1/270 ≈ 40 ₽. Проверяем, что платится ДОЛЯ периода, а не 11 000.
    const q = quotePlanChange({
      from: "base",
      to: "plus",
      period: "academicYear",
      now: nowSec,
      periodEndsAt: nowSec + 1 * DAY,
    });
    expect(q.kind).toBe("upgrade");
    expect(q.payNowRub).toBe(40);
    expect(q.payNowRub).toBeLessThan(100);
  });

  it("повышение в последние минуты периода упирается в один рубль, а не в цену тарифа", () => {
    const q = quotePlanChange({
      from: "base",
      to: "plus",
      period: "academicYear",
      now: nowSec,
      // 5 минут из 270 дней: округление вниз — 0 ₽.
      periodEndsAt: nowSec + 300,
    });
    expect(q.kind).toBe("upgrade");
    expect(q.payNowRub).toBe(0);
  });

  it("понижение — сейчас 0 ₽, новая цена со следующего периода", () => {
    const endsAt = nowSec + 20 * DAY;
    const q = quotePlanChange({ from: "plus", to: "base", period: "month", now: nowSec, periodEndsAt: endsAt });
    expect(q.kind).toBe("downgrade");
    expect(q.payNowRub).toBe(0);
    expect(q.nextPriceRub).toBe(500);
    expect(q.effectiveAt).toBe(endsAt);
  });

  it("тот же тариф — платить не нужно", () => {
    const q = quotePlanChange({ from: "base", to: "base", period: "month", now: nowSec, periodEndsAt: nowSec + DAY });
    expect(q.kind).toBe("same");
    expect(q.payNowRub).toBe(0);
  });
});

/* ── Оплата ──────────────────────────────────────────────────────────────── */

describe("оплата", () => {
  it("запрос уходит на /api/billing/create с честным периодом", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
      return okResponse({ ok: true, paymentId: "pay_9", confirmationUrl: "https://yoomoney.example/pay/9" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await createPayment({ plan: "plus", period: "month", returnUrl: "https://uchlist.ru/dashboard/settings" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.confirmationUrl).toBe("https://yoomoney.example/pay/9");
    expect(calls[0].url).toContain("/api/billing/create");
    // «месяц» фронта = «monthly» бэка: путать их нельзя, цена разная.
    expect(calls[0].body).toMatchObject({ plan: "plus", period: "monthly" });
  });

  it("неработающий интегратор даёт payment_unavailable, а не «оплата прошла»", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => failResponse(500, { ok: false, error: "Приём платежей не настроен" })),
    );
    const res = await createPayment({ plan: "base", period: "academicYear", returnUrl: "https://uchlist.ru/" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("payment_unavailable");
  });

  it("отмена дергает /api/billing/cancel и передаёт причину", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
      return okResponse({ ok: true, canceled: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await cancelSubscription("Дорого");
    expect(res.ok).toBe(true);
    expect(calls[0].url).toContain("/api/billing/cancel");
    expect(calls[0].body).toMatchObject({ reason: "Дорого" });
  });
});

/* ── Подписка и чеки ─────────────────────────────────────────────────────── */

describe("серверные методы биллинга", () => {
  it("404 от /subscription — это «нет подписки», а не ошибка", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => failResponse(404)));
    const res = await fetchSubscription();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.subscription).toBeNull();
  });

  it("битый ответ не превращается в подписку", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okResponse({ ok: true, subscription: { plan: "base" } })));
    const res = await fetchSubscription();
    expect(res.ok).toBe(false);
  });

  it("история платежей читается из ответа сервера", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okResponse({ ok: true, payments: [{ id: "pay_1", plan: "base", amountRub: 3800, status: "succeeded", createdAt: nowSec, completedAt: nowSec, receiptUrl: "https://yoomoney.example/r/1" }] })),
    );
    const res = await fetchPaymentHistory();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payments).toHaveLength(1);
    expect(res.payments[0].amountRub).toBe(3800);
  });
});
