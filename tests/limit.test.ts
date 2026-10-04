import { describe, it, expect, beforeEach } from "vitest";
import {
  getRemaining,
  settleGeneration,
  refund,
  FREE_LIMIT,
  LIMIT_STORAGE_KEY,
} from "@/lib/utils/limit";

/**
 * Правило продукта: генерация списывает бесплатную попытку ВСЕГДА,
 * включая демо-заготовку при недоступном сервисе
 * (решение владельца 2026-10-03, docs/tz/18-money-and-trust.md §7).
 *
 * Тест нужен потому, что это правило раньше жило по одному разу в каждом
 * экране и разошлось: конструктор списывал всегда, /oge — только за настоящий
 * вариант. Демо — не особенность раздела, а поведение продукта, поэтому
 * проверять надо само правило, а не поведение конкретной страницы.
 */

// Ключ берём у модуля, а не дублируем строкой: копия разъехалась с кодом при
// переименовании «РабочиеЛисты → УчЛист», и тест падал, указывая в пустоту.
const KEY = LIMIT_STORAGE_KEY;

beforeEach(() => {
  localStorage.clear();
});

describe("списание бесплатных генераций", () => {
  it("настоящая генерация стоит попытки", () => {
    const before = getRemaining();
    settleGeneration({ isDemo: false });
    expect(getRemaining()).toBe(before - 1);
  });

  it("демо-заготовка тоже стоит попытки", () => {
    const before = getRemaining();
    settleGeneration({ isDemo: true });
    expect(getRemaining()).toBe(before - 1);
  });

  it("вызов без аргумента тоже списывает (экраны не решают за правило)", () => {
    const before = getRemaining();
    settleGeneration();
    expect(getRemaining()).toBe(before - 1);
  });

  it("остаток не уходит в минус при перерасходе", () => {
    for (let i = 0; i < FREE_LIMIT + 3; i++) settleGeneration({ isDemo: true });
    expect(getRemaining()).toBe(0);
    // Возврат одной попытки не «выдаёт» лишнего: счётчик всё ещё выше нормы,
    // поэтому остаток остаётся нулём. Проверяем именно это поведение.
    refund();
    expect(getRemaining()).toBe(0);
  });

  it("refund возвращает попытку при нормальном расходе", () => {
    const before = getRemaining();
    settleGeneration({ isDemo: true });
    expect(getRemaining()).toBe(before - 1);
    refund();
    expect(getRemaining()).toBe(before);
  });

  it("попытка лежит в том же ключе, что читает canGenerate", () => {
    settleGeneration({ isDemo: true });
    const raw = localStorage.getItem(KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string).count).toBe(1);
  });
});
