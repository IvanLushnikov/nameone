/**
 * ТЗ-32 часть 5 — llms-файлы не расходятся с живым числом бесплатных генераций.
 *
 * Число берётся из бэкенда (`FREE_TOTAL_GENERATIONS` в usage.ts) — того же
 * места, откуда его читает `scripts/check-llms-txt.mjs`. Если квота поменяется,
 * тест упадёт, и текст придётся привести к новому числу в том же коммите.
 *
 * Дополнительно проверяем слова «в месяц» и «1-го числа»: без них «5 листов»
 * читается как «5 листов один раз», то есть почти как прежнее «навсегда».
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** Живое число из бэкенда — единственный источник правды. */
function liveFreeQuota(): number {
  const usage = src("backend/src/services/usage.ts");
  const m = usage.match(/FREE_TOTAL_GENERATIONS\s*=\s*(\d+)/);
  if (!m) throw new Error("в usage.ts нет FREE_TOTAL_GENERATIONS");
  return Number(m[1]);
}

const LLMS = src("public/llms.txt");
const FULL = src("public/llms-full.txt");
const QUOTA = liveFreeQuota();

describe("ТЗ-32 часть 5: llms.txt совпадает с живой квотой", () => {
  it("бесплатный порог назван тем же числом, что в usage.ts", () => {
    expect(QUOTA).toBeGreaterThan(0);
    expect(LLMS).toMatch(new RegExp(`${QUOTA}\\s+(лист|генерац)`));
  });

  it("нет устаревшего «3 генерации» и «трёх попыток»", () => {
    expect(LLMS).not.toMatch(/3 бесплатн|3 генераци|трёх бесплатных|на всё время/);
  });

  it("квота описана как помесячная, с обнулением", () => {
    expect(LLMS).toMatch(/в месяц/);
    expect(LLMS).toMatch(/1-го числа/);
    expect(LLMS).not.toMatch(/квота не пополняется|не восстанавливается/i);
  });
});

describe("ТЗ-32 часть 5: llms-full.txt совпадает с живой квотой", () => {
  it("в таблице тарифов стоит живое число листов", () => {
    expect(FULL).toMatch(new RegExp(`${QUOTA}\\s+рабочих лист`));
    expect(FULL).toMatch(/1-го числа/);
    expect(FULL).not.toMatch(/3 генераци|не восстанавливаются|квота не пополняется/i);
  });

  it("D3: у каждого лимита листов есть «в месяц»", () => {
    const rows = FULL.split("\n").filter((l) => /^\|/.test(l) && /рабочих лист/.test(l));
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const row of rows) expect(row).toMatch(/в месяц/);
  });

  it("D1: закрытые форматы в llms-full.txt отнесены к тарифу «Плюс»", () => {
    // Список «что умеет сервис» и раздел по тарифам — оба места, где раньше
    // форматы стояли рядом с бесплатными без указания тарифа.
    expect(FULL).toMatch(/Планы уроков, презентации, КТП[\s\S]{0,80}«Плюс»/);
    const base = FULL.split("**Базовый:**")[1]?.split("**Оптимальный:**")[0] ?? "";
    expect(base.toLowerCase()).not.toMatch(/планы уроков|презентаци|ктп/);
  });

  it("время генерации одно — 30 секунд, сверка — 1–3 минуты", () => {
    const norm = FULL.replace(/\s+/g, " ");
    for (const t of norm.match(/\d+[-–]?\d*\s*(?:секунд|минут\w*)/g) ?? []) {
      if (/минут/.test(t)) expect(t).toMatch(/1[-–]3/);
      else expect(t).toMatch(/30/);
    }
  });
});