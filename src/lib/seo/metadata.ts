/**
 * Общие помощники для метаданных страниц.
 *
 * Зачем файл: ТЗ-21 п.14 (SEO-аудит P1-1…P1-3) требует, чтобы `canonical`
 * стоял на всех страницах, а `og:image` был на всех типах страниц. На момент
 * аудита это правило было написано руками в пяти местах (`/`, `/subject`,
 * `/subject/[s]`, `/subject/[s]/[g]`, `/subject/[s]/[g]/[t]`), а на 2 682
 * страницах его не было вовсе. Копировать паттерн в десять файлов — значит
 * через месяц получить те же дыры в десяти местах, поэтому выносим в один
 * модуль и вызываем оттуда.
 *
 * Три вещи, которые здесь собраны:
 *  1. `absoluteUrl` — адрес страницы от `SITE_URL`. Домен живёт в
 *     `src/lib/site.ts`, и литерал домена в метаданных — это ровно тот
 *     класс ошибки, из-за которого весь SEO-вес ТЗ-21 уехал на временный
 *     `listai-prototype.pages.dev`.
 *  2. `ogImage` — выбор картинки. В `public/og/` лежат 22 готовых PNG
 *     (генератор `scripts/generate-og-images.mjs`): `default.png` и по одному
 *     на предмет. Per-topic и per-grade картинок нет и не будет: 1 070 тем × N
 *     вариантов — это тысячи файлов, а на единицу качества картинки они не
 *     влияют. Поэтому fallback идёт по уровню предмета.
 *  3. `clipDescription` — обрезка описания до лимита сниппета.
 *
 * Хвост режется, а не начало: начало описания — это ключевые слова запроса,
 * обрезать его нельзя. Поисковик всё равно перепишет сниппет по своему, но
 * пока он этого не сделал, первые 150 знаков — это то, что учитель видит.
 */

import { SITE_URL } from "@/lib/site";
import { subjects } from "@/lib/content/subjects";
import { getUMKById } from "@/lib/content/umk";

/** Размеры всех картинок в `public/og/` (генерируются скриптом, 1200×630). */
const OG_SIZE = { width: 1200, height: 630 } as const;

/** Слаги предметов, для которых в `public/og/` реально есть PNG. */
const OG_SUBJECT_SLUGS: ReadonlySet<string> = new Set(subjects.map((s) => s.slug));

/**
 * Имя PNG-файла для предмета.
 *
 * Неизвестный слаг молча уходит на `default.png`, а не на `/og/<slug>.png`,
 * которого нет: битая картинка в соцсети хуже общей карточки бренда.
 * Служебные страницы (`/constructor`, `/login`, `/pricing`) предмета не имеют
 * и получают `default` — это та же карточка, что на главной.
 */
function ogFile(subjectSlug: string | undefined): string {
  return subjectSlug && OG_SUBJECT_SLUGS.has(subjectSlug) ? subjectSlug : "default";
}

/** Абсолютный URL картинки — для `twitter:image`, где нужен голый массив строк. */
export function ogImageUrl(subjectSlug: string | undefined): string {
  return `${SITE_URL}/og/${ogFile(subjectSlug)}.png`;
}

/**
 * `images` для `openGraph`.
 *
 * Возвращается отдельной функцией, а не готовым блоком `openGraph`:
 * блок пришлось бы вставлять спредом внутрь `openGraph`, и `openGraph` с
 * `twitter` оказывались бы вложены уровнем глубже — тег не рендерился бы
 * вовсе, а ошибки не давал бы (собранная страница просто остаётся без
 * картинки). Поэтому собираем `openGraph` на месте вызова, а отсюда берём
 * только содержимое `images`.
 */
export function ogImages(
  subjectSlug: string | undefined,
  alt: string,
): Array<{ url: string; width: number; height: number; alt: string }> {
  return [{ url: ogImageUrl(subjectSlug), ...OG_SIZE, alt }];
}

/** `twitter` — дубль og:image, который требует Twitter Card Validator. */
export function twitterCard(subjectSlug: string | undefined): {
  card: "summary_large_image";
  images: string[];
} {
  return { card: "summary_large_image", images: [ogImageUrl(subjectSlug)] };
}

/**
 * Абсолютный адрес страницы.
 *
 * Слеш в конце — из `trailingSlash: true` в `next.config.mjs`: сайт так
 * отдаёт адреса, и canonical обязан совпадать с фактическим URL, иначе
 * поисковик увидит расхождение и страница получит 301 на саму себя.
 * Next.js нормализует слеш и сам, но полагаться на это в разметке не надо —
 * отсюда явный слеш.
 */
export function absoluteUrl(path: string): string {
  const clean = path === "/" ? "" : `/${path.replace(/^\/+/, "").replace(/\/+$/, "")}`;
  return `${SITE_URL}${clean}/`;
}

/** Готовый блок `alternates` для `Metadata`. */
export function canonical(path: string): { canonical: string } {
  return { canonical: absoluteUrl(path) };
}

/** Слаги предметов с собственной картинкой — для тестов и отладки. */
export function hasOgImage(subjectSlug: string | undefined): boolean {
  return subjectSlug != null && OG_SUBJECT_SLUGS.has(subjectSlug);
}

/**
 * Обрезает описание до лимита сниппета по границе слова.
 *
 * Яндекс обрезает примерно на 160 знаках, Google — на 155–160. Всё, что
 * дальше, в выдаче не показывается, а в исходнике остаётся: 94 % страниц
 * имели описание длиннее 160 (замер SEO-аудита 2026-10-05, P1-2).
 *
 * Многоточие в конце не ставим намеренно: в сниппете многоточие выглядит
 * как обрывок мысли, а аккуратно законченная фраза — как законченная.
 * Обрезка всегда по последнему пробелу, поэтому слово не рвётся.
 */
export function clipDescription(text: string, max = 160): string {
  // В названиях тем встречается HTML-сущность `&nbsp;` (например «Личная
  // безопасность в&nbsp;быту и&nbsp;школе»). В описании это вредно дважды:
  // Next экранирует амперсанд, и в выдаче показывается литерал «&nbsp;»
  // вместо пробела. Заменяем на обычный пробел ДО подсчёта длины — иначе
  // шесть символов занимают место одного, и мы обрезаем раньше времени.
  const flat = text.replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const head = flat.slice(0, max);
  const lastSpace = head.lastIndexOf(" ");
  // Если пробелов нет (одно длинное слово) — режем жёстко.
  return (lastSpace > max * 0.5 ? head.slice(0, lastSpace) : head).trim();
}

/**
 * Хвост заголовка, который разводит страницы с одинаковым названием темы.
 *
 * ТЗ-21 п.22 / SEO-аудит P2-1: 17 групп дублей на 40 страниц. Причина
 * оказалась не в заголовках, а в таксономии — одна и та же тема лежит в
 * нескольких местах:
 *
 *  - у алгебры 7–9 классов тема идёт по УМК: «Степень с натуральным
 *    показателем» есть и у Мерзляка (`m-stepen-natural-7`), и у Алимова
 *    (`a-stepen-natural-7`), и у страницы обе выглядят одинаково;
 *  - «Числа от 1 до 10» лежит и в математике, и в английском;
 *  - «Глобальные проблемы человечества» — и в истории, и в географии.
 *
 * Сами темы из таксономии убирать нельзя: они разные (у них разные УМК,
 * разные задания и разные разделы ФГОС), и ссылки на них уже в обороте.
 * Разводим заголовок — это ровно то, что делает страницу отличимой от
 * соседней по теме же, и заодно добавляет в заголовок предмет, по которому
 * учитель ищет.
 *
 * УМК подставляется только когда он у темы один: у общих тем (без `umk`)
 * дописывать нечего, а у тем с несколькими УМК дописка «Мерзляк, Алимов»
 * выглядела бы как ошибка.
 */
export function topicTitleSuffix(
  subjectSlug: string,
  subjectShortTitle: string,
  gradeNum: number,
  topicUmk: readonly string[] | undefined,
): string {
  const parts = [`${subjectShortTitle}, ${gradeNum} класс`];
  const singleUmk = topicUmk?.length === 1 ? topicUmk[0] : undefined;
  const entry = singleUmk ? getUMKById(subjectSlug, singleUmk) : undefined;
  if (entry) parts.push(entry.short);
  return parts.join(" · ");
}
