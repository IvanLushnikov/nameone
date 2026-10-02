/**
 * Лимит бесплатных генераций и возврат попытки — `src/lib/utils/limit.ts`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ИЗМЕНИЛОСЬ 2026-10-02 (и почему этот файл переписан)
 * ─────────────────────────────────────────────────────────────────────────────
 * Квота бесплатного тарифа больше НЕ сбрасывается по суткам. Раньше счётчик жил
 * в localStorage и хранил `resetAt` = ближайшая полночь. Это давало три плохие
 * вещи, каждую из которых можно было проверить:
 *
 *   1) Смена системных часов в браузере обнуляла счётчик — «бесплатно» значило
 *      «бесплатно, пока не перевёл время»;
 *   2) в бэке стояли другие числа (3 для анонимных, 10 для free), то есть
 *      обещание и реальный потолок различались;
 *   3) очистка localStorage давала новые 3 генерации без всякой регистрации.
 *
 * Теперь счёт ведёт сервер (`backend/src/services/usage.ts`), квота — 3
 * генерации НА ВЕСЬ ПЕРИОД, а клиентский счётчик — только оптимистичный
 * прогноз для мгновенного отклика UI. Поэтому:
 *   * `getResetAt()` удалён — сброса не существует, и «время сброса» вводило бы
 *     в заблуждение;
 *   * вместо него `syncFromServer()` — приводит счётчик к тому, что сказал бэк.
 *
 * Тест ниже намеренно проверяет, что суток больше нет: если кто-то вернёт
 * ночной сброс (он же обход лимита), тест упадёт.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  FREE_LIMIT,
  canGenerate,
  consume,
  getRemaining,
  refund,
  reset,
  syncFromServer,
} from "@/lib/utils/limit";

const DAY_MS = 24 * 60 * 60 * 1000;

/** 1 октября 2026, 10:00 по местному времени. */
const START = new Date(2026, 9, 1, 10, 0, 0).getTime();

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("limit — размер квоты", () => {
  it("бесплатных генераций всего три", () => {
    expect(FREE_LIMIT).toBe(3);
    expect(getRemaining()).toBe(3);
    expect(canGenerate()).toBe(true);
  });
});

describe("limit — списание квоты", () => {
  it("успешная генерация списывает одну попытку", () => {
    expect(consume().count).toBe(1);
    expect(getRemaining()).toBe(2);
    expect(canGenerate()).toBe(true);
  });

  it("после трёх генераций квота кончилась", () => {
    consume();
    consume();
    consume();

    expect(getRemaining()).toBe(0);
    expect(canGenerate()).toBe(false);
  });
});

describe("limit — refund() возвращает попытку", () => {
  it("refund() после consume() возвращает счётчик на место", () => {
    consume();
    consume();
    expect(getRemaining()).toBe(1);

    expect(refund().count).toBe(1);
    expect(getRemaining()).toBe(2);
    expect(canGenerate()).toBe(true);
  });

  it("два refund() подряд без consume() не уводят счётчик в минус", () => {
    // Инвариант против старой дыры: если refund() сделает count = -1, то
    // getRemaining() вернёт 4 — учитель получит четыре генерации вместо трёх.
    const first = refund();
    const second = refund();

    expect(first.count).toBe(0);
    expect(second.count).toBe(0);
    expect(getRemaining()).toBe(3);
  });

  it("refund() больше, чем списывали, тоже не даёт лишних попыток", () => {
    consume();
    refund();
    refund();
    refund();

    expect(getRemaining()).toBe(FREE_LIMIT);
  });
});

describe("limit — СУТОК БОЛЬШЕ НЕТ", () => {
  it("через сутки счётчик НЕ обнуляется — квота на весь период", () => {
    consume();
    consume();
    consume();
    expect(canGenerate()).toBe(false);

    // Ровно следующая полночь + 12 часов: раньше здесь счётчик обнулялся.
    vi.setSystemTime(START + DAY_MS + 12 * 60 * 60 * 1000);

    expect(getRemaining()).toBe(0);
    expect(canGenerate()).toBe(false);
  });

  it("через месяц — тоже не обнуляется", () => {
    consume();
    consume();
    consume();

    vi.setSystemTime(START + 31 * DAY_MS);

    expect(getRemaining()).toBe(0);
  });

  it("в пределах суток счётчик не растёт", () => {
    consume();
    vi.setSystemTime(START + 60 * 60 * 1000);
    expect(getRemaining()).toBe(2);
  });
});

describe("limit — сверка с сервером", () => {
  it("syncFromServer ставит счётчик к серверному", () => {
    consume();
    consume();
    expect(getRemaining()).toBe(1);

    // Бэк знает, что израсходовано 3 (например, генерация была в другой вкладке).
    syncFromServer(3);
    expect(getRemaining()).toBe(0);
  });

  it("локальный счёт ВЫШЕ серверного — обнуляется, а не берётся max", () => {
    // Так учитель, почистивший localStorage, не получит новую квоту:
    // источник правды — сервер.
    consume();
    consume();
    consume();
    expect(getRemaining()).toBe(0);

    syncFromServer(0);
    expect(getRemaining()).toBe(FREE_LIMIT);
  });

  it("мусор в localStorage не ломает счётчик", () => {
    window.localStorage.setItem("rabochielisty_gens_v1", "{не json");
    expect(getRemaining()).toBe(FREE_LIMIT);
  });

  it("отрицательное значение из хранилища не даёт лишних попыток", () => {
    window.localStorage.setItem("rabochielisty_gens_v1", JSON.stringify({ count: -5 }));
    expect(getRemaining()).toBe(FREE_LIMIT);
  });

  it("reset() (после оплаты) обнуляет счётчик", () => {
    consume();
    consume();
    reset();
    expect(getRemaining()).toBe(FREE_LIMIT);
  });
});
