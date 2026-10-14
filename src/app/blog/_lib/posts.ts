/**
 * Загрузка постов блога.
 *
 * КАК ДОБАВИТЬ ПОСТ. Положить файл `src/app/blog/posts/<slug>.md` — и всё.
 * Никаких правок кода: ни здесь, ни в `sitemap.ts`, ни в списке на `/blog/`.
 * Файл читается на этапе сборки, поэтому новый пост попадает в выгрузку сам.
 *
 * ПОЧЕМУ ФАЙЛЫ, А НЕ ОДНА ТАБЛИЦА. Пост — это 1200–2000 слов. Держать четыре
 * таких текста в одном модуле значит держать в нём ещё разметку, дату,
 * og-картинку и ссылки. Правка одного поста задевает остальные: общий номер
 * строки, общий diff, общий review. По файлу на пост — обычная практика
 * статических генераторов, и ревьюится пост целиком.
 *
 * ПОЧЕМУ ЧТЕНИЕ С ДИСКА. Статический экспорт: страницу нельзя наполнять из
 * базы или API в рантайме — на Cloudflare Pages нет Node. Значит, список
 * постов должен появиться на этапе сборки. Каталог читается `readdirSync`,
 * тело — `readFileSync`. В рантайме страницы filesystem не нужен вообще.
 * Бонус: у поста появляется настоящий git-дифф построчно, а не «один файл
 * изменился целиком».
 *
 * ФОРМАТ ФАЙЛА. YAML-фронтматтер (без зависимостей: парсится здесь, вручную,
 * шесть строк) и markdown-тело. Поддерживаемые поля — см. тип `BlogPostMeta`.
 */

import fs from "node:fs";
import path from "node:path";
import { renderMarkdown } from "./markdown";

export type BlogPostMeta = {
  /** Адрес поста. Равен имени файла без `.md` — иначе ссылка разойдётся с папкой. */
  slug: string;
  /** ≤60 символов, с главным поисковым запросом. Проверяется на сборке. */
  title: string;
  /** 155–160 символов. Проверяется на сборке. */
  description: string;
  /** Дата публикации, `ГГГГ-ММ-ДД`. Сортировка по ней, из неё же `datePublished`. */
  date: string;
  /** Рубрика для списка. Свободная строка: новую рубрику заводить не нужно. */
  category: string;
  /** Путь к PNG в `public/`, без домена. */
  ogImage: string;
};

export type BlogPost = BlogPostMeta & {
  /** Тело поста, готовый HTML. Рендерится через `dangerouslySetInnerHTML`. */
  html: string;
};

const POSTS_SUBDIR = path.join("src", "app", "blog", "posts");

const REQUIRED_FIELDS = ["title", "description", "date", "category", "ogImage"] as const;

/**
 * Каталог с постами. Прямой путь от `process.cwd()` — обычный случай; если
 * генерация пойдёт из другого каталога, поднимаемся вверх до корня
 * репозитория. Глубже шести уровней не идём: репозиторий плоский.
 */
function resolvePostsDir(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    const candidate = path.join(dir, POSTS_SUBDIR);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Каталог постов не найден: ожидался ${POSTS_SUBDIR} от корня репозитория`);
}

/**
 * Фронтматтер: блок `---` в начале файла, поля вида `ключ: значение`.
 * Значение — одна строка; кавычки и хвостовые пробелы снимаются.
 * Поддержки вложенности и списков здесь намеренно нет: у поста шесть полей,
 * и любая избыточность в парсере — это то, что придётся чинить.
 */
function parseFrontmatter(raw: string, slug: string): { fields: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!match) {
    throw new Error(`Пост ${slug}.md: нет фронтматтера. Файл должен начинаться со строки «---»`);
  }
  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const sep = line.indexOf(":");
    if (sep === -1) {
      throw new Error(`Пост ${slug}.md: строка фронтматтера без «:» — «${line}»`);
    }
    const key = line.slice(0, sep).trim();
    let value = line.slice(sep + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    fields[key] = value;
  }
  return { fields, body: raw.slice(match[0].length) };
}

function readPost(slug: string): BlogPost {
  const file = path.join(resolvePostsDir(), `${slug}.md`);
  const { fields, body } = parseFrontmatter(fs.readFileSync(file, "utf8"), slug);

  for (const field of REQUIRED_FIELDS) {
    if (!fields[field]) throw new Error(`Пост ${slug}.md: не заполнено поле «${field}»`);
  }

  const html = renderMarkdown(body);
  if (html.replace(/<[^>]+>/g, "").trim().length < 400) {
    throw new Error(`Пост ${slug}.md: тело почти пустое — похоже на заглушку`);
  }

  return { slug, ...fields, html } as BlogPost;
}

/** Слаги всех постов: имена файлов без расширения, по алфавиту. */
export function getPostSlugs(): string[] {
  return fs
    .readdirSync(resolvePostsDir())
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.slice(0, -".md".length))
    .sort();
}

/** Один пост по слагу. `null`, если файла нет — страница отдаёт 404. */
export function getPost(slug: string): BlogPost | null {
  if (!getPostSlugs().includes(slug)) return null;
  return readPost(slug);
}

/** Все посты, свежие сверху. */
export function getAllPosts(): BlogPost[] {
  return getPostSlugs()
    .map(readPost)
    .sort((a, b) =>
      a.date === b.date ? a.slug.localeCompare(b.slug) : b.date.localeCompare(a.date),
    );
}

/** Соседи поста для блока «Что почитать ещё»: тот же список без самого поста. */
export function getRelatedPosts(currentSlug: string, limit = 3): BlogPost[] {
  return getAllPosts()
    .filter((p) => p.slug !== currentSlug)
    .slice(0, limit);
}

/** «14 октября 2026» — по-русски, без `Intl` (в разметке локаль сервера не задана). */
export function formatDate(iso: string): string {
  const months = [
    "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря",
  ];
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`;
}