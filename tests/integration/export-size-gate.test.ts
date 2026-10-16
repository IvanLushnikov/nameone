/**
 * Предохранитель от лимита Cloudflare Pages.
 *
 * ЗАЧЕМ ТЕСТ. Pages на бесплатном тарифе берёт максимум 20 000 файлов на
 * одну выкатку и УЖИВАЕТСЯ, когда лимит превышен
 * (https://developers.cloudflare.com/pages/platform/limits/). 16.10.2026 сайт
 * разросся, и оба пуша в main упали на шаге Deploy: фронт в прод не уехал,
 * пока выкатку не пересчитали и не урезали (решение владельца — оставить
 * рабочие листы и презентации, убрать страницы «План урока»).
 *
 * ПОЧЕМУ СЧИТАЕМ ДО СБОРКИ. В CI тесты идут ДО `next build`, поэтому каталога
 * `out/` в этот момент ещё нет и проверка готовой сборки была бы пропущена.
 * Здесь размер считается по `generateStaticParams` — это тот же список
 * страниц, из которых Next делает файлы.
 *
 * ЧТО ИМЕННО УЧТЁН. В `out/` страница лежит файлом `.html` и, пока не
 * отработал `scripts/prune-export.mjs`, ещё и её RSC-копия `.txt`. На
 * выкатку уходит уже очищенный каталог, поэтому лимит считается по `.html`,
 * а число RSC-копий идёт справочно. Считать «как на диске» нельзя: сборка
 * тогда сама была бы невыкатываемой, и упираться в лимит пришлось бы не
 * дожидаясь деплоя.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

/** Лимит Cloudflare Pages на бесплатном тарифе, файлов на выкатку. */
const PAGES_FILE_LIMIT = 20000;

/**
 * Файлы, которые Next добавляет помимо страниц: бандл `_next/`, шрифты,
 * картинки, robots.txt, llms.txt, llms-full.txt, манифест, favicon, служебные
 * страницы (главная, тарифы, блог, лендинги). Замер на сборке 16.10.2026 —
 * порядка 800. Взято с запасом: 1 200.
 */
const STATIC_OVERHEAD = 1200;

/**
 * Все динамические роуты: у каждого `generateStaticParams` возвращает список
 * страниц. Пути перечислены явно, и второй тест следит, чтобы новый роут
 * не обошёл список молча.
 */
const PAGED_ROUTES = [
  "src/app/subject/[subject]/page.tsx",
  "src/app/subject/[subject]/[grade]/page.tsx",
  "src/app/subject/[subject]/[grade]/[topic]/page.tsx",
  "src/app/presentation/[subject]/[grade]/[topic]/page.tsx",
  "src/app/ktp/[subject]/[grade]/page.tsx",
  "src/app/exam/[exam]/page.tsx",
  "src/app/exam/[exam]/[subject]/page.tsx",
  "src/app/exam/[exam]/[subject]/[number]/page.tsx",
  "src/app/material/[slug]/page.tsx",
  "src/app/theme/[slug]/page.tsx",
  "src/app/blog/[slug]/page.tsx",
  "src/app/compare/[slug]/page.tsx",
  "src/app/legal/[slug]/page.tsx",
] as const;

type RouteModule = { generateStaticParams?: () => unknown[] };

describe("выкатка влезает в лимит Cloudflare Pages", () => {
  it("каждый динамический роут попадает в список проверяемых", () => {
    // Новый динамический роут, который размножит страницы, обязан попасть
    // в PAGED_ROUTES. Иначе тест продолжил бы считать старый размер и
    // пропустил бы следующий переход через лимит.
    const dynamicRoutes = new Set<string>();

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const full = join(dir, entry.name);
        if (entry.name.startsWith("[")) {
          if (existsSync(join(full, "page.tsx"))) dynamicRoutes.add(full.slice(ROOT.length + 1));
        } else {
          walk(full);
        }
      }
    };

    walk(join(ROOT, "src/app"));

    const accounted = new Set(PAGED_ROUTES.map((p) => p.slice(0, p.indexOf("/page.tsx"))));
    const unaccounted = [...dynamicRoutes].filter((route) => !accounted.has(route));

    expect(
      unaccounted,
      `Эти динамические роуты порождают страницы, но не посчитаны в тесте: ${unaccounted.join(", ")}`,
    ).toEqual([]);
  });

  it("страниц меньше, чем влезает в лимит", async () => {
    const perRoute: Array<{ route: string; count: number }> = [];
    let pages = 0;

    for (const route of PAGED_ROUTES) {
      const mod = (await import(/* @vite-ignore */ join(ROOT, route))) as RouteModule;
      if (typeof mod.generateStaticParams !== "function") continue;
      const count = mod.generateStaticParams().length;
      perRoute.push({ route, count });
      pages += count;
    }

    const deployed = pages + STATIC_OVERHEAD;

    expect(
      deployed,
      `В выкатке ${pages} страниц и примерно ${deployed} файлов, лимит ${PAGES_FILE_LIMIT}. ` +
        `Разложение: ${perRoute.map((r) => `${r.route} — ${r.count}`).join("; ")}`,
    ).toBeLessThan(PAGES_FILE_LIMIT);
  });
});