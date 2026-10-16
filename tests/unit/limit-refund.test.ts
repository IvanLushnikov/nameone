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
  it("бесплатных листов пять в месяц (ТЗ-29)", () => {
    expect(FREE_LIMIT).toBe(5);
    expect(getRemaining()).toBe(5);
    expect(canGenerate()).toBe(true);
  });
});

describe("limit — списание квоты", () => {
  it("успешная генерация списывает одну попытку", () => {
    expect(consume().count).toBe(1);
    expect(getRemaining()).toBe(FREE_LIMIT - 1);
    expect(canGenerate()).toBe(true);
  });

  it("после пяти листов квота месяца кончилась", () => {
    for (let i = 0; i < FREE_LIMIT; i++) consume();

    expect(getRemaining()).toBe(0);
    expect(canGenerate()).toBe(false);
  });
});

describe("limit — refund() возвращает попытку", () => {
  it("refund() после consume() возвращает счётчик на место", () => {
    consume();
    consume();
    expect(getRemaining()).toBe(FREE_LIMIT - 2);

    expect(refund().count).toBe(1);
    expect(getRemaining()).toBe(FREE_LIMIT - 1);
    expect(canGenerate()).toBe(true);
  });

  it("два refund() подряд без consume() не уводят счётчик в минус", () => {
    // Инвариант против старой дыры: если refund() сделает count = -1, то
    // getRemaining() вернёт 6 — учитель получит шесть листов вместо пяти.
    const first = refund();
    const second = refund();

    expect(first.count).toBe(0);
    expect(second.count).toBe(0);
    expect(getRemaining()).toBe(FREE_LIMIT);
  });

  it("refund() больше, чем списывали, тоже не даёт лишних попыток", () => {
    consume();
    refund();
    refund();
    refund();

    expect(getRemaining()).toBe(FREE_LIMIT);
  });
});

// ТЗ-29: суток больше нет, но МЕСЯЦ есть. Ниже — важная оговорка: локальный
// счётчик в браузере сам не обнуляется никогда, месяц считает сервер
// (free_usage), а клиент приводится к нему через syncFromServer.
describe("limit — СУТОК БОЛЬШЕ НЕТ, МЕСЯЦ СЧИТАЕТ СЕРВЕР", () => {
  it("через сутки счётчик НЕ обнуляется — месяц считает сервер", () => {
    for (let i = 0; i < FREE_LIMIT; i++) consume();
    expect(canGenerate()).toBe(false);

    // Ровно следующая полночь + 12 часов: раньше здесь счётчик обнулялся.
    vi.setSystemTime(START + DAY_MS + 12 * 60 * 60 * 1000);

    expect(getRemaining()).toBe(0);
    expect(canGenerate()).toBe(false);
  });

  it("через месяц счётчик сам не обнуляется — но сервер пришлёт ноль", () => {
    for (let i = 0; i < FREE_LIMIT; i++) consume();

    vi.setSystemTime(START + 31 * DAY_MS);
    expect(getRemaining()).toBe(0);

    // 1-го числа месяца сервер отдаёт used = 0, и карточка/конструктор
    // показывают полную квоту. Обнуления «по часам в браузере» по-прежнему нет.
    syncFromServer(0);
    expect(getRemaining()).toBe(FREE_LIMIT);
  });

  it("в пределах суток счётчик не растёт", () => {
    consume();
    vi.setSystemTime(START + 60 * 60 * 1000);
    expect(getRemaining()).toBe(FREE_LIMIT - 1);
  });
});

describe("limit — сверка с сервером", () => {
  it("syncFromServer ставит счётчик к серверному", () => {
    consume();
    consume();
    expect(getRemaining()).toBe(FREE_LIMIT - 2);

    // Бэк знает, что израсходовано больше (например, генерация была в другой
    // вкладке) — источник правды сервер.
    syncFromServer(FREE_LIMIT);
    expect(getRemaining()).toBe(0);
  });

  it("локальный счёт ВЫШЕ серверного — обнуляется, а не берётся max", () => {
    // Так учитель, почистивший localStorage, не получит новую квоту:
    // источник правды — сервер.
    for (let i = 0; i < FREE_LIMIT; i++) consume();
    expect(getRemaining()).toBe(0);

    syncFromServer(0);
    expect(getRemaining()).toBe(FREE_LIMIT);
  });

  it("мусор в localStorage не ломает счётчик", () => {
    window.localStorage.setItem("uchlist_gens_v1", "{не json");
    expect(getRemaining()).toBe(FREE_LIMIT);
  });

  it("отрицательное значение из хранилища не даёт лишних попыток", () => {
    window.localStorage.setItem("uchlist_gens_v1", JSON.stringify({ count: -5 }));
    expect(getRemaining()).toBe(FREE_LIMIT);
  });

  it("reset() (после оплаты) обнуляет счётчик", () => {
    consume();
    consume();
    reset();
    expect(getRemaining()).toBe(FREE_LIMIT);
  });
});
