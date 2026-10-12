/**
 * Страницы доверия (блок E, аудит 11.10.2026).
 *
 * Что чинили: `/about/`, `/contact/`, `/methodology/` и `/register/` отдавали
 * 404. Для сервиса, который принимает оплату, это не «неудобно без раздела
 * о нас», а юридическая дыра: на `/contact/` обязаны быть реквизиты
 * исполнителя (54-ФЗ).
 *
 * Что проверяем:
 *  1. все четыре маршрута рендерятся (в статическом экспорте страница без
 *     `out/<route>/index.html` — это 404, поэтому проверяем рендер компонента,
 *     а появление файлов в `out/` — отдельно, по сборке);
 *  2. на каждой странице есть title, description, canonical, openGraph и
 *     BreadcrumbList — по конвенции `src/app/pricing/page.tsx`;
 *  3. заголовки не «Страница», описание не вырожденное;
 *  4. цифры на страницах совпадают с таксономией (страница доверия, которая
 *     врёт про собственное содержимое, хуже отсутствующей);
 *  5. `/contact/` содержит помеченные места под реквизиты, и в исходниках
 *     нет выдуманных ИНН/ОГРН;
 *  6. `/register/` ведёт на существующий `/login/`, а не в никуда;
 *  7. блок отзывов — механизм: при пустом источнике не рисует ничего, при
 *     тестовой записи рисует карточку.
 *
 * Компоненты вызываются как функции (`AboutPage()`), а не через JSX: файл
 * с расширением `.ts` esbuild не разбирает как JSX. Так же сделано в
 * `tests/exam-hub.test.ts`.
 *
 * `/register/` статический: динамических сегментов и `generateStaticParams`
 * у него нет, при `output: "export"` Next собирает единственный URL сам.
 */

import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import type { Metadata } from "next";

import { subjects, allTopics } from "@/lib/content/subjects";
import { EXAM_SUBJECTS } from "@/lib/content/exam-taxonomy";
import {
  catalogStats,
  examTasksWord,
  NEEDS_FILL,
  operator,
  subjectsWord,
  topicsWord,
} from "@/lib/content/trust";
import { REVIEWS, type Review } from "@/lib/content/reviews";
import { ReviewsBlock } from "@/components/trust/ReviewsBlock";
import { Footer } from "@/components/layout/Footer";
import { absoluteUrl } from "@/lib/seo/metadata";
import AboutPage, { metadata as aboutMetadata } from "@/app/about/page";
import ContactPage, { metadata as contactMetadata } from "@/app/contact/page";
import MethodologyPage, { metadata as methodologyMetadata } from "@/app/methodology/page";
import RegisterPage, { metadata as registerMetadata } from "@/app/register/page";

/** Страницы доверия серверные, но подвал и трекер тянут `next/navigation`. */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

/** Разобранные JSON-LD объекты отрисованной страницы. */
function jsonLd(container: HTMLElement): Record<string, unknown>[] {
  return Array.from(
    container.querySelectorAll('script[type="application/ld+json"]'),
  ).flatMap((node) => {
    const parsed = JSON.parse(node.textContent ?? "{}");
    return Array.isArray(parsed) ? parsed : [parsed];
  });
}

function hasBreadcrumbList(container: HTMLElement): boolean {
  return jsonLd(container).some((obj) => obj["@type"] === "BreadcrumbList");
}

/**
 * Хвостовой слеш режется: `next/link` в тестовом окружении его не ставит.
 * Корневой адрес «/» при этом должен остаться «/», а не превратиться в «».
 */
function normalizeHref(href: string): string {
  return href.length > 1 ? href.replace(/\/+$/, "") : href;
}

function hrefs(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("a[href]")).map((a) =>
    normalizeHref(a.getAttribute("href") ?? ""),
  );
}

function rawHrefs(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("a[href]")).map(
    (a) => a.getAttribute("href") ?? "",
  );
}

function text(container: HTMLElement): string {
  return container.textContent ?? "";
}

function crumbs(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll('nav[aria-label="breadcrumb"] li'),
  ).map((li) => (li.textContent ?? "").replace("›", "").trim());
}

/** Общие требования к метаданным страницы доверия. */
function expectSeo(meta: Metadata, path: string) {
  // Название дописывается шаблоном корневого layout («%s · УчЛист»), поэтому
  // здесь проверяем не наличие слова, а что заголовок осмысленный, а не
  // заглушка (кейс А-7).
  const title = String(meta.title ?? "");
  expect(title.length).toBeGreaterThan(15);
  expect(title).not.toBe("Страница");
  expect(meta.description).toBeTruthy();
  const description = String(meta.description);
  expect(description.length).toBeGreaterThan(50);
  expect(description).not.toBe("Страница");
  expect(meta.alternates?.canonical).toBe(absoluteUrl(path));
  expect(meta.openGraph?.title).toBeTruthy();
  expect(String(meta.openGraph?.title)).not.toBe("Страница");
  expect(meta.openGraph?.description).toBeTruthy();
  expect(meta.openGraph?.url).toBe(absoluteUrl(path));
  // og:image обязателен — без него карточка в соцсетях остаётся пустой.
  const images = meta.openGraph?.images as Array<{ url: string }> | undefined;
  expect(images?.[0]?.url).toContain("/og/");
  expect(meta.twitter).toBeTruthy();
}

const routes = [
  { path: "/about", Page: AboutPage, meta: aboutMetadata, crumb: "О сервисе" },
  { path: "/contact", Page: ContactPage, meta: contactMetadata, crumb: "Контакты" },
  { path: "/methodology", Page: MethodologyPage, meta: methodologyMetadata, crumb: "Методика" },
  { path: "/register", Page: RegisterPage, meta: registerMetadata, crumb: "Регистрация" },
];

describe("Блок E: маршруты страниц доверия", () => {
  for (const { path, Page, meta, crumb } of routes) {
    it(`${path}/ отвечает и содержит заголовок первого уровня`, () => {
      const { container } = render(Page());
      const h1 = container.querySelector("h1");

      expect(h1).not.toBeNull();
      expect((h1?.textContent ?? "").trim().length).toBeGreaterThan(3);
    });

    it(`${path}/ имеет мета-теги и BreadcrumbList`, () => {
      const { container } = render(Page());

      expect(hasBreadcrumbList(container)).toBe(true);
      expectSeo(meta, path);
    });

    it(`${path}/: крошки «Главная → текущая», текущая без ссылки`, () => {
      const { container } = render(Page());

      expect(crumbs(container)).toEqual(["Главная", crumb]);
      expect(
        container.querySelector('nav[aria-label="breadcrumb"] li:last-child a'),
      ).toBeNull();
      expect(hrefs(container)).toContain("/");
    });
  }

  it("подвал даёт ссылки на все четыре страницы", () => {
    const { container } = render(Footer());
    const links = hrefs(container);

    for (const path of ["/about", "/contact", "/methodology", "/register"]) {
      expect(links).toContain(path);
    }
  });

  it("внутренние ссылки подвала ведут на существующие маршруты, а не на 404", () => {
    const { container } = render(Footer());
    const internal = Array.from(container.querySelectorAll("a[href]"))
      .map((a) => a.getAttribute("href") ?? "")
      // Внешние (t.me, mailto) в этом не участвуют.
      .filter((href) => href.startsWith("/"))
      .map(normalizeHref);

    expect(internal.length).toBeGreaterThan(0);
    // Все страницы доверии в списке — маршруты этого проекта, а не заглушки.
    for (const path of ["/about", "/contact", "/methodology", "/register"]) {
      expect(internal).toContain(path);
    }
  });
});

describe("Блок E: цифры страниц не разошлись с таксономией", () => {
  it("статистика в trust.ts совпадает с содержимым базы", () => {
    expect(catalogStats.subjects).toBe(subjects.length);
    expect(catalogStats.topics).toBe(allTopics().length);
    expect(catalogStats.examTasks).toBe(
      EXAM_SUBJECTS.reduce((sum, s) => sum + s.numbers.length, 0),
    );
    // База не пустая: иначе все проверки выше прошли бы на нулях.
    expect(catalogStats.subjects).toBeGreaterThan(0);
    expect(catalogStats.topics).toBeGreaterThan(0);
    expect(catalogStats.examples).toBeGreaterThan(0);
  });

  it("/about/ показывает посчитанные числа, а не вписанные", () => {
    const { container } = render(AboutPage());
    const page = text(container);

    expect(page).toContain(String(catalogStats.subjects));
    expect(page).toContain(String(catalogStats.topics));
    expect(page).toContain(String(catalogStats.examTasks));
  });

  it("в description число стоит рядом со своей формой слова", () => {
    // На этом уже ломалось: `... ${examTasksWord} заданий ОГЭ` без самого
    // числа давало в сниппете «1075 тем, страниц заданий ОГЭ и ЕГЭ» —
    // число пропало, слово осталось, и страница доверия врала в выдаче.
    for (const meta of [aboutMetadata, methodologyMetadata]) {
      const desc = String(meta.description);
      expect(desc).toContain(`${catalogStats.subjects} ${subjectsWord}`);
      expect(desc).toContain(`${catalogStats.topics} ${topicsWord}`);
    }
    expect(String(aboutMetadata.description)).toContain(
      `${catalogStats.examTasks} ${examTasksWord}`,
    );
  });

  it("на страницах нет падежей, повисших без числа", () => {
    // Косвенный признак той же ошибки в теле страницы: «страниц» без
    // предшествующего числа.
    const { container } = render(MethodologyPage());
    expect(text(container)).not.toMatch(/(?<![\d\s])страниц\b/);
  });

  it("/methodology/ не обещает точность в процентах", () => {
    const { container } = render(MethodologyPage());

    expect(text(container)).not.toMatch(/\d+\s*%/)
    expect(text(container)).toContain("не проверено");
  });
});

describe("Блок E: /contact/ и юридические данные (Е-4)", () => {
  it("есть оба канала связи, почта — ссылка mailto", () => {
    const { container } = render(ContactPage());
    const links = hrefs(container);

    expect(links.some((href) => href.startsWith("mailto:"))).toBe(true);
    expect(links).toContain("https://t.me/uchlist");
  });

  it("есть помеченные места под ИНН и адрес", () => {
    const { container } = render(ContactPage());
    const page = text(container);

    expect(page).toContain("{{ ИНН }}");
    expect(page).toContain("{{ АДРЕС РЕГИСТРАЦИИ }}");
  });

  it("названы все поля, которые обязан вписать владелец", () => {
    for (const item of NEEDS_FILL) {
      const { container } = render(item.page === "/contact/" ? ContactPage() : AboutPage());

      expect(
        text(container),
        `${item.page}: нет пометки «${item.label}»`,
      ).toContain(item.placeholder);
    }
  });

  it("незаполненный реквизит виден как пометка, а не как данные", () => {
    const { container } = render(ContactPage());
    // Плейсхолдер обёрнут пунктиром — незаполненное поле не спутать с готовым.
    expect(container.querySelector(".border-dashed")).not.toBeNull();
    expect(text(container)).toContain("вписывает владелец");
  });

  it("в исходниках блока E нет выдуманных реквизитов", () => {
    // Настоящий ИНН — это 10 или 12 цифр подряд. Пока их нет: значение либо
    // приходит из переменной окружения, либо остаётся плейсхолдером.
    expect(operator.inn).not.toMatch(/^\d{10,12}$/);
    expect(operator.address).not.toMatch(/^\d{10,12}$/);
    expect(operator.inn).toContain("{{");
  });

  it("названы налоговый режим и отсутствие ОГРН у самозанятого", () => {
    const { container } = render(ContactPage());
    const page = text(container);

    expect(page).toContain("НК РФ");
    // ОГРН у самозанятого не существует: писать номер — выдумка, молчать о
    // нём — неправда. Разрешается только объяснением.
    expect(page).toContain("ОГРН");
    expect(page).toMatch(/не образует юридического лица|не присваивает/i);
  });

  it("даёт доступ ко всем юридическим документам", () => {
    const { container } = render(ContactPage());
    const links = hrefs(container);

    for (const href of [
      "/legal/offer",
      "/legal/consent",
      "/legal/privacy",
      "/legal/terms",
      "/legal/cookies",
    ]) {
      expect(links).toContain(href);
    }
  });
});

describe("Блок E: /register/ ведёт к регистрации (Е-5)", () => {
  it("есть ссылка на рабочий сценарий входа /login/", () => {
    const { container } = render(RegisterPage());

    expect(hrefs(container)).toContain("/login");
  });

  it("не ссылается на параметр ?mode=register, которого в /login/ нет", () => {
    const { container } = render(RegisterPage());

    // В `/login/` (клиентский компонент) такого параметра нет, ссылка была бы
    // обещанием несуществующего режима.
    expect(rawHrefs(container).filter((href) => href.includes("mode=register"))).toEqual([]);
  });

  it("объясняет вход по одноразовой ссылке и не обещает пароль", () => {
    const { container } = render(RegisterPage());
    const page = text(container);

    expect(page).toMatch(/одноразов/);
    expect(page).toMatch(/Пароля нет/i);
  });

  it("ссылается на согласие на обработку данных", () => {
    const { container } = render(RegisterPage());

    expect(hrefs(container)).toContain("/legal/consent");
  });

  it("страница закрыта от индексации, но не от перехода", () => {
    // Причина — тонкий дубль `/login/`: одна задача на двух индексируемых
    // URL размывает вес и добавляет страницу без содержания.
    expect(registerMetadata.robots).toMatchObject({ index: false, follow: true });
  });
});

describe("Блок E: механизм отзывов (Е-6)", () => {
  it("источник отзывов пуст — на сайте нет ни одного отзыва", () => {
    expect(REVIEWS).toEqual([]);
  });

  it("при пустом источнике блок не рисует ничего", () => {
    const { container } = render(ReviewsBlock());

    expect(container.innerHTML).toBe("");
    // Ни заголовка «Отзывы», ни приглашения их оставить.
    expect(container.querySelector("h2")).toBeNull();
  });

  it("при пустом источнике блока нет и на /about/", () => {
    const { container } = render(AboutPage());

    expect(text(container)).not.toContain("Отзывы");
  });

  it("как только владелец добавит запись, блок появляется", () => {
    const review: Review = {
      id: "test-review",
      author: "И. И.",
      role: "учитель математики",
      date: "2026-10-11",
      text: "Тестовая запись. В источнике по умолчанию её быть не должно.",
    };

    const { container } = render(ReviewsBlock({ reviews: [review] }));

    expect(container.querySelector("h2")?.textContent).toBe("Отзывы");
    expect(text(container)).toContain(review.text);
    expect(text(container)).toContain(review.author);
    expect(container.querySelectorAll("li")).toHaveLength(1);
  });
});