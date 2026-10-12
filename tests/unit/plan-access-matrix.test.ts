/**
 * Карточка тарифа ↔ то, что реально разрешает бэкенд.
 *
 * 12.10.2026 контрольная работа генерировалась учителю на «Базовом»
 * (`control-gen` не входит в `PLUS_ONLY_TASKS` в `backend/src/llm/router.ts`),
 * но в карточке тарифа её не было — она значилась только у «Плюса». Код и
 * описание продукта разошлись, и это ничем не ловилось: тесты проверяли цены,
 * а не права на типы материалов.
 *
 * Здесь оба конца связываются явно. Если в роутере поменяют список
 * `PLUS_ONLY_TASKS` или в карточке забудут про фичу — тест упадёт.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { PLANS, isPaidPlan, PLAN_IDS } from "@/lib/content/plans";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const ROUTER = "backend/src/llm/router.ts";
const PICKER = "src/components/constructor/ArtifactTypePicker.tsx";
const CONSTRUCTOR = "src/app/constructor/page.tsx";

/** Тела констант из исходников — читаем как есть, чтобы ловить правду, а не свою копию. */
function setBody(src: string, name: string): string {
  const at = new RegExp(`\\bconst\\s+${name}\\b`).exec(src);
  if (!at) throw new Error(`В исходнике нет const ${name}`);
  const open = src.indexOf("[", at.index);
  const close = src.indexOf("]", open);
  return src.slice(open + 1, close);
}

describe("карточка тарифа = права по коду", () => {
  const router = read(ROUTER);
  const plusOnlyTasks = [...setBody(router, "PLUS_ONLY_TASKS").matchAll(/"([^"]+)"/g)].map(
    (m) => m[1]
  );

  it("бэкенд отдаёт контрольную любому платящему — карточка это теперь обещает", () => {
    expect(plusOnlyTasks).toContain("exam-gen");
    expect(plusOnlyTasks).toContain("ktp-gen");
    expect(plusOnlyTasks).toContain("presentation-gen");
    // Ключевой инвариант задачи: контрольная НЕ только для «Плюса».
    expect(plusOnlyTasks).not.toContain("control-gen");
  });

  it("конструктор не прячет контрольную от владельцев младших тарифов", () => {
    const picker = read(PICKER);
    const line = picker
      .split("\n")
      .find((l) => l.includes('id: "control"'));
    expect(line, "в ArtifactTypePicker нет пресета control").toBeDefined();
    expect(line).not.toContain("plusOnly");
  });

  it("«Базовый» и «Оптимальный» объявляют контрольную, «Плюс» её не потерял", () => {
    const control = PLANS.base.features.find((f) => f.startsWith("Контрольная"));
    expect(control, "контрольной нет в карточке «Базового»").toBeTruthy();

    // «Оптимальный» обещает «Всё из Базового» — отдельной строки не имеет,
    // поэтому проверяем именно эту формулировку, а не слово «Контрольная».
    expect(PLANS.standard.features[0]).toBe("Всё из Базового");

    expect(PLANS.plus.features.some((f) => f.startsWith("Контрольная"))).toBe(true);
  });

  it("карточка честно предупреждает, что контрольная тяжелее листа", () => {
    // Молчание о стоимости — тоже враньё: контрольная съедает норму примерно
    // в 30 раз быстрее листа (Sonnet, 3600 выходных токенов). Оговорка живёт в
    // той же строке, что и фича, а не отдельным пунктом — иначе карточка
    // перегружается двумя строками про одно и то же.
    const controlLine = PLANS.base.features.find((f) => f.startsWith("Контрольная"));
    expect(controlLine).toMatch(/расходует тариф быстрее/);
    expect(
      PLANS.base.features.filter((f) => f.startsWith("Контрольная")).length,
      "строка про контрольную должна быть одна"
    ).toBe(1);
  });
});

describe("платный тариф", () => {
  it("«Оптимальный» — платный", () => {
    // Регрессия 12.10.2026: в конструкторе стояло `base || plus`, и подписчик
    // «Оптимального» после трёх генераций вылетал в пейволл.
    expect(isPaidPlan("standard")).toBe(true);
    expect(isPaidPlan("base")).toBe(true);
    expect(isPaidPlan("plus")).toBe(true);
    expect(isPaidPlan("school")).toBe(true);
    expect(isPaidPlan("free")).toBe(false);
    expect(isPaidPlan(null)).toBe(false);
    expect(isPaidPlan(undefined)).toBe(false);
  });

  it("конструктор берёт хелпер, а не перечисляет тарифы руками", () => {
    const src = read(CONSTRUCTOR);
    expect(src).toMatch(/isPaidPlan\(serverUsage\?\.plan\)/);
    // Список вида `plan === "base" || plan === "plus"` — источник прошлого бага.
    expect(src).not.toMatch(/plan === "base"\s*\|\|/);
  });

  it("все тарифы из PLAN_IDS известны isPaidPlan", () => {
    for (const id of PLAN_IDS) {
      expect(typeof isPaidPlan(id)).toBe("boolean");
    }
  });
});