/**
 * D3: норма 800, без «Семейного», лимиты учеников 5/10/20, порог критерия 10.
 *
 * Тест падает на старых константах (1500 / Семейный / 15) и зелёный на новых.
 */
import { describe, it, expect } from "vitest";
import { PLANS, TOKENS_PER_WORKSHEET, FREE_GENERATIONS } from "@/lib/content/plans";
import { MIN_CRITERION_LENGTH } from "@/lib/content/grading";
import { STUDENTS_PER_CLASS_BY_PLAN } from "@/lib/lk/classes-api";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = join(__dirname, "..");

describe("D3 · тариф 800 + resheniya", () => {
  it("Базовый = 800 листов, Оптимальный/Плюс — та же пропорция", () => {
    expect(TOKENS_PER_WORKSHEET).toBe(1_600);
    expect(PLANS.base.normPerMonth).toBe(800 * TOKENS_PER_WORKSHEET);
    expect(PLANS.standard.normPerMonth).toBe(2 * PLANS.base.normPerMonth!);
    expect(PLANS.plus.normPerMonth).toBe(
      Math.round((PLANS.base.normPerMonth! * 9_700_000) / 2_400_000),
    );
    expect(Math.round(PLANS.base.normPerMonth! / TOKENS_PER_WORKSHEET)).toBe(800);
    expect(Math.round(PLANS.standard.normPerMonth! / TOKENS_PER_WORKSHEET)).toBe(1_600);
    expect(Math.round(PLANS.plus.normPerMonth! / TOKENS_PER_WORKSHEET)).toBe(3_233);
  });

  it("plans.ts ↔ usage.ts по нормам", () => {
    const usage = readFileSync(join(REPO, "backend/src/services/usage.ts"), "utf8");
    expect(usage).toMatch(/base:\s*1_280_000/);
    expect(usage).toMatch(/standard:\s*2_560_000/);
    expect(usage).toMatch(/plus:\s*5_173_333/);
  });

  it("цены 249/499/999 не тронуты", () => {
    expect(PLANS.base.prices.month?.amount).toBe(249);
    expect(PLANS.standard.prices.month?.amount).toBe(499);
    expect(PLANS.plus.prices.month?.amount).toBe(999);
  });

  it("нет «Семейный доступ» в карточках тарифов", () => {
    const all = Object.values(PLANS).flatMap((p) => p.features).join("\n");
    expect(all).not.toMatch(/Семейный\s+доступ/i);
  });

  it("лимиты учеников 5/10/20 в коде, в карточке — одна строка про ЛК", () => {
    // AD-2: бэкенд-лимиты не трогаем; в features — без цифр 5/10/20.
    expect(STUDENTS_PER_CLASS_BY_PLAN.base).toBe(5);
    expect(STUDENTS_PER_CLASS_BY_PLAN.standard).toBe(10);
    expect(STUDENTS_PER_CLASS_BY_PLAN.plus).toBe(20);
    const lk = "Расширенные возможности личного кабинета";
    expect(PLANS.base.features).toContain(lk);
    expect(PLANS.standard.features).toContain(lk);
    expect(PLANS.plus.features).toContain(lk);
    expect(PLANS.base.features.join("\n")).not.toMatch(/Учеников в кабинете/i);
  });

  it("порог критерия = 10", () => {
    expect(MIN_CRITERION_LENGTH).toBe(10);
  });

  it("фото-квота Оптимального заведена и ≥ Базового", () => {
    const f06 = readFileSync(join(REPO, "backend/src/routes/f06.ts"), "utf8");
    expect(f06).toMatch(/standard:\s*200/);
    expect(f06).toMatch(/base:\s*100/);
  });

  it("free = 5/мес, CTA ведёт на вход", () => {
    expect(FREE_GENERATIONS).toBe(5);
    expect(PLANS.free.href).toBe("/login");
    expect(PLANS.free.features.join(" ")).not.toMatch(/без регистрации/i);
  });
});
