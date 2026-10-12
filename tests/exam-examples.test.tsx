/**
 * Тесты блока B — «Примеры заданий» вместо заглушки на 218 страницах
 * `/exam/[exam]/[subject]/[number]`.
 *
 * Что здесь защищаем:
 *
 *   1. Ни одна страница не остаётся пустой. Для каждой из 218 комбинаций
 *      из EXAM_SUBJECTS блок непустой: либо 3 примера с ответами, либо
 *      честный блок «Что проверяет это задание». Раньше на всех 218 стояло
 *      «Скоро здесь появятся примеры заданий этого типа» — 13% sitemap
 *      отдавал в индексе страницу без единого примера.
 *   2. Ни один пример не пустой и не выдуманный: у каждого непустые
 *      `text` и `answer`, а формулировка дословно совпадает с примером из
 *      темы таксономии (сверяем с исходным источником, а не только на
 *      непустоту).
 *   3. Подстрока «Скоро здесь появятся» не встречается в исходнике
 *      страницы — заглушка убрана из кода, а не заменена на другую вставку.
 *   4. На странице есть ссылка «все задания предмета» и 5–8 ссылок на
 *      смежные темы программы.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Каждый тест здесь рендерит все 218 страниц заданий. На дефолтных 5000 мс
 * они честно не успевали под нагрузкой — файл «мигал» красным при полностью
 * исправном коде (ловили 12.10.2026 дважды: и до правок, и после). Лимит
 * поднят до 30 секунд: это вопрос скорости прогона, а не корректности.
 */
vi.setConfig({ testTimeout: 30_000 });
import { EXAM_SUBJECTS } from "@/lib/content/exam-taxonomy";
import { getExamExampleBlock, getRelatedTopics } from "@/lib/content/exam-examples";
import { subjects } from "@/lib/content/subjects";
import ExamNumberPage from "@/app/exam/[exam]/[subject]/[number]/page";

// `notFound()` в jsdom вне серверного контекста бросает специальную ошибку —
// нам она на валидных страницах не нужна, но на несуществующем номере
// должна вызываться. Мокаем так, чтобы тест не зависел от рантайма Next.
vi.mock("next/navigation", () => ({
  notFound: () => {
    const err = new Error("NEXT_NOT_FOUND");
    (err as Error & { digest: string }).digest = "NEXT_NOT_FOUND";
    throw err;
  },
  useRouter: () => ({ push: vi.fn() }),
}));

const PAGE_FILE = path.resolve(
  process.cwd(),
  "src/app/exam/[exam]/[subject]/[number]/page.tsx",
);

/** Все комбинации (экзамен, предмет, номер) из таксономии. */
const ALL_COMBOS = EXAM_SUBJECTS.flatMap((s) =>
  s.numbers.map((n) => ({
    exam: s.exam,
    subject: s.subject,
    number: n.number,
    title: n.title,
  })),
);

describe("Блок «Примеры заданий» на страницах номеров экзамена", () => {
  it("таксономия покрывает 218 страниц", () => {
    expect(ALL_COMBOS).toHaveLength(218);
  });

  it("ни одна страница не остаётся с заглушкой — блок непустой у всех 218", () => {
    const пустые: string[] = [];
    for (const c of ALL_COMBOS) {
      const block = getExamExampleBlock(c.exam, c.subject, c.number);
      if (block.kind === "examples") {
        if (block.examples.length === 0) пустые.push(`${c.exam}/${c.subject}/${c.number}`);
      } else if (!block.block.checks.trim()) {
        // Честный блок без описания тоже считаем пустым.
        пустые.push(`${c.exam}/${c.subject}/${c.number}`);
      }
    }
    expect(пустые).toEqual([]);
  });

  it("каждый пример содержит непустые text и answer", () => {
    const плохие: string[] = [];
    for (const c of ALL_COMBOS) {
      const block = getExamExampleBlock(c.exam, c.subject, c.number);
      if (block.kind !== "examples") continue;
      for (const ex of block.examples) {
        if (!ex.text.trim() || !ex.answer.trim()) {
          плохие.push(`${c.exam}/${c.subject}/${c.number}: ${JSON.stringify(ex)}`);
        }
      }
    }
    expect(плохие).toEqual([]);
  });

  it("примеры дословно берутся из таксономии, а не сочиняются", () => {
    // Собираем все реальные «text / answer» из тем программы.
    const реальные = new Set<string>();
    for (const s of subjects) {
      for (const g of s.grades) {
        for (const t of g.topics) {
          for (const ex of t.examples) {
            const ответ = ex.answer ?? "";
            if (ex.text.trim() && ответ.trim()) {
              реальные.add(`${ex.text} ${ответ.trim()}`);
            }
          }
        }
      }
    }
    const выдуманные: string[] = [];
    for (const c of ALL_COMBOS) {
      const block = getExamExampleBlock(c.exam, c.subject, c.number);
      if (block.kind !== "examples") continue;
      for (const ex of block.examples) {
        if (!реальные.has(`${ex.text} ${ex.answer.trim()}`)) {
          выдуманные.push(`${c.exam}/${c.subject}/${c.number}: ${ex.text}`);
        }
      }
    }
    expect(выдуманные).toEqual([]);
  });

  it("ссылки на примеры ведут на существующие страницы тем", () => {
    const существующие = new Set<string>();
    for (const s of subjects) {
      for (const g of s.grades) {
        for (const t of g.topics) {
          существующие.add(`/subject/${s.slug}/${g.num}/${t.slug}/`);
        }
      }
    }
    const битые: string[] = [];
    for (const c of ALL_COMBOS) {
      const block = getExamExampleBlock(c.exam, c.subject, c.number);
      if (block.kind === "examples") {
        for (const ex of block.examples) {
          if (!существующие.has(ex.topicHref)) битые.push(ex.topicHref);
        }
      }
      for (const t of getRelatedTopics(c.exam, c.subject, c.number)) {
        if (!существующие.has(t.href)) битые.push(t.href);
      }
    }
    expect(new Set(битые)).toEqual(new Set());
  });

  it("у 211 страниц настоящие примеры, у 7 — честный блок", () => {
    // Явная фиксация покрытия: цифры меняются только вместе с таксономией,
    // иначе тест напомнит, что счётчик в отчёте протух.
    let сПримерами = 0;
    let честных = 0;
    for (const c of ALL_COMBOS) {
      if (getExamExampleBlock(c.exam, c.subject, c.number).kind === "examples") {
        сПримерами++;
      } else {
        честных++;
      }
    }
    expect(сПримерами + честных).toBe(218);
    expect(сПримерами).toBe(211);
    expect(честных).toBe(7);
  });

  it("честный блок приходит ровно там, где нет темы с примерами", () => {
    // В репозитории нет тем про однородные члены, подпрограммы, рекурсию,
    // электронные таблицы, дискретную математику, сложность алгоритмов и
    // машинное обучение. Подставлять «похожую» тему нельзя — это выдумка.
    const ожидаются = [
      "ege/russian/16",
      "ege/informatics/13",
      "ege/informatics/14",
      "ege/informatics/18",
      "ege/informatics/25",
      "ege/informatics/26",
      "ege/informatics/27",
    ];
    const фактически = ALL_COMBOS.filter(
      (c) => getExamExampleBlock(c.exam, c.subject, c.number).kind === "honest",
    ).map((c) => `${c.exam}/${c.subject}/${c.number}`);
    expect(new Set(фактически)).toEqual(new Set(ожидаются));
  });

  it("у каждой страницы 5–8 ссылок на смежные темы", () => {
    const плохие: string[] = [];
    for (const c of ALL_COMBOS) {
      const n = getRelatedTopics(c.exam, c.subject, c.number).length;
      if (n < 5 || n > 8) плохие.push(`${c.exam}/${c.subject}/${c.number}=${n}`);
    }
    expect(плохие).toEqual([]);
  });
});

describe("Страница номера экзамена — разметка", () => {
  it("в исходнике страницы нет подстроки «Скоро здесь появятся»", () => {
    const src = readFileSync(PAGE_FILE, "utf8");
    expect(src).not.toContain("Скоро здесь появятся");
  });

  it("в отдаче страницы нет подстроки «Скоро здесь появятся»", () => {
    for (const c of ALL_COMBOS) {
      const { container } = render(
        <ExamNumberPage
          params={{ exam: c.exam, subject: c.subject, number: String(c.number) }}
        />,
      );
      expect(container.textContent ?? "").not.toContain("Скоро здесь появятся");
    }
  });

  it("на странице есть ссылка «все задания предмета»", () => {
    for (const c of ALL_COMBOS) {
      const { container } = render(
        <ExamNumberPage
          params={{ exam: c.exam, subject: c.subject, number: String(c.number) }}
        />,
      );
      // Next нормализует слеш: в href может быть как `/exam/oge/math/`,
      // так и `/exam/oge/math`. Проверяем оба варианта, но именно на
      // предметный хаб — не на соседние номера вида `/exam/oge/math/2`.
      const ссылка =
        container.querySelector(`a[href="/exam/${c.exam}/${c.subject}/"]`) ??
        container.querySelector(`a[href="/exam/${c.exam}/${c.subject}"]`);
      expect(ссылка, `нет ссылки на хаб предмета у ${c.exam}/${c.subject}`).not.toBeNull();
      expect(ссылка?.textContent ?? "").toContain("Все задания предмета");
    }
  });

  it("на странице есть не меньше 5 ссылок на смежные темы", () => {
    for (const c of ALL_COMBOS) {
      const { container } = render(
        <ExamNumberPage
          params={{ exam: c.exam, subject: c.subject, number: String(c.number) }}
        />,
      );
      const ссылки = Array.from(container.querySelectorAll('a[href^="/subject/"]'));
      expect(ссылки.length).toBeGreaterThanOrEqual(5);
    }
  });

  it("примеры с ответами попадают в разметку страницы", () => {
    for (const c of ALL_COMBOS) {
      const { container } = render(
        <ExamNumberPage
          params={{ exam: c.exam, subject: c.subject, number: String(c.number) }}
        />,
      );
      const текст = container.textContent ?? "";
      const block = getExamExampleBlock(c.exam, c.subject, c.number);
      if (block.kind === "examples") {
        for (const ex of block.examples) {
          expect(текст).toContain(ex.text);
          expect(текст).toContain(ex.answer);
        }
      } else {
        expect(текст).toContain("Что проверяет это задание");
      }
    }
  });
});