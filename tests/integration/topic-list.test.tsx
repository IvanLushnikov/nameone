/**
 * З8: список тем в конструкторе — счётчик «Показано N из M» и видимая
 * полоса прокрутки (`src/app/constructor/page.tsx`, компонент TopicStep).
 *
 * Жалоба была: «там всего 4 темы… пролистала — а там всего 8». Список
 * обрезался по `max-h`, а класс `scrollbar-hide` прятал полосу прокрутки, и
 * обрезанный список выглядел как весь. Тест проверяет ровно это:
 *   1) есть текстовый счётчик «Показано N из M»;
 *   2) у списка НЕТ класса `scrollbar-hide`;
 *   3) кнопка «Показать все» реально раскрывает список до конца.
 *
 * Компонент `TopicStep` наружу не экспортируется, поэтому тест гоняет
 * настоящий визард страницы (см. helpers/constructor-flow) — это прямой
 * проверяющий тест, а не разбор исходника.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { getGrade } from "@/lib/content/subjects";
import type { SubjectSlug } from "@/lib/types";
import {
  goToTopicStep,
  mockApi,
  openConstructor,
  setDevice,
} from "./helpers/constructor-flow";

// next/navigation — концерн jsdom: страница читает useSearchParams/useRouter.
// Короткого класса (короче порога предпросмотра) в таксономии больше нет:
// подключение тем из рабочих программ довело даже самый короткий до 12 тем.
// Такие случаи проверяем на подставных данных — важно поведение списка, а не
// наличие класса с тремя темами в боевой таксономии. Остальные предметы и
// классы идут настоящие.
const SHORT_GRADE = { subject: "math" as const, grade: 5, count: 3 };

vi.mock("@/lib/content/subjects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/content/subjects")>();
  return {
    ...actual,
    getGrade: (subject: string, grade: number) => {
      if (subject === SHORT_GRADE.subject && grade === SHORT_GRADE.grade) {
        return {
          topics: Array.from({ length: SHORT_GRADE.count }, (_, i) => ({
            title: `Тема ${i + 1}`,
            slug: `t${i + 1}`,
            // Конструктор читает ещё и examples — без поля он падает на t.examples[0].
            examples: [],
          })),
        };
      }
      return actual.getGrade(subject as never, grade as never);
    },
  };
});

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/constructor/",
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

beforeEach(() => {
  window.localStorage.clear();
  mockApi();
  setDevice({ coarse: false, touchPoints: 0, width: 1600 });
});

describe("список тем — счётчик и полоса прокрутки (З8)", () => {
  it("показывает «Показано N из M», где N меньше M", async () => {
    const user = await openConstructor();
    await goToTopicStep(user, "algebra", 7);

    const counter = screen.getByText(/^Показано \d+ из \d+$/);
    const [, shown, total] = counter.textContent!.match(/^Показано (\d+) из (\d+)$/)!;

    expect(Number(shown)).toBeGreaterThan(0);
    expect(Number(total)).toBeGreaterThan(Number(shown));
  });

  it("у списка тем нет класса scrollbar-hide, который прятал полосу прокрутки", async () => {
    const user = await openConstructor();
    await goToTopicStep(user, "algebra", 7);

    const list = screen.getByTestId("topics-list");

    expect(list.className).not.toContain("scrollbar-hide");
    // Список остаётся прокручиваемым (ограничение по высоте сохранено).
    expect(list.className).toContain("overflow-y-auto");
  });

  it("в разметке шага темы вообще нет scrollbar-hide", async () => {
    const user = await openConstructor();
    await goToTopicStep(user, "algebra", 7);

    // Шаг целиком: класс мог бы вернуться на любом из внутренних контейнеров.
    expect(document.body.innerHTML).not.toContain("scrollbar-hide");
  });

  it("кнопка «Показать все» раскрывает список до конца и счётчик это показывает", async () => {
    const user = await openConstructor();
    await goToTopicStep(user, "algebra", 7);

    const counter = screen.getByText(/^Показано \d+ из \d+$/);
    const total = Number(counter.textContent!.match(/из (\d+)$/)![1]);
    const shownBefore = screen.getByTestId("topics-list").querySelectorAll("button").length;

    const showAll = screen.getByTestId("show-all-topics");
    expect(showAll.textContent).toContain(String(total));
    expect(shownBefore).toBeLessThan(total);

    await user.click(showAll);

    expect(screen.getByTestId("topics-list").querySelectorAll("button")).toHaveLength(total);
    expect(screen.getByText(`Показано ${total} из ${total}`)).toBeInTheDocument();
    // Кнопка исчезает — раскрывать больше нечего.
    expect(screen.queryByTestId("show-all-topics")).not.toBeInTheDocument();
  });

  it("короткий список помещается целиком и не просит «Показать все»", async () => {
    const { subject, grade, count } = SHORT_GRADE;
    expect(count, "короткий список должен быть короче порога").toBeLessThanOrEqual(
      TOPICS_PREVIEW_COUNT,
    );

    const user = await openConstructor();
    await goToTopicStep(user, subject, grade);

    const counter = screen.getByText(/^Показано (\d+) из (\d+)$/);
    const [, shown, total] = counter.textContent!.match(/^Показано (\d+) из (\d+)$/)!;

    // Список короче порога — показан весь, кнопки раскрытия нет.
    expect(Number(shown)).toBe(Number(total));
    expect(Number(total)).toBe(count);
    expect(screen.getByTestId("topics-list").querySelectorAll("button")).toHaveLength(count);
    expect(screen.queryByTestId("show-all-topics")).not.toBeInTheDocument();
  });

  it("список длиннее порога обрезается и честно об этом говорит", async () => {
    const { subject, grade, total } = gradesByTopicCount(true);
    expect(total, "нужен класс длиннее порога — иначе случай не проверяется").toBeGreaterThan(
      TOPICS_PREVIEW_COUNT,
    );

    const user = await openConstructor();
    await goToTopicStep(user, subject, grade);

    // Счётчик показывает обрезание, кнопка «Показать все» есть.
    expect(screen.getByText(`Показано ${TOPICS_PREVIEW_COUNT} из ${total}`)).toBeInTheDocument();
    expect(screen.getByTestId("show-all-topics")).toBeInTheDocument();
    expect(screen.getByTestId("topics-list").querySelectorAll("button")).toHaveLength(
      TOPICS_PREVIEW_COUNT,
    );
  });
});

/** Порог предпросмотра продублирован из конструктора: он и есть предмет проверки. */
const TOPICS_PREVIEW_COUNT = 6;

/**
 * Класс с наименьшим числом тем (случай «помещается целиком») и с наибольшим
 * (случай «длиннее порога»). Зашивать конкретную пару «предмет × класс»
 * нельзя: подключение тем из рабочих программ меняет число тем, и проверка
 * либо перестаёт проверять нужный случай, либо требует несуществующий класс.
 */
function gradesByTopicCount(desc: boolean): { subject: SubjectSlug; grade: number; total: number } {
  const subjects: SubjectSlug[] = ["math", "russian", "biology", "history", "geometry", "algebra"];
  let best: { subject: SubjectSlug; grade: number; total: number } | null = null;
  for (const subject of subjects) {
    for (let grade = 1; grade <= 11; grade += 1) {
      const g = getGrade(subject, grade);
      if (!g || g.topics.length === 0) continue;
      if (!best || (desc ? g.topics.length > best.total : g.topics.length < best.total)) {
        best = { subject, grade, total: g.topics.length };
      }
    }
  }
  if (!best) throw new Error("в таксономии нет ни одной темы");
  return best;
}
