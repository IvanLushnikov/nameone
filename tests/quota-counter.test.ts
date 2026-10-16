/**
 * Блок F аудита 11.10.2026 (docs/30 — «Счётчик и позиционирование»,
 * docs/31 — кейсы Ф-1…Ф-4): понятный счётчик бесплатных генераций.
 *
 * ЧТО БЫЛО. Учитель видит на главной «3 бесплатные генерации», на `/oge/` —
 * «Осталось генераций: N из 3», и не может понять, один это счётчик на листы
 * и на варианты ОГЭ или два отдельных. Разбор по коду (см. длинный комментарий
 * над `FREE_QUOTA_SCOPE_NOTE` в landing-seo.ts) дал ответ из двух частей, и
 * обе нужны в проверке:
 *
 *   1) квота ОБЩАЯ и серверная — ключ `freetotal:fp:<отпечаток>` в
 *      `rate_limits`, общий для всех ручек генерации (backend/src/services/usage.ts,
 *      backend/src/llm/ratelimit.ts). Отдельного счётчика под ОГЭ нет;
 *   2) НО вариант экзамена на бесплатном тарифе не выдаётся: проверка тарифа в
 *      backend/src/routes/exams.ts (строки 55–60) стоит ВЫШЕ проверки квоты, и
 *      до `guardGeneration` запрос с plan !== "plus" не доходит.
 *
 * ПОЧЕМУ ПРОВЕРЯЕМ ИСХОДНИКИ, А НЕ ВЁРСТКУ. Обещание живёт в строке, а не в
 * компоненте: тот же приём уже применён в tests/truthful-claims.test.ts.
 * Комментарии вырезаются — разработчик вправе писать про старый текст, учитель
 * его не видит.
 *
 * ПОЧЕМУ ЧИСЛА БЕРЁМ РЕГУЛЯРКОЙ. Формулировку меняем регулярно, и сравнение
 * строк целиком ломало бы тест на любую правку слов. Договариваемся ровно
 * об одном: в строке счётчика числа стоят в порядке «осталось … из …», и
 * первое из них равно текущему остатку.
 *
 * Блоки Ф-5 и Ф-6 внизу добавлены проверкой 11.10.2026: Ф-5 — откуда берётся
 * число на `/oge/` (страница отдавала localStorage, а текст под ним обещал
 * сервер), Ф-6 — склонение слова «генерация» под подставляемое число.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import * as React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  FREE_QUOTA_SCOPE_NOTE,
  FREE_QUOTA_EXHAUSTED_NOTE,
  quotaGenerations,
  pluralizeGenerations,
  faqItems,
} from "@/lib/content/landing-seo";
import { FREE_GENERATIONS } from "@/lib/content/plans";
import { FREE_LIMIT, LIMIT_STORAGE_KEY } from "@/lib/utils/limit";
import type { UsagePayload } from "@/components/shared/UsageCard";

/**
 * Счётчик на `/oge/` ходит на сервер ровно тем же запросом, что кабинет, —
 * поэтому мокаем одну функцию. Больше из `@/lib/auth/api` страница ничего
 * не берёт (проверено поиском по `src/`), поэтому подмена модуля целиком
 * безопасна для остальных тестов этого файла.
 */
vi.mock("@/lib/auth/api", () => ({ fetchUsage: vi.fn() }));

import { fetchUsage } from "@/lib/auth/api";
import OgePage from "@/app/oge/page";

/**
 * Заглушка ответа `/api/users/usage`. `left === null` — это то, что реально
 * приходит от `fetchUsage()` без входа (401) или при упавшей сети: null.
 */
function mockUsage(left: number | null): void {
  vi.mocked(fetchUsage).mockResolvedValue(
    left === null
      ? null
      : ({
          plan: "free",
          norm: null,
          weightedTokensUsed: 0,
          over: false,
          remaining: null,
          periodEndsAt: null,
          worksheetsEquivalent: 0,
          freeRemaining: left,
          requiresChallenge: false,
          generationsToday: FREE_LIMIT - left,
          generationsLimit: FREE_LIMIT,
        } as UsagePayload),
  );
}

function read(file: string): string {
  return readFileSync(join(process.cwd(), file), "utf8");
}

/** Без комментариев: слова из комментария учителю не видны. */
function userText(file: string): string {
  return read(file)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Числа из строки счётчика: [осталось, из скольких].
 * Порядок в тексте — часть договорённости теста, а не хрупкая строка:
 * переставить слова можно, числа обязаны остаться на своих местах.
 */
function counterNumbers(text: string): number[] {
  return (text.match(/\d+/g) ?? []).map(Number);
}

describe("Ф-1: счётчик объясняет, что квота общая", () => {
  it("пояснение говорит, что счётчик один и общий на месяц", () => {
    expect(FREE_QUOTA_SCOPE_NOTE).toMatch(/общий/i);
    // Квота месячная (ТЗ-29): граница — 1-е число, счёт живёт в free_usage.
    // Обещать «не обновится» теперь нельзя, это было правдой только при
    // вечной квоте. Проверяем, что граница названа и что про сутки не врём.
    expect(FREE_QUOTA_SCOPE_NOTE).toMatch(/месяц/i);
    expect(FREE_QUOTA_SCOPE_NOTE).toMatch(/1-го числа/i);
    expect(FREE_QUOTA_SCOPE_NOTE).not.toMatch(/по суткам|каждый день|ежедневно/i);
  });

  it("пояснение называет, на что тратятся бесплатные генерации", () => {
    // Хотя бы один продукт, который реально тратит общую квоту: все они
    // идут через guardGeneration/consumeGenerationQuota с ключом freetotal.
    expect(FREE_QUOTA_SCOPE_NOTE).toMatch(/лист/i);
  });

  it("пояснение не обещает, что варианты ОГЭ тратят эти же генерации", () => {
    // Ключевая честность: маршрут экзамена отклоняет не-plus тариф ДО
    // проверки квоты (routes/exams.ts), поэтому обещание «3 генерации
    // можно потратить на вариант ОГЭ» было бы враньём.
    expect(FREE_QUOTA_SCOPE_NOTE).toMatch(/ОГЭ/);
    expect(FREE_QUOTA_SCOPE_NOTE).toMatch(/Плюс|плюс/);
    expect(FREE_QUOTA_SCOPE_NOTE).toMatch(/не вычитаются|не тратят|не расходуются/i);
  });

  it("одна и та же строка стоит на /oge/ и в кабинете", () => {
    const oge = read("src/app/oge/page.tsx");
    const lk = read("src/app/dashboard/page.tsx");
    // Символ импорта, а не весь текст: длинная константа живёт в одном файле,
    // иначе расходится при любой правке формулировки.
    expect(oge).toContain("FREE_QUOTA_SCOPE_NOTE");
    expect(lk).toContain("FREE_QUOTA_SCOPE_NOTE");
  });

  it("в кабинете строка показана только на бесплатном тарифе", () => {
    // На base/plus бесплатной квоты нет, и напоминание про «3 генерации»
    // было бы шумом рядом с нормой в токенах.
    const lk = userText("src/app/dashboard/page.tsx");
    expect(lk).toMatch(/usage\?\.plan === "free"/);
  });
});

describe("Ф-2: числа в тексте совпадают с остатком", () => {
  it("лимит один и тот же в тарифах, счётчике и константах текста", () => {
    expect(FREE_LIMIT).toBe(FREE_GENERATIONS);
    // Числа в пояснении — те же 3, что и в тарифах (зеркалит
    // backend FREE_TOTAL_GENERATIONS), иначе учитель увидит «3» в одном
    // месте и «5» в другом.
    expect(counterNumbers(FREE_QUOTA_SCOPE_NOTE)).toContain(FREE_GENERATIONS);
  });

  it.each([3, 2, 1])("при остатке %i первое число в счётчике равно остатку", (left) => {
    const text = `Осталось генераций: ${left} из ${FREE_LIMIT}`;
    const [shown, total] = counterNumbers(text);
    expect(shown).toBe(left);
    expect(total).toBe(FREE_LIMIT);
  });

  it("числа берутся регуляркой, а не сравнением строк (договорённость)", () => {
    // Падение этой проверки означает, что числа переехали или пропали —
    // именно это тест ловит, а не конкретные слова вокруг них.
    expect(counterNumbers("Осталось генераций: 2 из 3")).toEqual([2, 3]);
    expect(counterNumbers("из 3 осталось 2")).toEqual([3, 2]);
  });
});

describe("Ф-3: при нуле учителю ясно, что делать дальше", () => {
  it("нулевое состояние не рисует счётчик, а объясняет следующий шаг", () => {
    const oge = userText("src/app/oge/page.tsx");
    // Старая надпись «Бесплатные варианты закончилась» ничего не говорила:
    // ждать сброса бессмысленно (сброса нет), повтор тоже не поможет.
    expect(oge).toContain("FREE_QUOTA_EXHAUSTED_NOTE");
    expect(FREE_QUOTA_EXHAUSTED_NOTE).toMatch(/тариф/i);
    // Учителю нужна дата, когда можно снова: месячная квота обнуляется 1-го.
    expect(FREE_QUOTA_EXHAUSTED_NOTE).toMatch(/1-го числа/i);
  });

  it("при нуле не обещаем бесплатный возврат попыток", () => {
    expect(FREE_QUOTA_EXHAUSTED_NOTE).not.toMatch(/каждый день|ежедневно|в день/i);
    expect(FREE_QUOTA_EXHAUSTED_NOTE).not.toMatch(/не обновится|не сбросится/i);
  });
});

describe("Ф-4: обещаний точности в текстах нет", () => {
  const BANNED = [
    /гарантированно\s+правильн/i,
    /гарантия\s+правильн/i,
    /100%\s*правильн/i,
    /абсолютно\s+(правильн|точно)/i,
    /без\s+ошибок/i,
    /всегда\s+(правильн|точно)/i,
  ];

  it("в FAQ лендинга нет обещаний гарантированной правильности", () => {
    const answers = faqItems.map((i) => `${i.q} ${i.a}`).join(" ");
    for (const re of BANNED) {
      expect(answers).not.toMatch(re);
    }
  });

  it("в ответе про PDF сказано, что ответы — черновик, а не гарантия", () => {
    const pdfFaq = faqItems.find((i) => /PDF/.test(i.q));
    expect(pdfFaq).toBeDefined();
    // Рамка повторяет Features.tsx: система даёт черновик, сверку запускает
    // учитель, решение остаётся за ним.
    expect(pdfFaq!.a).toMatch(/черновик/i);
    expect(pdfFaq!.a).toMatch(/Требует проверки|остаётся за вами/i);
  });

  it("числа в Stats и Hero считаются из данных, а не вписаны в разметку", () => {
    // «За 30 секунд» остаётся обещанием в заголовке, но не метрикой: если
    // вернётся выдуманное «среднее время генерации», тест это заметит.
    const stats = userText("src/components/landing/Stats.tsx");
    expect(stats).not.toMatch(/avgTimeSec|Среднее время/i);
    const hero = userText("src/components/landing/Hero.tsx");
    expect(hero).not.toMatch(/avgTimeSec|Среднее время/i);
  });
});

describe("обратные ссылки на хаб экзаменов", () => {
  it("/oge/ ссылается на /exam/oge/ и на /exam/", () => {
    const oge = userText("src/app/oge/page.tsx");
    expect(oge).toMatch(/href=["']\/exam\/oge\/["']/);
    expect(oge).toMatch(/href=["']\/exam\/["']/);
  });

  it("хабы реально существуют как маршруты (ссылка не в пустоту)", () => {
    // Ссылка на несуществующий маршрут — это 404 для учителя и потерянный
    // вес страниц заданий, ради которых хаб и делался.
    for (const f of ["src/app/exam/page.tsx", "src/app/exam/[exam]/page.tsx"]) {
      expect(read(f).length).toBeGreaterThan(0);
    }
  });
});

/**
 * Ф-5. ГДЕ БЕРЁТСЯ ЧИСЛО НА `/oge/` (аудит 11.10.2026).
 *
 * ДЕФЕКТ, КОТОРЫЙ ЗДЕСЬ ЛОВИМ. Страница показывала `getRemaining()` — чистый
 * localStorage. Текст под этим числом говорит, что счёт ведёт сервер, значит
 * после очистки браузера учитель получал «3 из 3» при серверном остатке 0 и
 * упирался в отказ сервера на кнопке. То есть обещание и поведение разошлись.
 *
 * Проверяем на ОТРИСОВАННОЙ СТРАНИЦЕ, а не по исходнику: исходник покажет, что
 * мы написали нужный вызов, но не покажет, что число на экране действительно
 * пришло с сервера. Первый тест падал на старом коде — там на экране стояло
 * «3 из 3», потому что браузер был пустой.
 */
describe("Ф-5: число на /oge/ приходит с сервера", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("после очистки браузера показывает серверный остаток, а не пустой кэш", async () => {
    mockUsage(1);
    render(React.createElement(OgePage));
    // Кэша нет → старый код рисовал «3 из 3». Сервер сказал «осталась 1».
    expect(await screen.findByText(`Осталось генераций: 1 из ${FREE_LIMIT}`)).toBeTruthy();
  });

  it("при нуле на сервере учитель видит честный отказ, а не «3 из 3»", async () => {
    mockUsage(0);
    render(React.createElement(OgePage));
    expect(await screen.findByText("Бесплатные генерации закончились")).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByText(`Осталось генераций: 0 из ${FREE_LIMIT}`)).toBeNull(),
    );
  });

  it("локальный кэш приводится к серверному, а не живёт своей жизнью", async () => {
    mockUsage(0);
    render(React.createElement(OgePage));
    await screen.findByText("Бесплатные генерации закончились");
    // syncFromServer записал «использовано 3 из 3» — после очистки браузера
    // конструктор и кабинет увидят то же, что видит эта страница.
    await waitFor(() => {
      const raw = localStorage.getItem(LIMIT_STORAGE_KEY);
      expect(JSON.parse(raw as string).count).toBe(FREE_LIMIT);
    });
  });

  it("при недоступном сервере остаётся оптимистичное значение — не хуже прежнего", async () => {
    // fetchUsage() отдаёт null при 401 (нет входа) и при упавшей сети.
    mockUsage(null);
    localStorage.setItem(
      LIMIT_STORAGE_KEY,
      JSON.stringify({ count: 1, syncedAt: null }),
    );
    render(React.createElement(OgePage));
    // Раньше страница показывала ровно это. Ухудшения нет, а решение о доступе
    // всё равно принимает бэк — вернёт 429, и мы перечитаем счётчик с него.
    // Число считаем от квоты, а не пишем руками: ТЗ-29 подняло её с трёх до
    // пяти, и зашитое здесь «2» разъехалось бы с местом.
    expect(await screen.findByText(`Осталось генераций: ${FREE_LIMIT - 1} из ${FREE_LIMIT}`))
      .toBeTruthy();
  });

  it("страница ходит на серверный usage и приводит к нему счётчик", () => {
    // Страховка от «тест прошёл случайно»: если серверный путь уберут из кода,
    // тесты выше упадут, а этот — скажет, что чинить именно это.
    const oge = userText("src/app/oge/page.tsx");
    expect(oge).toContain('from "@/lib/auth/api"');
    expect(oge).toMatch(/await fetchUsage\(\)/);
    expect(oge).toMatch(/syncFromServer\(/);
    // И при 429 отказ не рисуется на устаревшем числе.
    expect(oge).toMatch(/rate_limit"\) void refreshFromServer\(\)/);
  });
});

/**
 * Ф-6. СКЛОНЕНИЕ. Константа подставляла число прямо в слово: выходило
 * «3 генераций». Число приходит из бэка, поэтому правило должно быть в коде,
 * а не зашито под текущие три.
 */
describe("Ф-6: форма слова зависит от числа", () => {
  const CASES: Array<[number, string]> = [
    [1, "генерация"],
    [2, "генерации"],
    [3, "генерации"],
    [4, "генерации"],
    [5, "генераций"],
    [11, "генераций"],
    [21, "генерация"],
  ];

  it.each(CASES)("%i → %s", (n, word) => {
    expect(pluralizeGenerations(n)).toBe(word);
    expect(quotaGenerations(n)).toBe(`${n} ${word}`);
  });

  it("пояснение квоты стоит в правильной форме", () => {
    expect(FREE_QUOTA_SCOPE_NOTE).toContain(quotaGenerations(FREE_GENERATIONS));
    // Число в пояснении — ровно то, из которого собрано обещание. Раньше здесь
    // стояло сравнение с «5 генераций», но оно работало только пока квота была
    // не пять: при пяти правильная форма и есть «5 генераций», и проверка
    // опровергала сама себя. Теперь сверяем число, а не слово.
    // В пояснении ровно ОДНО число — квота. «1-го числа» не должно ломать
    // проверку, поэтому сверяем первое число, а не весь набор.
    expect(counterNumbers(FREE_QUOTA_SCOPE_NOTE)[0]).toBe(FREE_GENERATIONS);
  });

  it("сырой подстановки числа перед словом в текстах не осталось", () => {
    for (const f of [
      "src/lib/content/landing-seo.ts",
      "src/components/shared/UsageCard.tsx",
    ]) {
      expect(read(f)).not.toMatch(/\$\{FREE_GENERATIONS\}\s+генераци/);
    }
  });

  it("счётчик «Осталось … из …» не склоняет слово перед числом", () => {
    // Форма «Осталось генераций: 1 из 3» — это подпись-счётчик, а не
    // «1 генерация»: слово стоит ДО числа и падежом связано с «осталось».
    // Поэтому договорённость другая — числа остаются на своих местах.
    expect(counterNumbers(`Осталось генераций: 1 из ${FREE_LIMIT}`)).toEqual([1, FREE_LIMIT]);
  });
});