/**
 * ТЗ-24, лист-1: фронтовый трекер шлёт событие на бэкенд в ПРОДЕ.
 *
 * Прежняя проверяемая строка была `process.env.NODE_ENV !== "production"` — то
 * есть на боевом сайте не отправлялось ничего. Тест специально переключает
 * NODE_ENV на production: если отправки нет — это ровно та регрессия, ради
 * которой писался.
 *
 * Второе, что здесь проверяется: ошибка сети НЕ выходит наружу. Трекер не имеет
 * права ломать интерфейс учителя — это правило из шапки src/lib/track.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const API = "https://api.test.local";

/** Заглушка fetch: собирает вызовы и умеет «упасть», как упал бы реальный. */
function stubFetch(options: { fail?: boolean } = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (options.fail) throw new TypeError("network down");
    return new Response(null, { status: 204 });
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

async function loadTrackerInProduction() {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_API_URL", API);
  vi.stubEnv("NODE_ENV", "production");
  return await import("../src/lib/track");
}

beforeEach(() => {
  vi.stubGlobal("navigator", { sendBeacon: undefined });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("трекер в проде", () => {
  it("шлёт событие на бэкенд, а не молчит в консоль", async () => {
    const calls = stubFetch();
    const { trackEvent } = await loadTrackerInProduction();

    trackEvent("constructor_view", { mode: "list" });

    expect(calls.length).toBe(1);
    expect(calls[0]!.url).toBe(`${API}/api/track`);
    expect(calls[0]!.init.method).toBe("POST");

    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.name).toBe("constructor_view");
    expect(body.data.mode).toBe("list");
  });

  it("помечает запрос keepalive — событие должно пережить уход со страницы", async () => {
    const calls = stubFetch();
    const { trackEvent } = await loadTrackerInProduction();

    trackEvent("constructor_generate_click", { mode: "list", subject: "math" });

    expect(calls[0]!.init.keepalive).toBe(true);
  });

  it("trackPageView пишет так же, как обычное событие", async () => {
    const calls = stubFetch();
    const { trackPageView } = await loadTrackerInProduction();

    trackPageView("dashboard_view", { subsection: "history" });

    expect(calls.length).toBe(1);
    expect(JSON.parse(String(calls[0]!.init.body)).name).toBe("dashboard_view");
  });
});

describe("трекер не ломает интерфейс", () => {
  it("упавшая сеть не выходит наружу — вызов не бросает", async () => {
    stubFetch({ fail: true });
    const { trackEvent } = await loadTrackerInProduction();

    expect(() => trackEvent("login_submit", { emailDomain: "icloud.com" })).not.toThrow();
  });

  it("без адреса бэкенда (стенд) трекер молчит и не падает", async () => {
    const calls = stubFetch();
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_API_URL", "");
    vi.stubEnv("NODE_ENV", "production");
    const { trackEvent } = await import("../src/lib/track");

    expect(() => trackEvent("login_view")).not.toThrow();
    expect(calls.length).toBe(0);
  });
});

describe("итог листа-1 (фронт)", () => {
  it("TRACK_SENDS_IN_PRODUCTION — событие уходит на бэкенд в прод-режиме", async () => {
    const calls = stubFetch();
    const { trackEvent } = await loadTrackerInProduction();

    trackEvent("paywall_plan_click", { plan: "plus" });

    // Положительный контроль: ровно один запрос на событие.
    expect(calls.length).toBe(1);
    expect(calls[0]!.url).toBe(`${API}/api/track`);
    console.log("TRACK_SENDS_IN_PRODUCTION");
  });
});