/**
 * Потолок тарифа по фактической себестоимости (аудит 18.10.2026, раздел 9).
 *
 * Проверка, которая держит числа честными: если себестоимость изменится
 * (новый прайс провайдера, другая модель), тест упадёт и заставит
 * пересчитать обещание тарифа.
 */

import { describe, it, expect } from "vitest";
import {
  COST_PER_WORKSHEET_RUB,
  COST_PER_WORKSHEET_VERIFIED_RUB,
  COST_PER_CONTROL_RUB,
  TARGET_MARGIN,
  basePlanCeiling,
  sustainableMaterialsPerMonth,
} from "../../src/services/pricing-cost";

describe("потолок тарифа по фактической себестоимости", () => {
  it("себестоимость листа — измерена, а не выведена из прайса", () => {
    // Замер: 19 вызовов worksheet-gen, среднее 0,18 ₽ (llm_costs_actual).
    expect(COST_PER_WORKSHEET_RUB).toBe(0.18);
    expect(COST_PER_WORKSHEET_VERIFIED_RUB).toBeCloseTo(0.21, 5);
    // Замер: 5 вызовов control-gen, среднее 9,77 ₽.
    expect(COST_PER_CONTROL_RUB).toBe(9.77);
  });

  it("«Базовый» за 249 ₽ держит потолок в сотнях листов, а не в полутора тысячах", () => {
    const { materials, costPerMaterialRub } = basePlanCeiling({ priceRub: 249 });
    // 249 × 0,3 = 74,7 ₽ доступного расхода; 74,7 / 0,18 = 415.
    expect(materials).toBe(415);
    expect(costPerMaterialRub).toBeCloseTo(0.18, 5);
  });

  it("с проверкой ответов потолок ниже", () => {
    const { materials } = basePlanCeiling({ priceRub: 249, withVerification: true });
    // 74,7 / 0,21 = 355.
    expect(materials).toBe(355);
  });

  it("контрольная в месяце съедает потолок сильнее всего", () => {
    const { materials, costPerMaterialRub } = basePlanCeiling({
      priceRub: 249,
      withControl: true,
    });
    // Микс: 20 листов по 0,18 + контрольная 9,77 → 13,37 ₽ на 21 материал.
    expect(costPerMaterialRub).toBeCloseTo(13.37 / 21, 5);
    expect(materials).toBeLessThan(150);
  });

  it("обещанные тарифом 1500 листов не влезают в выручку", () => {
    // Главный вывод аудита: потолок по тарифу в 3,6 раза выше потолка по
    // фактической себестоимости. Пока это так, обещание «до 1500 листов»
    // не подтверждается деньгами.
    const promised = 1500;
    const affordable = basePlanCeiling({ priceRub: 249 }).materials;
    expect(promised).toBeGreaterThan(affordable * 3);
    // Себестоимость обещанного объёма больше цены тарифа.
    const costOfPromised = promised * COST_PER_WORKSHEET_RUB;
    expect(costOfPromised).toBeGreaterThan(249);
  });

  it("целевая маржа — та же, что в планах", () => {
    expect(TARGET_MARGIN).toBe(0.7);
  });

  it("нулевая себестоимость не делит на ноль", () => {
    expect(sustainableMaterialsPerMonth({ priceRub: 249, costPerMaterialRub: 0 })).toBe(0);
  });
});
