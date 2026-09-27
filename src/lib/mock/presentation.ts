/**
 * Q1-2027: мок-генератор презентаций.
 *
 * Контракт: на вход GenerationRequest с type === "presentation",
 * на выход Presentation с заполненными slides длиной req.slideCount.
 * Структура слайдов:
 *   [0]              title    — титульный по теме
 *   [1..N-2]         definition | example | bullets (чередование по позиции)
 *   [N-1]            summary  — 3-5 выводов
 * Каждый слайд имеет notes (1-2 строки для режима докладчика).
 *
 * Дефолты:
 *   - slideCount = 10 если не указан или не из {5,10,15,20}.
 *   - Если topic не нашёлся — используется req.topic как строка, без падения.
 */
import type { GenerationRequest, Presentation, Slide, SlideKind } from "@/lib/types";
import { getSubject, getTopic } from "@/lib/content/subjects";
import { shortId } from "@/lib/utils/cn";

const ALLOWED_COUNTS: ReadonlyArray<5 | 10 | 15 | 20> = [5, 10, 15, 20];
const DEFAULT_COUNT: 5 | 10 | 15 | 20 = 10;

/**
 * Нормализует slideCount к одному из {5, 10, 15, 20}.
 * NaN/0/негатив → default. Дробные → округление к ближайшему из списка.
 */
function normalizeSlideCount(raw: number | undefined): 5 | 10 | 15 | 20 {
  if (raw === undefined || Number.isNaN(raw) || raw <= 0) return DEFAULT_COUNT;
  const intCount = Math.round(raw);
  if ((ALLOWED_COUNTS as ReadonlyArray<number>).includes(intCount)) {
    return intCount as 5 | 10 | 15 | 20;
  }
  // Берём ближайший разрешённый вариант
  let best: 5 | 10 | 15 | 20 = DEFAULT_COUNT;
  let bestDelta = Math.abs(intCount - DEFAULT_COUNT);
  for (const c of ALLOWED_COUNTS) {
    const d = Math.abs(intCount - c);
    if (d < bestDelta) {
      best = c;
      bestDelta = d;
    }
  }
  return best;
}

/**
 * Строит контент «объяснительного» слайда по его позиции.
 * Чередует definition / example / bullets.
 */
function pickMiddleKind(index: number, totalMiddle: number): SlideKind {
  // Простой шаблон по позиции: 0,1,2 → definition, example, bullets, потом repeat.
  const cycle: SlideKind[] = ["definition", "example", "bullets"];
  return cycle[index % cycle.length];
}

/**
 * Берёт пример из таксономии по индексу с зацикливанием.
 * Если topic не найден или examples пуст — возвращает дефолтную фразу.
 */
function exampleFor(topicExamples: { text: string; answer?: string; hint?: string }[] | undefined, idx: number): string {
  if (!topicExamples || topicExamples.length === 0) {
    return "Разберём характерный пример по теме.";
  }
  const ex = topicExamples[idx % topicExamples.length];
  // Убираем «__»-заглушку для читаемости в презентации
  return ex.text.replace(/__/g, "…");
}

/**
 * Формирует заметки спикера (1-2 строки) на основе темы и позиции слайда.
 */
function buildNotes(kind: SlideKind, topicTitle: string, position: number): string {
  switch (kind) {
    case "title":
      return `Вступительный слайд по теме «${topicTitle}». Представьтесь, обозначьте план и мотивацию урока.`;
    case "definition":
      return `Слайд ${position}: ключевое определение. Произнесите термин, дайте короткий пример из жизни.`;
    case "example":
      return `Слайд ${position}: пример по теме «${topicTitle}». Решайте вместе с классом, спрашивайте гипотезы.`;
    case "bullets":
      return `Слайд ${position}: важные пункты. Делайте паузу на каждом пункте и просите пример из опыта учеников.`;
    case "summary":
      return `Заключение. Повторите 3-5 главных выводов и спросите, что осталось непонятным.`;
  }
}

/**
 * Строит массив слайдов по контракту TZ-02.
 */
function buildSlides(
  topicTitle: string,
  examples: { text: string; answer?: string; hint?: string }[] | undefined,
  slideCount: 5 | 10 | 15 | 20,
): Slide[] {
  const slides: Slide[] = [];
  const middleCount = slideCount - 2; // без title и summary

  // 1) Титульный
  slides.push({
    kind: "title",
    title: topicTitle,
    bullets: [`Презентация к уроку`, `${slideCount} слайдов`],
    notes: buildNotes("title", topicTitle, 1),
  });

  // 2) Средние слайды — чередуем definition/example/bullets
  for (let i = 0; i < middleCount; i++) {
    const kind = pickMiddleKind(i, middleCount);
    const position = i + 2; // человекочитаемая позиция (со 2)

    switch (kind) {
      case "definition":
        slides.push({
          kind,
          title: `Определение ${i + 1}`,
          bullets: [
            `${topicTitle} — ключевое понятие темы.`,
            `Признаки и свойства по ФГОС.`,
            `Где встречается в задачах и жизни.`,
          ],
          notes: buildNotes(kind, topicTitle, position),
        });
        break;

      case "example":
        slides.push({
          kind,
          title: `Пример ${i + 1}`,
          bullets: [
            exampleFor(examples, i),
            "Пошаговое решение со всеми действиями.",
            "Проверка через подстановку/обратное действие.",
          ],
          notes: buildNotes(kind, topicTitle, position),
        });
        break;

      case "bullets":
        slides.push({
          kind,
          title: `Что важно запомнить`,
          bullets: [
            `Связь с предыдущими темами курса.`,
            `Типовые ошибки учеников (по опыту).`,
            `Применение в задачах ОГЭ/ЕГЭ.`,
            `Куда смотреть в учебнике / справочнике.`,
          ],
          notes: buildNotes(kind, topicTitle, position),
        });
        break;
    }
  }

  // 3) Заключительный
  slides.push({
    kind: "summary",
    title: "Итоги урока",
    bullets: [
      `Сформулировали понятие «${topicTitle}».`,
      `Разобрали ${Math.min(examples?.length ?? 0, 3) || 3} ключевых примера.`,
      `Запомнили типовые ошибки.`,
      `Готовы к самостоятельной работе.`,
    ],
    notes: buildNotes("summary", topicTitle, slideCount),
  });

  return slides;
}

export async function generatePresentation(req: GenerationRequest): Promise<Presentation> {
  const subject = getSubject(req.subject);
  const topic = getTopic(req.subject, req.grade, req.topic);
  const slideCount = normalizeSlideCount(req.slideCount);

  const topicTitle = topic?.title ?? req.topic;
  const slides = buildSlides(topicTitle, topic?.examples, slideCount);

  const startMs = Date.now();
  const result: Presentation = {
    id: shortId(),
    title: `${topicTitle} · ${subject?.shortTitle ?? req.subject}`,
    subject: req.subject,
    grade: req.grade,
    topic: topic?.slug ?? req.topic,
    slideCount,
    slides,
    theme: "default",
    createdAt: new Date().toISOString(),
    generationMs: Date.now() - startMs,
  };
  return result;
}
