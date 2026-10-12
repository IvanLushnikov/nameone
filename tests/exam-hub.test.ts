/**
 * Тесты хабов экзаменов (блок A, аудит 11.10.2026).
 *
 * Что чинили: 218 страниц `/exam/*` лежали в карте сайта, но на них не было ни
 * одной входящей ссылки с главной, `/oge/`, `/subject/` и `/materials/`.
 * `/exam/` и `/exam/oge/` отдавали 404, то есть в раздел было невозможно войти.
 *
 * Что проверяем:
 *  1. `generateStaticParams` у `/exam/[exam]` закрывает все экзамены из
 *     таксономии — иначе при `output: "export"` часть страниц не соберётся;
 *  2. на хабе экзамена есть ссылка на КАЖДОЕ задание `/exam/{exam}/{subject}/{n}/`.
 *     Сверяемся с `EXAM_SUBJECTS` — источником истины, а не с константой
 *     в тесте: таксономия растёт, и тест должен падать на новом предмете;
 *  3. `/exam/` входит в оба экзамена;
 *  4. главная даёт прямую ссылку на `/exam/oge/` (от неё до любого задания
 *     ровно два клика);
 *  5. на хабах есть BreadcrumbList и canonical.
 */

import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

import { EXAM_SUBJECTS } from "../src/lib/content/exam-taxonomy";
import { absoluteUrl } from "../src/lib/seo/metadata";
import ExamIndexPage, { metadata as examIndexMetadata } from "@/app/exam/page";
import ExamHubPage, {
  generateStaticParams,
  generateMetadata,
} from "@/app/exam/[exam]/page";
import HomePage from "@/app/page";

/**
 * Главная тянет `useRouter` из блоков лендинга, а `next/navigation` вне
 * приложения Next бросает «expected app router to be mounted». Мокаем ровно
 * то, что нужно рендеру: `notFound()` обязан падать — на нём держится 404
 * для незнакомого экзамена.
 */
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

/** Все экзамены, которые есть в таксономии. */
const EXAMS = Array.from(new Set(EXAM_SUBJECTS.map((s) => s.exam)));

/** Сколько всего номеров заданий — столько страниц должно быть связано с хабов. */
const TOTAL_NUMBERS = EXAM_SUBJECTS.reduce((sum, s) => sum + s.numbers.length, 0);

/**
 * Хвостовой слеш.
 *
 * В исходниках ссылки написаны со слешем (`trailingSlash: true` в
 * `next.config.mjs`, сайт так и отдаёт адреса), но `next/link` в тестовом
 * окружении конфиг сайта не читает и режет слеш. Поэтому сравниваем по
 * адресу без хвостового слеша, а в исходниках он остаётся.
 */
function normalizeHref(href: string): string {
  return href.length > 1 ? href.replace(/\/+$/, "") : href;
}

/** Все `href` отрисованной страницы. */
function hrefs(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("a[href]")).map((a) =>
    normalizeHref(a.getAttribute("href") ?? ""),
  );
}

/** Разобранные JSON-LD объекты страницы. */
function jsonLd(container: HTMLElement): Record<string, unknown>[] {
  return Array.from(
    container.querySelectorAll('script[type="application/ld+json"]'),
  ).flatMap((node) => {
    const parsed = JSON.parse(node.textContent ?? "{}");
    return Array.isArray(parsed) ? parsed : [parsed];
  });
}

/** Есть ли на странице разметка хлебных крошек. */
function hasBreadcrumbList(container: HTMLElement): boolean {
  return jsonLd(container).some((obj) => obj["@type"] === "BreadcrumbList");
}

describe("Хабы экзаменов: маршруты", () => {
  it("generateStaticParams закрывает все экзамены из таксономии", () => {
    const params = generateStaticParams();
    const actual = params.map((p) => p.exam).sort();

    expect(actual).toEqual([...EXAMS].sort());
    // Дубли параметров собирают один и тот же URL дважды — на 218 страницах
    // это лишняя работа генерации.
    expect(new Set(actual).size).toBe(actual.length);
  });

  it("таксономия не потеряла задания: 218 страниц", () => {
    expect(TOTAL_NUMBERS).toBe(218);
    expect(EXAMS).toEqual(["oge", "ege"]);
  });

  it("хаб экзамена отвечает 404 на незнакомом экзамене", () => {
    // `notFound()` в статическом экспорте превращается в 404-страницу;
    // главное — чтобы маршрут не отдал 200 с пустым списком.
    expect(() => render(ExamHubPage({ params: { exam: "olympiad" } }))).toThrow();
  });
});

describe("Хаб экзамена: все задания доступны в два клика", () => {
  for (const exam of EXAMS) {
    it(`/exam/${exam}/ ссылается на каждое задание ${exam}`, () => {
      const { container } = render(ExamHubPage({ params: { exam } }));
      const found = new Set(hrefs(container));

      // Источник истины — таксономия, а не список в тесте.
      const expected = EXAM_SUBJECTS.filter((s) => s.exam === exam).flatMap((s) =>
        s.numbers.map((n) =>
          normalizeHref(`/exam/${exam}/${s.subject}/${n.number}/`),
        ),
      );

      expect(expected.length).toBeGreaterThan(0);
      expect(expected.filter((href) => !found.has(href))).toEqual([]);
    });

    it(`/exam/${exam}/ ведёт на старый адрес /oge/ и обратно на /exam/`, () => {
      const { container } = render(ExamHubPage({ params: { exam } }));
      const found = hrefs(container);

      // Старый адрес не переименовываем: на нём вес, хабы ходят туда и обратно.
      expect(found).toContain("/oge");
      expect(found).toContain("/exam");
    });
  }

  it("с хаба экзамена связаны все 218 страниц заданий", () => {
    const links = EXAMS.flatMap((exam) =>
      hrefs(render(ExamHubPage({ params: { exam } })).container),
    );
    const taskPages = EXAM_SUBJECTS.flatMap((s) =>
      s.numbers.map((n) => normalizeHref(`/exam/${s.exam}/${s.subject}/${n.number}/`)),
    );

    expect(taskPages).toHaveLength(TOTAL_NUMBERS);
    expect(taskPages.filter((href) => !links.includes(href))).toEqual([]);
  });
});

describe("Вход в раздел", () => {
  it("/exam/ входит в каждый экзамен", () => {
    const { container } = render(ExamIndexPage());
    const found = hrefs(container);

    for (const exam of EXAMS) {
      expect(found).toContain(`/exam/${exam}`);
    }
    expect(found).toContain("/oge");
  });

  it("главная даёт прямую ссылку на /exam/oge/", () => {
    const { container } = render(HomePage());
    expect(hrefs(container)).toContain("/exam/oge");
  });

  it("главная монтирует блок «Подготовка к ОГЭ»", () => {
    // Ссылка могла приехать из любого блока. Проверяем именно тот блок:
    // от него до любого задания ОГЭ ровно два клика.
    const { container } = render(HomePage());
    const heading = Array.from(container.querySelectorAll("h2")).find((h) =>
      (h.textContent ?? "").includes("Подготовка к"),
    );

    expect(heading).toBeDefined();
    const section = heading?.closest("section");
    expect(
      section?.querySelector('a[href="/exam/oge"], a[href="/exam/oge/"]'),
    ).not.toBeNull();
  });
});

describe("Метаданные хабов", () => {
  it("на /exam/ есть BreadcrumbList и canonical", () => {
    const { container } = render(ExamIndexPage());

    expect(hasBreadcrumbList(container)).toBe(true);
    expect(examIndexMetadata.alternates?.canonical).toBe(absoluteUrl("/exam"));
    expect(examIndexMetadata.title).toBeTruthy();
    expect(examIndexMetadata.description).toBeTruthy();
    // «Страница» вместо осмысленного заголовка — старая дыра на всех хабах.
    expect(String(examIndexMetadata.title)).not.toBe("Страница");
  });

  for (const exam of EXAMS) {
    it(`на /exam/${exam}/ есть BreadcrumbList и canonical`, () => {
      const { container } = render(ExamHubPage({ params: { exam } }));
      const meta = generateMetadata({ params: { exam } });

      expect(hasBreadcrumbList(container)).toBe(true);
      expect(meta.alternates?.canonical).toBe(absoluteUrl(`/exam/${exam}`));
      expect(meta.title).toBeTruthy();
      expect(meta.description).toBeTruthy();
      expect(String(meta.title)).not.toBe("Страница");
    });
  }

  it("незнакомый экзамен не индексируется", () => {
    const meta = generateMetadata({ params: { exam: "olympiad" } });
    expect(meta.robots).toMatchObject({ index: false });
  });
});