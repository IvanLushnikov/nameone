/**
 * ТЗ-29: бесплатный тариф — 5 листов В МЕСЯЦ.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ЗАЩИЩАЕМ
 * ─────────────────────────────────────────────────────────────────────────────
 * Раньше тариф обещал 3 генерации навсегда, и это было главной претензией:
 * попробовал, ушёл, вернулся — а квоты уже нет. Теперь обещание состоит из
 * трёх частей, и тест требует все три:
 *   1) сколько именно — «5 листов в месяц»;
 *   2) когда обновится — «1-го числа» (иначе «в месяц» читается как «один раз»);
 *   3) что НЕ тратит квоту — проверка по фото и разбор ответов.
 *
 * Плюс проверка формулировок карточки расхода: ни «исчерпано», ни
 * «заблокировано» (правило из шапки UsageCard.tsx), и одна кнопка «Пополнить».
 *
 * Проверки текста берутся из исходника и из отрендеренной карточки, а не из
 * «на глаз»: правка копирайта без правки обещания — это и есть та ошибка,
 * которую ловим.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

import {
  FREE_GENERATIONS,
  FREE_QUOTA_LABEL,
  FREE_QUOTA_RESET_NOTE,
  FREE_QUOTA_SPARE_FEATURE,
  PLANS,
} from "@/lib/content/plans";
import { UsageCard, type UsagePayload } from "@/components/shared/UsageCard";

/** Исходник компонента — для проверок, которые не видны в разметке. */
function userText(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

/**
 * Исходник БЕЗ комментариев.
 *
 * Нужна для проверок запрещённых слов: в шапке UsageCard.tsx эти слова стоят
 * как раз в комментарии («нигде нет формулировций "лимит исчерпан"»), и поиск
 * по сырому файлу ловил бы правило, а не нарушение.
 */
function codeOnly(rel: string): string {
  return userText(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Ответ /api/users/usage для бесплатного тарифа (ТЗ-29). */
function usagePayload(over: Partial<UsagePayload> = {}): UsagePayload {
  return {
    plan: "free",
    norm: null,
    weightedTokensUsed: 0,
    over: false,
    remaining: null,
    periodEndsAt: null,
    worksheetsEquivalent: 0,
    freeRemaining: FREE_GENERATIONS,
    freeUsed: 0,
    freeResetsAt: "2026-11-01T00:00:00.000Z",
    requiresChallenge: false,
    generationsToday: 0,
    generationsLimit: FREE_GENERATIONS,
    ...over,
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("ТЗ-29: обещание бесплатного тарифа", () => {
  it("квота — пять листов в месяц", () => {
    expect(FREE_GENERATIONS).toBe(5);
    expect(FREE_QUOTA_LABEL).toBe("5 листов в месяц");
  });

  it("карточка тарифа говорит про месяц И про дату обновления", () => {
    const text = [PLANS.free.description, PLANS.free.shortDescription, ...PLANS.free.features]
      .join(" ");
    expect(text).toContain("5 листов в месяц");
    expect(text).toContain("Обновляется 1-го числа");
    // Единой константы достаточно: подписи на лендинге и в тарифе собираются
    // из FREE_QUOTA_RESET_NOTE, а не пишутся отдельно.
    expect(FREE_QUOTA_RESET_NOTE).toBe("Обновляется 1-го числа");
  });

  // Решение владельца от 16.10.2026: проверка по фото тратит квоту, значит
  // обещать «без ограничений» нельзя — это вводит учителя в заблуждение и
  // ровно ту ложь, которую поймала приёмка.
  it("карточка тарифа честно говорит, что проверка по фото тратит квоту", () => {
    expect(PLANS.free.features).toContain(FREE_QUOTA_SPARE_FEATURE);
    expect(FREE_QUOTA_SPARE_FEATURE).toMatch(/Проверка по фото/);
    expect(FREE_QUOTA_SPARE_FEATURE).toMatch(/из той же квоты/i);
    expect(FREE_QUOTA_SPARE_FEATURE).not.toMatch(/без ограничений/i);
  });

  it("слово «навсегда» не вернулось ни в одном тексте тарифа", () => {
    const labels = [PLANS.free, PLANS.base, PLANS.standard, PLANS.plus]
      .flatMap((p) => [
        p.description,
        p.shortDescription,
        ...p.features,
        p.prices.month.unit,
        p.prices.academicYear?.unit ?? "",
      ])
      .join(" ");
    expect(labels).not.toMatch(/навсегда/i);
    expect(labels).not.toMatch(/на пробу/i);
    expect(labels).not.toMatch(/на всё время/i);
  });
});

describe("ТЗ-29: карточка расхода в кабинете", () => {
  it("показывает «сделано 3 из 5» и дату обновления", () => {
    render(React.createElement(UsageCard, {
      usage: usagePayload({ freeRemaining: 2, freeUsed: 3 }),
    }));
    expect(screen.getByText("Листы в этом месяце")).toBeTruthy();
    expect(screen.getByText("сделано 3 из 5")).toBeTruthy();
    expect(screen.getByText(/обновятся 1 ноября/i)).toBeTruthy();
  });

  it("когда листы закончились — одна кнопка «Пополнить» и никаких «исчерпано»", () => {
    render(React.createElement(UsageCard, {
      usage: usagePayload({ freeRemaining: 0, freeUsed: FREE_GENERATIONS }),
    }));
    expect(screen.getByText("Листы закончились")).toBeTruthy();
    const button = screen.getByRole("button", { name: /пополнить/i });
    expect(button).toBeTruthy();
    // Ровно одна кнопка: «посмотреть тарифы» и «пополнить» — это два разных
    // обещания, и учителю нужно одно действие.
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByText(/снова 5/i)).toBeTruthy();
    // Второе обещание остаётся видимым и после исчерпания квоты.
    expect(screen.getByText(/Проверка по фото тетради/i)).toBeTruthy();
  });

  it("в исходнике карточки нет слов про исчерпание и блокировку", () => {
    const src = codeOnly("src/components/shared/UsageCard.tsx");
    expect(src).not.toMatch(/Исчерпано/);
    expect(src).not.toMatch(/заблокирован/i);
  });
});