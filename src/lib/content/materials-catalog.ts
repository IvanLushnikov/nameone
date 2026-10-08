import type { MetadataRoute } from "next";
import type { Difficulty, SubjectSlug, TaskType } from "../types";
import { subjects } from "./subjects";
import { quotedTopic } from "../utils/cn";

/**
 * «Банк материалов» (TZ-15, Фаза 1) — редакционный каталог.
 *
 * Почему он лежит в git, а не в D1: сайт собирается статическим экспортом
 * (`next.config.mjs` → `output: "export"`). Материал, который не лежит в
 * репозитории, не может получить статическую страницу без пересборки.
 * Поэтому Фаза 1 = обычный TypeScript-модуль, из которого билд делает
 * страницы `/material/<slug>/` и URL в `sitemap.xml`.
 *
 * Наполнение НЕ выдумано: записи собираются программно из реальной
 * таксономии `subjects.ts` (1070 тем). Берём темы шагом по предмету
 * (чтобы покрытие шло по всем классам предмета), а заголовок, описание,
 * счётчики и даты детерминированно выводятся из хэша связки
 * «предмет + класс + тема + цель». Один и тот же вход всегда даёт один и
 * тот же результат — иначе ломались бы `generateStaticParams` и sitemap.
 *
 * Фазы 2–3 (авторские публикации, Pages Functions) здесь НЕ реализованы —
 * см. TZ-15 §14.
 */

/** Категория по цели. Ровно пять — как у конкурента (TZ-15 §3.1). */
export type MaterialPurpose = "check" | "explain" | "engage" | "ready" | "decorate";

/** Тип артефакта. `interactive` согласован с TZ-13. */
export type MaterialArtifactType =
  | "worksheet"
  | "test"
  | "control"
  | "lesson-plan"
  | "presentation"
  | "ktp"
  | "interactive"
  | "image";

export interface MaterialEntry {
  /** URL-безопасный уникальный слаг: `<транслит-заголовка>-<hash8>`. */
  slug: string;
  title: string;
  /** 300–800 символов, идёт в meta description. */
  description: string;
  subject: SubjectSlug;
  grade: number;
  topicSlug: string;
  topicTitle: string;
  purpose: MaterialPurpose;
  artifactType: MaterialArtifactType;
  difficulty: Difficulty;
  /** Сколько заданий в материале (идёт в конструктор через `count`). */
  count: number;
  author: string;
  /**
   * Здесь нет рейтинга, счётчика «взяли в работу» и даты обновления — и это
   * сделано намеренно.
   *
   * Все три значения считались из хэша строки каталога, то есть были
   * придуманы: «4,4 по оценке 235 учителей», «312 взяли в работу»,
   * «Обновлён 2025-12-12». За ними нет ни одной настоящей оценки и ни одной
   * реальной правки карточки — в базе нет ни таблицы рейтингов, ни дат
   * редактора. Живой посетитель видел правдоподобные цифры, которых нет.
   *
   * Вернуть любое из этих полей можно только вместе с данными: оценки — с
   * таблицей оценок в БД, дату — с реальной историей правок. Для даты у
   * sitemap уже принято решение не отдавать поле вовсе (см. `src/app/sitemap.ts`).
   */
}

export interface MaterialFilters {
  subject?: SubjectSlug;
  grade?: number;
  purpose?: MaterialPurpose;
  artifactType?: MaterialArtifactType;
}

// ─────────────────────────── Справочники ───────────────────────────

export const MATERIAL_PURPOSE_ORDER: MaterialPurpose[] = [
  "check",
  "explain",
  "engage",
  "ready",
  "decorate",
];

/** Человеческие подписи категорий — для UI и для подписей в sitemap. */
export const MATERIAL_PURPOSE_LABELS: Record<MaterialPurpose, string> = {
  check: "Проверить",
  explain: "Объяснить",
  engage: "Оживить",
  ready: "Под ключ",
  decorate: "Оформить",
};

/** Пояснение категории — одна строка под заголовком блока. */
export const MATERIAL_PURPOSE_HINTS: Record<MaterialPurpose, string> = {
  check: "Контрольные, проверочные и тесты, по которым видно результат класса",
  explain: "Листы и карточки, которые разбирают тему по шагам",
  engage: "Интерактивы и игры, чтобы тему не забыли",
  ready: "Урок целиком: конспект, лист, презентация, раздатка",
  decorate: "Презентации, схемы и наглядные материалы",
};

/** Типы артефактов, характерные для каждой цели. */
const PURPOSE_ARTIFACTS: Record<MaterialPurpose, MaterialArtifactType[]> = {
  check: ["control", "test", "worksheet"],
  explain: ["worksheet", "interactive", "worksheet"],
  engage: ["interactive", "presentation", "interactive"],
  ready: ["lesson-plan", "ktp", "lesson-plan"],
  decorate: ["presentation", "image", "presentation"],
};

/** Человеческое название типа артефакта — вставляется в тексты. */
const ARTIFACT_LABELS: Record<MaterialArtifactType, string> = {
  worksheet: "Рабочий лист",
  test: "Тест с автопроверкой",
  control: "Контрольная работа",
  "lesson-plan": "Конспект урока",
  presentation: "Презентация",
  ktp: "Календарно-тематическое планирование",
  interactive: "Интерактивное задание",
  image: "Набор наглядных материалов",
};

/** Тип артефакта → значение `type=` для конструктора (`DEEP_LINK_TYPES`). */
const ARTIFACT_TO_TASK_TYPE: Record<MaterialArtifactType, TaskType> = {
  worksheet: "worksheet",
  test: "test",
  control: "control",
  "lesson-plan": "lesson-plan",
  presentation: "presentation",
  ktp: "ktp",
  interactive: "interactive",
  image: "image",
};

const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];

const DIFFICULTY_WORDS: Record<Difficulty, string> = {
  easy: "лёгкий",
  medium: "средний",
  hard: "повышенный",
};

/**
 * Родительный падеж для SEO-заголовков («контрольная работа **по математике**»).
 * Только для предметов, которые реально попадают в каталог.
 */
const SUBJECT_DATIVE: Partial<Record<SubjectSlug, string>> = {
  math: "математике",
  algebra: "алгебре",
  geometry: "геометрии",
  russian: "русскому языку",
  literature: "литературе",
  english: "английскому языку",
  informatics: "информатике",
  physics: "физике",
  chemistry: "химии",
  biology: "биологии",
  geography: "географии",
  history: "истории",
  okruzhaet: "окружающему миру",
};

/** Шаблоны SEO-заголовков по цели. `{t}` — тема, `{g}` — класс, `{d}` — дательный падеж. */
const TITLE_PATTERNS: Record<MaterialPurpose, string[]> = {
  check: [
    "Контрольная работа по {d}, {g} класс: {t}",
    "Проверочная работа по {d}, {g} класс: {t}",
    "Тест по {d}, {g} класс: {t}",
    "Самостоятельная работа по {d}, {g} класс: {t}",
  ],
  explain: [
    "Рабочий лист по {d}, {g} класс: {t}",
    "Карточки для закрепления темы {tq}, {d}, {g} класс",
    "Разбор темы {tq}: рабочий лист для {g} класса",
    "Практикум по теме {tq}, {g} класс",
  ],
  engage: [
    "Интерактив по теме {tq}, {d}, {g} класс",
    "Игра-тренажёр по теме {tq} для {g} класса",
    "Онлайн-задания по теме {tq}, {d}, {g} класс",
  ],
  ready: [
    "Урок по теме {tq} под ключ: {d}, {g} класс",
    "Конспект урока по теме {tq}, {g} класс",
    "Комплект к уроку по теме {tq}, {d}, {g} класс: план, лист и презентация",
  ],
  decorate: [
    "Презентация по теме {tq}, {d}, {g} класс",
    "Наглядные материалы по теме {tq}, {g} класс",
    "Дидактические карточки по теме {tq} для {g} класса",
  ],
};

/** Открывающая фраза описания — по одной на категорию, на 5 вариантов. */
const DESCRIPTION_OPENINGS: Record<MaterialPurpose, string[]> = {
  check: [
    "{a} для {g} класса по теме {tq}: {n} заданий, ответы в конце, можно печатать и отдавать ученикам как есть.",
    "Готовая проверка знаний по теме {tq}, {g} класс. {n} заданий разной сложности, ответы с разбором.",
    "Диагностика темы {tq} для {g} класса: {n} заданий, {dw} уровень, та же печатная форма, что и на классной работе.",
    "Контроль по предмету «{s}», {g} класс, тема {tq}. {n} заданий, отдельный ответник для учителя.",
    "Экспресс-опрос по теме {tq} для {g} класса — {n} заданий, чтобы за пять минут понять, что нужно повторить.",
  ],
  explain: [
    "{a}, которая объясняет тему {tq} по шагам: сначала правило, потом пример, потом задание.",
    "Для {g} класса: разбор темы {tq} с опорными схемами и {n} заданиями на закрепление.",
    "Пояснительные карточки по теме {tq} — каждый блок отвечает на один вопрос, всего {n} блоков.",
    "Разбор сложного места в теме {tq}: {n} заданий, к каждому ответу добавлен комментарий.",
    "Тема {tq} для {g} класса разложена на {n} шагов — подходит, если класс идёт медленнее программы.",
  ],
  engage: [
    "Интерактив по теме {tq}: {n} экранов, где ученик отвечает и сразу видит, где ошибся.",
    "Игра, в которой {g} класс повторяет {tq}: карточки соревнуются между собой, учитель не вмешивается.",
    "Живой формат для темы {tq}: {n} заданий с мгновенной проверкой, работает в парах и в общем классе.",
    "{a} для урока, который не забывается: тема {tq}, {n} шагов, обратная связь после каждого.",
    "Ученики не скучают: тема {tq} в формате «проверь себя за десять минут», {n} заданий.",
  ],
  ready: [
    "Урок по теме {tq} целиком: {a} на 45 минут по ФГОС, с целями, ходом урока и приложением.",
    "Готовый урок для {g} класса: {n} заданий, конспект и презентация. Тема {tq}, всё в одном месте.",
    "Конспект урока по теме {tq} с приложением: {n} заданий, ответы, ход урока на 45 минут.",
    "{g} класс, тема {tq} — комплект на одну тему: план, лист и презентация, что обычно ищут в начале года.",
    "Берёте и ведёте: урок по теме {tq} с технологической картой и раздаткой на {n} заданий.",
  ],
  decorate: [
    "{a} по теме {tq}: {n} наглядных материалов, которые можно вставить в свою презентацию.",
    "Визуальная опора для темы {tq}: {n} схем и иллюстраций, {g} класс, всё в одном файле.",
    "Оформление для темы {tq}: наглядные материалы и схемы, которые закрывают вопросы класса.",
    "Дидактические карточки по теме {tq} для {g} класса: {n} штук, наглядно и крупно.",
    "Иллюстративный ряд по теме {tq}: {n} изображений с подписями, {g} класс.",
  ],
};

const DESCRIPTION_DETAILS = [
  "Все задания в одном файле: сначала короткая теория, потом практика, потом ответы.",
  // Раньше здесь стояло «поля под скрепку, шрифт 14». В выгрузке A4 и поля
  // 1000 twips ≈ 1,8 см со всех сторон (левое не шире правого, скрепка
  // не предусмотрена), а размер шрифта в листе плавает между 10 и 12 pt.
  // Учитель печатает лист и получает не то, что обещали, — обещаем ровно то,
  // что делает генератор.
  "Формат печати A4, поля по 1,8 см со всех сторон — входит в раздаточный комплект.",
  "Ответы вынесены на отдельную страницу, чтобы листы можно было раздать не переворачивая.",
  "Базовый и повышенный уровень в одном материале: задания можно брать выборочно.",
];

/**
 * Деталь с привязкой к разделу ФГОС. Раньше она была в общем списке и
 * показывалась только карточкам с реальной ссылкой на раздел — из-за этого
 * 110 карточек из 150 остались вообще без детали, и описание коротило до
 * 170 символов, а добить его можно было только выдуманной фразой.
 * Тема действительно привязана к разделу программы — ссылка есть в таксономии.
 */
const DESCRIPTION_DETAILS_FGOS = ["Тема привязана к разделу программы «{f}»."];

const DESCRIPTION_CTAS = [
  "Сгенерируйте такой же материал под свой класс за 30 секунд — конструктор откроется с уже выбранной темой.",
  "С этой темой и уровнем можно собрать свой вариант за 30 секунд в конструкторе.",
  "Нужен такой же, но под другой класс? Конструктор подставит тему, класс и формат за один клик.",
  "Материал открыт как образец: берите тему и формат, а задания собирайте под свой класс.",
];

/**
 * Сколько карточек берём по каждому предмету. Минимум — предметы из ТЗ:
 * математика, русский язык, литературное чтение (в нашей таксономии это
 * `literature`), окружающий мир, английский, биология, история, география,
 * информатика, физика, химия. Алгебра и геометрия добавлены, чтобы
 * 7–11 классы тоже были плотно закрыты.
 */
const SUBJECT_TARGETS: Array<{ subject: SubjectSlug; count: number }> = [
  // Сумма = 150 записей. Это ровно цифра из DoD ТЗ-15 §13 (Этап 2):
  // «out/material/ содержит 150 папок, sitemap содержит 150 URL».
  // Первая версия каталога давала 132 — недобор закрыт перераспределением
  // между предметами, а не добавлением выдуманных тем: лишние записи берут
  // реальные темы из `subjects.ts`, которых там 1070.
  { subject: "math", count: 14 },
  { subject: "russian", count: 14 },
  { subject: "english", count: 12 },
  { subject: "biology", count: 12 },
  { subject: "history", count: 12 },
  { subject: "geography", count: 12 },
  { subject: "informatics", count: 12 },
  { subject: "physics", count: 12 },
  { subject: "literature", count: 11 },
  { subject: "okruzhaet", count: 11 },
  { subject: "chemistry", count: 11 },
  { subject: "algebra", count: 9 },
  { subject: "geometry", count: 8 },
];

const EDITORIAL_AUTHOR = "Редакция УчЛист";

// ─────────────────────────── Утилиты ───────────────────────────

/**
 * Транслитерация кириллицы в латиницу. Своя функция — новая зависимость не нужна.
 * Всегда приводит к нижнему регистру: используется только для слагов.
 */
const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh",
  з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts",
  ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu",
  я: "ya",
};

export function translit(input: string): string {
  let out = "";
  for (const ch of input.toLowerCase()) {
    // Тире в тексте — типографское, в URL оно недопустимо: из заголовка
    // «1–10 класс» должен получиться slug «1-10», а не «1–10».
    out += ch === "\u2013" || ch === "\u2014" ? "-" : TRANSLIT[ch] ?? ch;
  }
  return out;
}

/** FNV-1a, 32 бита. Детерминированный — от него зависят слаг и счётчики. */
function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** `<транслит-заголовка>-<hash8>` — формат URL у конкурента (TZ-15 §3.1). */
export function makeMaterialSlug(title: string, seed: string): string {
  const base = translit(title)
    .replace(/[^a-z0–9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70)
    .replace(/-+$/g, "");
  return `${base || "material"}-${hash32(seed).toString(16).padStart(8, "0")}`;
}

/**
 * Обрезает описание до 800 символов.
 *
 * Добивки до 300 символов больше НЕТ. Раньше она дописывала одну и ту же
 * фразу «Материал проверен на школьных классах и печатается без подготовки» —
 * про школьные классы никто не проверял, и при описании около 250 символов
 * фраза попадала в текст дважды подряд. Длина описания теперь такая, какая
 * получилась из фактов о карточке; тест ниже держит нижнюю границу.
 */
function fitDescription(text: string): string {
  let out = text.replace(/\s+/g, " ").trim();
  if (out.length > 800) {
    out = out.slice(0, 800);
    const cut = out.lastIndexOf(" ");
    if (cut > 300) out = out.slice(0, cut);
  }
  return out;
}

function buildDescription(ctx: {
  purpose: MaterialPurpose;
  topicTitle: string;
  subjectTitle: string;
  grade: number;
  count: number;
  difficulty: Difficulty;
  fgosRef?: string;
  h: number;
}): string {
  const {
    purpose, topicTitle, subjectTitle, grade, count, difficulty, fgosRef, h,
  } = ctx;

  const openings = DESCRIPTION_OPENINGS[purpose];
  const opening = openings[h % openings.length];
  const detail = DESCRIPTION_DETAILS[(h >>> 4) % DESCRIPTION_DETAILS.length];
  const cta = DESCRIPTION_CTAS[(h >>> 8) % DESCRIPTION_CTAS.length];
  const format = (template: string): string =>
    template
      .replace(/\{a\}/g, ARTIFACT_LABELS[artifactFor(ctx)])
      .replace(/\{tq\}/g, quotedTopic(topicTitle))
      .replace(/\{t\}/g, topicTitle)
      .replace(/\{s\}/g, subjectTitle)
      .replace(/\{g\}/g, String(grade))
      .replace(/\{n\}/g, String(count))
      .replace(/\{dw\}/g, DIFFICULTY_WORDS[difficulty])
      .replace(/\{f\}/g, fgosRef ?? "");

  // Деталь про содержание файла показываем ВСЕГДА: раньше единственная
  // деталь жила в общем списке с плейсхолдером «{f}», и карточки без ссылки
  // на раздел ФГОС оставались вовсе без неё — описание коротило до 170
  // символов. Привязку к разделу добавляем сверху, когда ссылка реальная.
  const parts = [format(opening), format(detail)];
  if (fgosRef) parts.push(format(DESCRIPTION_DETAILS_FGOS[0]));
  parts.push(format(cta));
  return fitDescription(parts.join(" "));
}

/** Тип артефакта записи — нужен и заголовку, и описанию, и CTA. */
function artifactFor(ctx: { purpose: MaterialPurpose; grade: number; h: number }): MaterialArtifactType {
  const candidates = PURPOSE_ARTIFACTS[ctx.purpose].filter(
    // КТП по начальной школе — нелепость, выкидываем на 1–4 классах.
    (a) => !(a === "ktp" && ctx.grade < 5),
  );
  return candidates[ctx.h % candidates.length];
}

// ─────────────────────────── Сборка каталога ───────────────────────────

interface Draft {
  subject: SubjectSlug;
  subjectTitle: string;
  grade: number;
  topicSlug: string;
  topicTitle: string;
  fgosRef?: string;
  purpose: MaterialPurpose;
}

/**
 * Шаг по плоскому списку тем предмета: так карточки распределяются по всем
 * классам предмета, а не скапливаются в одном.
 */
function pickTopics<T>(items: T[], count: number): T[] {
  if (items.length <= count) return [...items];
  const picked: T[] = [];
  const used = new Set<number>();
  for (let i = 0; i < count; i++) {
    let idx = Math.floor(((i + 0.5) * items.length) / count);
    if (idx >= items.length) idx = items.length - 1;
    // Два соседних шага теоретически могут сойтись — сдвигаем вперёд.
    while (used.has(idx)) {
      idx = (idx + 1) % items.length;
    }
    used.add(idx);
    picked.push(items[idx]);
  }
  return picked;
}

function buildDrafts(): Draft[] {
  const drafts: Draft[] = [];
  for (const target of SUBJECT_TARGETS) {
    const subject = subjects.find((s) => s.slug === target.subject);
    if (!subject) continue;

    const flat: Array<{
      grade: number;
      topicSlug: string;
      topicTitle: string;
      fgosRef?: string;
    }> = [];
    for (const g of subject.grades) {
      for (const t of g.topics) {
        flat.push({ grade: g.num, topicSlug: t.slug, topicTitle: t.title, fgosRef: t.fgosRef });
      }
    }

    for (const item of pickTopics(flat, target.count)) {
      const seed = `${subject.slug}:${item.grade}:${item.topicSlug}`;
      const h = hash32(seed);
      drafts.push({
        subject: subject.slug,
        subjectTitle: subject.title,
        grade: item.grade,
        topicSlug: item.topicSlug,
        topicTitle: item.topicTitle,
        fgosRef: item.fgosRef,
        // Цели чередуются по каталогу — все пять категорий покрыты равномерно.
        purpose: MATERIAL_PURPOSE_ORDER[drafts.length % MATERIAL_PURPOSE_ORDER.length],
      });
    }
  }
  return drafts;
}

function buildCatalog(): MaterialEntry[] {
  const seenSlugs = new Set<string>();
  const seenTitles = new Set<string>();
  const entries: MaterialEntry[] = [];

  for (const draft of buildDrafts()) {
    const seed = `${draft.subject}:${draft.grade}:${draft.topicSlug}:${draft.purpose}`;
    const h = hash32(seed);
    const artifactType = artifactFor({ purpose: draft.purpose, grade: draft.grade, h });
    const difficulty = DIFFICULTIES[(h >>> 12) % DIFFICULTIES.length];
    const count = 8 + ((h >>> 16) % 5) * 2; // 8, 10, 12, 14, 16 — валидно для конструктора
    const dative = SUBJECT_DATIVE[draft.subject] ?? draft.subjectTitle.toLowerCase();

    const patterns = TITLE_PATTERNS[draft.purpose];
    let title = patterns[(h >>> 20) % patterns.length]
      .replace(/\{tq\}/g, quotedTopic(draft.topicTitle))
      .replace(/\{t\}/g, draft.topicTitle)
      .replace(/\{g\}/g, String(draft.grade))
      .replace(/\{d\}/g, dative);
    if (seenTitles.has(title)) {
      title = `${title} — ${ARTIFACT_LABELS[artifactType].toLowerCase()}`;
    }
    seenTitles.add(title);

    let slug = makeMaterialSlug(title, seed);
    if (seenSlugs.has(slug)) {
      // Практически недостижимо (в seed входит тема), но дубли в slug ломают
      // generateStaticParams — поэтому страхуемся детерминированным суффиксом.
      slug = `${slug}-${seenSlugs.size + 2}`;
    }
    seenSlugs.add(slug);

    entries.push({
      slug,
      title,
      description: buildDescription({
        purpose: draft.purpose,
        topicTitle: draft.topicTitle,
        subjectTitle: draft.subjectTitle,
        grade: draft.grade,
        count,
        difficulty,
        fgosRef: draft.fgosRef,
        h,
      }),
      subject: draft.subject,
      grade: draft.grade,
      topicSlug: draft.topicSlug,
      topicTitle: draft.topicTitle,
      purpose: draft.purpose,
      artifactType,
      difficulty,
      count,
      author: EDITORIAL_AUTHOR,
    });
  }

  return entries;
}

/** Редакционный каталог. Порядок — по предметам, внутри предмета по классам. */
export const MATERIALS_CATALOG: MaterialEntry[] = buildCatalog();

// ─────────────────────────── Геттеры ───────────────────────────

export function getMaterialBySlug(slug: string): MaterialEntry | undefined {
  return MATERIALS_CATALOG.find((m) => m.slug === slug);
}

/**
 * Фильтр каталога. Порядок — редакционный (предмет → класс), а не
 * «по популярности»: счётчика использования больше нет, а придумывать
 * вместо него другой «популярный» признак нельзя — учитель сразу видит,
 * что порядок случайный.
 */
export function getMaterialsByFilters(filters: MaterialFilters): MaterialEntry[] {
  return MATERIALS_CATALOG.filter(
    (m) =>
      (filters.subject === undefined || m.subject === filters.subject) &&
      (filters.grade === undefined || m.grade === filters.grade) &&
      (filters.purpose === undefined || m.purpose === filters.purpose) &&
      (filters.artifactType === undefined || m.artifactType === filters.artifactType),
  );
}

/**
 * Первые N карточек каталога — для главной и топ-категорий хаба.
 * Это НЕ «популярное»: берём первые N в редакционном порядке. Название
 * про «популярность» пришлось убрать вместе с выдуманным счётчиком.
 */
export function getFeaturedMaterials(limit: number): MaterialEntry[] {
  return MATERIALS_CATALOG.slice(0, limit);
}

export function getMaterialsByPurpose(purpose: MaterialPurpose, limit?: number): MaterialEntry[] {
  const items = getMaterialsByFilters({ purpose });
  return limit ? items.slice(0, limit) : items;
}

/** Сколько карточек по предмету — для «топ-предметов» на хабе. */
export function getSubjectCounts(): Array<{ subject: SubjectSlug; count: number }> {
  const counts = new Map<SubjectSlug, number>();
  for (const m of MATERIALS_CATALOG) {
    counts.set(m.subject, (counts.get(m.subject) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([subject, count]) => ({ subject, count }))
    .sort((a, b) => b.count - a.count);
}

/** Ссылка в конструктор с уже подставленными параметрами (TZ-15 §5.4). */
export function materialConstructorHref(m: MaterialEntry): string {
  const params = new URLSearchParams({
    subject: m.subject,
    grade: String(m.grade),
    topic: m.topicSlug,
    type: ARTIFACT_TO_TASK_TYPE[m.artifactType],
    difficulty: m.difficulty,
    count: String(m.count),
  });
  return `/constructor?${params.toString()}`;
}

/** Человеческое название типа артефакта — для подписей на карточках. */
export function materialArtifactLabel(type: MaterialArtifactType): string {
  return ARTIFACT_LABELS[type];
}

/**
 * Запись sitemap для одной карточки (TZ-15 §5.4).
 *
 * `lastModified` и `changeFrequency` здесь больше нет: дата была посчитана из
 * хэша строки, то есть выдумана. Ровно ту же логику для остальной карты уже
 * зафиксировали в `src/app/sitemap.ts` — не отдавать поле честнее, чем отдавать
 * враньё.
 */
export function materialToSitemapEntry(m: MaterialEntry, base: string): MetadataRoute.Sitemap[number] {
  return {
    url: `${base}/material/${m.slug}/`,
    priority: 0.7,
  };
}
