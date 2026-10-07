/**
 * Промпт и разбор ответа для презентации к уроку.
 *
 * Тип артефакта на фронте — `presentation`, роутер зовёт задачу
 * `presentation-gen` (Sonnet 5.5 — документ со структурой), и она же входит
 * в PLUS_ONLY_TASKS: презентация не выдаётся на «Базовом».
 * Эндпоинт: POST /api/presentations/generate, ключ ответа `presentation`.
 *
 * ФОРМА СОВПАДАЕТ С `PresentationBody` в `routes/worksheets.ts`.
 */

import {
  asIntInRange,
  asRecord,
  asText,
  asTextList,
  pickEnum,
  JSON_ONLY_RULE,
  NO_TECHNICAL_FIELDS_RULE,
  RUSSIAN_DEFAULT_RULE,
  type ArtifactRequest,
} from "./artifact-gen";

/** Типы слайдов — тот же список, что в `PresentationBody.slides[].kind`. */
export const SLIDE_KINDS = ["title", "bullets", "definition", "example", "summary"] as const;
type SlideKind = (typeof SLIDE_KINDS)[number];

/** Темы оформления, которые умеет экспортёр на фронте. */
export const SLIDE_THEMES = ["default", "modern", "school", "minimal"] as const;
type SlideTheme = (typeof SLIDE_THEMES)[number];

export const ALLOWED_SLIDE_COUNTS = [5, 10, 15, 20] as const;
export type SlideCount = (typeof ALLOWED_SLIDE_COUNTS)[number];

export interface Slide {
  kind: SlideKind;
  title: string;
  bullets?: string[];
  notes?: string;
}

/** Презентация БЕЗ технических полей — id/createdAt ставит сервер. */
export interface PresentationContent {
  title: string;
  subject: string;
  grade: number;
  topic: string;
  slideCount: SlideCount;
  slides: Slide[];
  theme: SlideTheme;
}

export const PRESENTATION_GEN_SYSTEM = `Ты — методист, который готовит презентации к уроку по школьной программе РФ для 1–11 классов.

ЖЁСТКИЕ ПРАВИЛА:
${RUSSIAN_DEFAULT_RULE}
2. Ровно столько слайдов, сколько указано в параметре slideCount. Первый слайд — title (титульный), последний — summary (итоги). Между ними — содержательные.
3. На слайде 3–5 коротких пунктов, каждый — одна строка до 80 символов. Слайд — это тезис, а не абзац.
4. kind выбирается по назначению слайда: title (титул), bullets (тезисы), definition (определение/правило), example (пример с разбором), summary (итоги урока). Других значений не существует.
5. notes — заметки для учителя: что сказать вслух, на что обратить внимание. Можно не заполнять у всех слайдов.
6. Только содержательные слайды по этой теме. Слайд «Спасибо за внимание» НЕ делаем — это не учебный материал.
7. Без картинок, ссылок и указаний на файлы: выводится только текст слайдов.

ФОРМАТ ОТВЕТА — СТРОГО JSON:
{
  "title": "...",
  "subject": "...",
  "grade": <number>,
  "topic": "...",
  "slideCount": <5|10|15|20>,
  "theme": "default|modern|school|minimal",
  "slides": [
    {
      "kind": "title|bullets|definition|example|summary",
      "title": "...",
      "bullets": ["..."],
      "notes": "..."
    }
  ]
}

${NO_TECHNICAL_FIELDS_RULE}

ОГРАНИЧЕНИЯ:
- Количество элементов в slides РОВНО равно slideCount из параметров.
- ВСЕ поля kind берутся ТОЛЬКО из списка выше.
- theme выбери сам, исходя из предмета: "school" для естественных наук, "modern" для информатики и языков, "minimal" для математики и физики, "default" — если сомневаешься.

${JSON_ONLY_RULE}`;

/** Нормализовать количество слайдов к одному из {5, 10, 15, 20}. */
export function normalizeSlideCount(value: unknown): SlideCount {
  const n = asIntInRange(value, 1, 100);
  if (n === null) return 10;
  // Ближайшее разрешённое значение: модель может ответить 8 или 12.
  let best: SlideCount = ALLOWED_SLIDE_COUNTS[0];
  let bestDiff = Math.abs(n - best);
  for (const allowed of ALLOWED_SLIDE_COUNTS) {
    const diff = Math.abs(n - allowed);
    if (diff < bestDiff) {
      best = allowed;
      bestDiff = diff;
    }
  }
  return best;
}

export function buildPresentationPrompt(req: ArtifactRequest): {
  system: string;
  user: string;
} {
  const slideCount = normalizeSlideCount(req.slideCount);
  const user = JSON.stringify(
    {
      задача: "Подготовь презентацию к уроку по параметрам ниже",
      параметры: {
        предмет: req.subject,
        класс: req.grade,
        тема: req.topic,
        сложность: req.difficulty,
        слайдов: slideCount,
      },
      требования: {
        ровно_слайдов: slideCount,
        первый_слайд: "kind=title, последний: kind=summary",
        пунктов_на_слайде: "3–5 коротких строк",
      },
      верни: "JSON по схеме из системного промпта. Без markdown-блоков.",
    },
    null,
    2,
  );

  return { system: PRESENTATION_GEN_SYSTEM, user };
}

/**
 * Разобрать ответ модели в презентацию.
 *
 * @returns презентация БЕЗ `id`/`createdAt`.
 * @throws если слайдов нет или из них не осталось ни одного корректного.
 */
export function normalizePresentation(
  raw: unknown,
  req: ArtifactRequest,
): PresentationContent {
  const obj = asRecord(raw);
  if (!obj) {
    throw new Error("presentation: ответ модели не объект");
  }

  const slides: Slide[] = [];
  if (Array.isArray(obj.slides)) {
    for (const item of obj.slides) {
      const slide = asRecord(item);
      if (!slide) continue;
      const kind = pickEnum(slide.kind, SLIDE_KINDS);
      const title = asText(slide.title);
      if (!kind || !title) continue;
      const bullets = asTextList(slide.bullets);
      const notes = asText(slide.notes);
      slides.push({
        kind,
        title,
        ...(bullets.length > 0 ? { bullets } : {}),
        ...(notes ? { notes } : {}),
      });
    }
  }

  if (slides.length === 0) {
    throw new Error("presentation: модель не вернула ни одного корректного слайда");
  }

  // slideCount — метаданные для экспортёра, и фронт принимает только 5/10/15/20.
  // Если модель вернула 8 слайдов при slideCount=10, объявлять 10 слайдов —
  // это враньё в подписи; честное значение берём от фактического числа слайдов.
  const modelCount = asIntInRange(obj.slideCount, 1, 100);
  const slideCount =
    modelCount !== null && Math.abs(modelCount - slides.length) <= 2
      ? normalizeSlideCount(modelCount)
      : normalizeSlideCount(slides.length);

  return {
    title: asText(obj.title) || `Презентация · ${req.topic}`,
    subject: asText(obj.subject) || req.subject,
    grade: asIntInRange(obj.grade, 1, 11) ?? req.grade,
    topic: asText(obj.topic) || req.topic,
    slideCount,
    slides,
    theme: pickEnum(obj.theme, SLIDE_THEMES) ?? "default",
  };
}