/**
 * Хабы предметов `/exam/[exam]/[subject]` и четыре дефекта вокруг них
 * (аудит 11.10.2026, приёмка блока A).
 *
 * Что чинили:
 *   1. На каждой из 218 страниц заданий стояла ссылка «Все задания
 *      предмета» вида `/exam/oge/physics/`, но такой страницы не было:
 *      папка собиралась только потому, что внутри неё лежали
 *      пронумерованные страницы `1/`, `2/`, …, а `index.html` не было.
 *      218 ссылок — 218 отказов. Прежняя проверка смотрела только на
 *      наличие ссылки с нужным текстом и поэтому это пропустила.
 *   2. От главной до 126 страниц ЕГЭ было четыре клика вместо двух:
 *      главная давала ссылку только на `/exam/oge/`.
 *   3. В описании `/exam/oge/` было «по 5 предметам» и следом список из
 *      четырёх — обществознание (24 страницы) выпало.
 *   4. На семи страницах с честным блоком «Что проверяет это задание»
 *      получалось 9 ссылок на смежные темы вместо допустимых 5–8.
 *
 * Считаем по фактическим `href` отрендеренных компонентов: длина пути
 * строится графом, а число предметов сверяется с `EXAM_SUBJECTS`.
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

import { EXAM_SUBJECTS } from "@/lib/content/exam-taxonomy";

/**
 * Тесты считают ссылки на всех 218 страницах. На дефолтных 5000 мс файл
 * «мигал» красным под нагрузкой при исправном коде (ловили 12.10.2026).
 * Лимит поднят до 30 секунд — это скорость прогона, а не корректность.
 */
vi.setConfig({ testTimeout: 30_000 });
import { subjectLabel } from "@/components/exam/hub-data";
import { absoluteUrl } from "@/lib/seo/metadata";
import ExamNumberPage, {
  generateStaticParams as numberParams,
} from "@/app/exam/[exam]/[subject]/[number]/page";
import ExamSubjectHubPage, {
  generateStaticParams as subjectHubParams,
  generateMetadata as subjectHubMetadata,
} from "@/app/exam/[exam]/[subject]/page";
import ExamHubPage, { generateStaticParams as examHubParams } from "@/app/exam/[exam]/page";
import ExamIndexPage from "@/app/exam/page";
import HomePage from "@/app/page";

/**
 * Главная и хабы тянут `useRouter`, а `next/navigation` вне приложения Next
 * бросает «expected app router to be mounted». Мокаем ровно то, что нужно
 * рендеру; `notFound()` обязан падать — на нём держится 404 для незнакомых
 * адресов.
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

/** Все комбинации (экзамен, предмет, номер) — те самые 218 страниц. */
const ALL_COMBOS = EXAM_SUBJECTS.flatMap((s) =>
  s.numbers.map((n) => ({
    exam: s.exam,
    subject: s.subject,
    number: n.number,
  })),
);

/** Все пары (экзамен, предмет) — 10 хабов предметов. */
const ALL_PAIRS = EXAM_SUBJECTS.map((s) => ({ exam: s.exam, subject: s.subject }));

/** Экзамены из таксономии. */
const EXAMS = Array.from(new Set(EXAM_SUBJECTS.map((s) => s.exam)));

/**
 * Хвостовой слеш.
 *
 * В исходниках ссылки со слешем (`trailingSlash: true`), но `next/link` в
 * тестовом окружении конфиг сайта не читает и слеш режет. Сравниваем по
 * адресу без хвостового слеша, в исходниках он остаётся.
 */
function normalizeHref(href: string): string {
  return href.length > 1 ? href.replace(/\/+$/, "") : href;
}

/** Все `href` отрисованной страницы, без хвостового слеша. */
function hrefs(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("a[href]")).map((a) =>
    normalizeHref(a.getAttribute("href") ?? ""),
  );
}

/**
 * Отрисовка страницы задания.
 *
 * Страница — обычная серверная функция без хуков, поэтому вызываем её
 * напрямую (так же, как в `exam-hub.test.ts`) и не тащим JSX в `.ts`-файл.
 */
function renderNumberPage(c: { exam: string; subject: string; number: number }) {
  return render(
    ExamNumberPage({
      params: { exam: c.exam, subject: c.subject, number: String(c.number) },
    }),
  );
}

/**
 * Ссылки на смежные темы.
 *
 * Считаем все ссылки на темы программы (`/subject/…`), кроме ссылок «Тема
 * программы: …» под каждым примером задания: это ссылка из блока примеров на
 * тему самого примера, а не перелинковка по смежным темам.
 *
 * Именно так ловится исходный дефект: у семи страниц с честным блоком
 * «Что проверяет это задание» получалось 8 тем плюс ссылка на страницу
 * предмета — 9 вместо допустимых 8. Важно, что правило не привязано к тому,
 * где именно нарисован этот блок, иначе тест перестанет ловить дефект после
 * переноса ссылки.
 */
function relatedTopicHrefs(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('a[href^="/subject/"]'))
    .filter((a) => !(a.textContent ?? "").trim().startsWith("Тема программы"))
    .map((a) => a.getAttribute("href") ?? "");
}

describe("Дефект 1: ссылка «Все задания предмета» ведёт на существующую страницу", () => {
  /**
   * Все адреса, которые реально собираются: три уровня маршрутов плюс
   * `/exam/`. Источник — `generateStaticParams`, а не выдуманный список:
   * при `output: "export"` именно эти параметры превращаются в страницы.
   */
  function builtPages(): Set<string> {
    const набор = new Set(["/", "/exam"]);
    for (const { exam } of examHubParams()) набор.add(`/exam/${exam}`);
    for (const { exam, subject } of subjectHubParams()) {
      набор.add(`/exam/${exam}/${subject}`);
    }
    for (const { exam, subject, number } of numberParams()) {
      набор.add(`/exam/${exam}/${subject}/${number}`);
    }
    return набор;
  }

  it("хаб предмета собирается для каждой пары (экзамен, предмет)", () => {
    const параметры = subjectHubParams().map((p) => `${p.exam}/${p.subject}`);

    // 10 предметов из таксономии, дубли параметров собирают один URL дважды.
    expect(параметры).toHaveLength(10);
    expect(new Set(параметры).size).toBe(параметры.length);
    expect(new Set(параметры)).toEqual(new Set(ALL_PAIRS.map((p) => `${p.exam}/${p.subject}`)));
  });

  it("все 218 ссылок ведут на страницы, которые действительно собираются", () => {
    const существующие = builtPages();
    const битые: string[] = [];

    for (const c of ALL_COMBOS) {
      const { container } = renderNumberPage(c);

      // Проверяем цель ссылки, а не наличие ссылки с нужным текстом:
      // прежняя проверка именно так и пропустила 218 отказов.
      const ссылка =
        container.querySelector(`a[href="/exam/${c.exam}/${c.subject}/"]`) ??
        container.querySelector(`a[href="/exam/${c.exam}/${c.subject}"]`);
      const цель = normalizeHref(ссылка?.getAttribute("href") ?? "");

      if (цель !== `/exam/${c.exam}/${c.subject}`) {
        битые.push(`${c.exam}/${c.subject}/${c.number}: ссылка ведёт на «${цель}»`);
      } else if (!существующие.has(цель)) {
        битые.push(`${c.exam}/${c.subject}/${c.number}: страницы ${цель} нет`);
      }
    }

    expect(битые).toEqual([]);
  });

  it("хаб предмета ссылается на каждое задание своего предмета", () => {
    const существующие = builtPages();
    const битые: string[] = [];

    for (const pair of ALL_PAIRS) {
      const { container } = render(
        ExamSubjectHubPage({ params: { exam: pair.exam, subject: pair.subject } }),
      );
      const найдено = new Set(hrefs(container));
      const ожидается = EXAM_SUBJECTS.find(
        (s) => s.exam === pair.exam && s.subject === pair.subject,
      )!.numbers.map((n) => `/exam/${pair.exam}/${pair.subject}/${n.number}`);

      for (const цель of ожидается) {
        if (!найдено.has(цель)) битые.push(`${pair.exam}/${pair.subject}: нет ${цель}`);
        else if (!существующие.has(цель)) битые.push(`нет страницы ${цель}`);
      }
    }

    expect(битые).toEqual([]);
  });

  it("хаб предмета отвечает 404 на несуществующей паре", () => {
    expect(() =>
      render(ExamSubjectHubPage({ params: { exam: "oge", subject: "astrology" } })),
    ).toThrow();
    expect(() =>
      render(ExamSubjectHubPage({ params: { exam: "olympiad", subject: "math" } })),
    ).toThrow();
  });
});

describe("Дефект 2: от главной до любого задания два клика", () => {
  /**
   * Граф по фактическим `href`: узел — страница, ребро — ссылка с неё.
   * Считаем от `/` обходом в ширину, максимальная длина пути до всех 218
   * страниц заданий — это и есть «сколько кликов от главной».
   */
  function distancesFromHome(): Map<string, number> {
    const рёбра = new Map<string, string[]>();

    const добавить = (адрес: string, container: HTMLElement) => {
      рёбра.set(адрес, hrefs(container));
    };

    добавить("/", render(HomePage()).container);
    добавить("/exam", render(ExamIndexPage()).container);
    for (const { exam } of examHubParams()) {
      добавить(`/exam/${exam}`, render(ExamHubPage({ params: { exam } })).container);
    }
    for (const { exam, subject } of subjectHubParams()) {
      добавить(
        `/exam/${exam}/${subject}`,
        render(ExamSubjectHubPage({ params: { exam, subject } })).container,
      );
    }

    const расстояние = new Map<string, number>([["/", 0]]);
    const очередь: string[] = ["/"];
    while (очередь.length > 0) {
      const узел = очередь.shift()!;
      const d = расстояние.get(узел)!;
      for (const цель of рёбра.get(узел) ?? []) {
        if (!расстояние.has(цель)) {
          расстояние.set(цель, d + 1);
          очередь.push(цель);
        }
      }
    }
    return расстояние;
  }

  it("главная даёт ссылку и на ОГЭ, и на ЕГЭ", () => {
    const { container } = render(HomePage());
    const ссылки = hrefs(container);

    expect(ссылки).toContain("/exam/oge");
    expect(ссылки).toContain("/exam/ege");
  });

  it("максимальный путь от главной до любой из 218 страниц — 2 клика", () => {
    const расстояние = distancesFromHome();

    const недостижимые: string[] = [];
    const пути: string[] = [];
    let максимум = 0;

    for (const c of ALL_COMBOS) {
      const адрес = `/exam/${c.exam}/${c.subject}/${c.number}`;
      const d = расстояние.get(адрес);
      if (d === undefined) {
        недостижимые.push(адрес);
        continue;
      }
      максимум = Math.max(максимум, d);
      if (d > 2) пути.push(`${адрес}=${d}`);
    }

    expect(ALL_COMBOS).toHaveLength(218);
    expect(недостижимые).toEqual([]);
    expect(максимум).toBe(2);
    expect(пути).toEqual([]);
  });

  it("все 218 страниц связаны с хабами экзаменов", () => {
    // Отдельно от пути: хаб экзамена обязан содержать ссылку на каждое
    // задание, иначе «два клика» держатся на одной случайной ссылке.
    const ссылки = EXAMS.flatMap((exam) =>
      hrefs(render(ExamHubPage({ params: { exam } })).container),
    );
    const задания = ALL_COMBOS.map(
      (c) => `/exam/${c.exam}/${c.subject}/${c.number}`,
    );

    expect(задания).toHaveLength(218);
    expect(задания.filter((href) => !ссылки.includes(href))).toEqual([]);
  });
});

describe("Дефект 3: число предметов в описании хаба не расходится со списком", () => {
  it("число предметов равно реальному числу предметов экзамена", async () => {
    const { generateMetadata } = await import("@/app/exam/[exam]/page");

    for (const exam of EXAMS) {
      const предметы = EXAM_SUBJECTS.filter((s) => s.exam === exam);
      const текст = String(generateMetadata({ params: { exam } }).description ?? "");
      const число = Number(
        текст.match(/по (\d+) предметам?/)?.[1] ?? текст.match(/(\d+) предмет/)![1],
      );

      expect(число, `в описании /exam/${exam}/ нет числа предметов: «${текст}»`).toBe(
        предметы.length,
      );
    }
  });

  it("в описании перечислены все предметы, а не часть списка", async () => {
    const { generateMetadata } = await import("@/app/exam/[exam]/page");

    for (const exam of EXAMS) {
      const предметы = EXAM_SUBJECTS.filter((s) => s.exam === exam);
      const текст = String(generateMetadata({ params: { exam } }).description ?? "");

      // И каждый предмет назван — на `/exam/oge/` обществознание выпадало,
      // хотя число «5 предметов» оставалось верным.
      for (const s of предметы) {
        const название = subjectLabel(s);
        expect(
          текст.toLowerCase(),
          `в описании /exam/${exam}/ нет предмета «${название}»: «${текст}»`,
        ).toContain(название.toLowerCase());
      }

      // И длина списка совпадает с числом в тексте и с таксономией.
      const список = текст.split("предмет")[1]?.split(":")[1] ?? "";
      const названия = список
        .replace(/[.;]\s*$/, "")
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean);

      expect(
        названия,
        `в описании /exam/${exam}/ список из ${названия.length} предметов при ${предметы.length} в таксономии: «${текст}»`,
      ).toHaveLength(предметы.length);
    }
  });

  it("на хабах предметов число заданий совпадает с таксономией", () => {
    for (const pair of ALL_PAIRS) {
      const предмет = EXAM_SUBJECTS.find(
        (s) => s.exam === pair.exam && s.subject === pair.subject,
      )!;
      const { container } = render(
        ExamSubjectHubPage({ params: { exam: pair.exam, subject: pair.subject } }),
      );
      const задания = предмет.numbers.map(
        (n) => `/exam/${pair.exam}/${pair.subject}/${n.number}`,
      );
      const найдено = new Set(hrefs(container));

      expect(
        задания.filter((href) => !найдено.has(href)),
        `хаб /exam/${pair.exam}/${pair.subject}/ связан не со всеми заданиями`,
      ).toEqual([]);
      expect(String(subjectHubMetadata({ params: pair }).description)).toContain(
        `${предмет.numbers.length}`,
      );
    }
  });
});

describe("Дефект 4: 5–8 ссылок на смежные темы на всех 218 страницах", () => {
  it("включая семь страниц с честным блоком «Что проверяет это задание»", () => {
    const плохие: string[] = [];
    let сЧестнымБлоком = 0;

    for (const c of ALL_COMBOS) {
      const { container } = renderNumberPage(c);
      const честныйБлок = (container.textContent ?? "").includes(
        "Что проверяет это задание",
      );
      if (честныйБлок) сЧестнымБлоком++;

      const n = relatedTopicHrefs(container).length;
      if (n < 5 || n > 8) {
        плохие.push(
          `${c.exam}/${c.subject}/${c.number}=${n}${честныйБлок ? " (честный блок)" : ""}`,
        );
      }
    }

    // Явная фиксация: семь страниц без примеров тоже обязаны попадать
    // в диапазон, а не выпадать из него одной проверкой.
    expect(сЧестнымБлоком).toBe(7);
    expect(плохие).toEqual([]);
  });

  it("в ссылках на смежные темы нет дублей и пустых адресов", () => {
    for (const c of ALL_COMBOS) {
      const { container } = renderNumberPage(c);
      const ссылки = relatedTopicHrefs(container);

      expect(
        ссылки.length,
        `нет ссылок на смежные темы на ${c.exam}/${c.subject}/${c.number}`,
      ).toBeGreaterThan(0);
      expect(
        ссылки.filter((href) => !href.trim()),
        `пустая ссылка на ${c.exam}/${c.subject}/${c.number}`,
      ).toEqual([]);
      expect(
        new Set(ссылки).size,
        `дубли среди смежных тем на ${c.exam}/${c.subject}/${c.number}`,
      ).toBe(ссылки.length);
    }
  });

  it("на каждой странице есть ссылка на хаб предмета", () => {
    for (const c of ALL_COMBOS) {
      const { container } = renderNumberPage(c);
      const ссылка =
        container.querySelector(`a[href="/exam/${c.exam}/${c.subject}/"]`) ??
        container.querySelector(`a[href="/exam/${c.exam}/${c.subject}"]`);

      expect(ссылка, `нет ссылки на хаб предмета у ${c.exam}/${c.subject}`).not.toBeNull();
      expect(ссылка?.textContent ?? "").toContain("Все задания предмета");
    }
  });
});

describe("Хабы предметов: метаданные и навигация", () => {
  it("на каждом хабе есть title, description, canonical и ровно один h1", () => {
    for (const pair of ALL_PAIRS) {
      const meta = subjectHubMetadata({ params: pair });
      const { container } = render(ExamSubjectHubPage({ params: pair }));

      expect(String(meta.title)).toContain(subjectLabel(
        EXAM_SUBJECTS.find((s) => s.exam === pair.exam && s.subject === pair.subject)!,
      ));
      expect(String(meta.title)).not.toBe("Страница");
      expect(String(meta.description)).toBeTruthy();
      expect(meta.alternates?.canonical).toBe(
        absoluteUrl(`/exam/${pair.exam}/${pair.subject}`),
      );
      expect(container.querySelectorAll("h1")).toHaveLength(1);
    }
  });

  it("на каждом хабе есть BreadcrumbList", () => {
    for (const pair of ALL_PAIRS) {
      const { container } = render(ExamSubjectHubPage({ params: pair }));
      const схемы = Array.from(
        container.querySelectorAll('script[type="application/ld+json"]'),
      ).flatMap((node) => {
        const parsed = JSON.parse(node.textContent ?? "{}");
        return Array.isArray(parsed) ? parsed : [parsed];
      });

      expect(
        схемы.some((схема) => схема["@type"] === "BreadcrumbList"),
        `нет BreadcrumbList на /exam/${pair.exam}/${pair.subject}/`,
      ).toBe(true);
    }
  });

  it("хаб предмета ведёт и на все экзамены, и на свой хаб экзамена", () => {
    for (const pair of ALL_PAIRS) {
      const { container } = render(ExamSubjectHubPage({ params: pair }));
      const ссылки = hrefs(container);

      expect(ссылки, `нет ссылки на /exam/ с ${pair.exam}/${pair.subject}`).toContain("/exam");
      expect(ссылки, `нет ссылки на хаб экзамена с ${pair.exam}/${pair.subject}`).toContain(
        `/exam/${pair.exam}`,
      );
    }
  });
});