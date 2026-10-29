/**
 * ОЦЕНИВАНИЕ РАБОТЫ УЧЕНИКА (ТЗ-34).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЗАЧЕМ ЭТОТ ФАЙЛ
 * ─────────────────────────────────────────────────────────────────────────────
 * Учитель покупает «Базовый» за 249 ₽, и в карточке тарифа написано:
 * «Контрольная с критериями оценивания». Критериев в файле не было вообще:
 * был ключ с голыми ответами («12», «3/4», «б)»), по которому отметку не
 * поставить — не сказано, что считается полным ответом, а что половиной.
 *
 * Три решения владельца (29.10.2026), и все три живут здесь:
 *
 *   1. ОТМЕТКИ СЧИТАЕТ КОД, а не модель. Пороги 85/70/50/0 — в одном месте.
 *      Если их размазать по API, печати и тестам, через месяц у одного учителя
 *      будет «5 за 80 %», у другого «5 за 90 %» — и доверие к отметке пропадёт.
 *   2. ОТ МОДЕЛИ — ТОЛЬКО ТИПИЧНЫЕ ОШИБКИ ПО ТЕМЕ И РЕКОМЕНДАЦИЯ УЧИТЕЛЮ.
 *      Это то, что человек написать не сможет.
 *   3. ПУСТЫЕ И ОБЩИЕ ФОРМУЛИРОВКИ ОТБРАСЫВАЮТСЯ. «Ответ неполный» — это не
 *      критерий, это способ занять строку в ключе.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ПОЧЕМУ ФАЙЛ ЛЕЖИТ ВО ФРОНТЕ, А БЭК ИМПОРТИРУЕТ ЕГО
 * ─────────────────────────────────────────────────────────────────────────────
 * Тот же приём, что у реестра типов заданий (`src/lib/content/task-types.ts`):
 * это продуктовый справочник, а не API-контракт. Бэк читает его относительным
 * импортом `../../../src/lib/content/grading` — и API, и печать, и тесты
 * считают отметки по ОДНОЙ формуле.
 *
 * Типы ответа (`WorksheetTask` из `src/lib/types.ts`) здесь НЕ импортируются:
 * иначе воркер потянет за собой весь фронтовый тип-файл. Входные данные
 * описываются минимальным локальным интерфейсом — как в реестре типов, где
 * `subjects` намеренно остался `string[]`.
 *
 * Реестр типов импортируется: вес задания — это свойство его ФОРМЫ, а форма
 * описана в реестре. Второй источник правды о балле здесь был бы именно той
 * поломкой, которую ТЗ чинит.
 */
import { getTaskTypeSpec } from "./task-types";

/**
 * Отметка по российской школьной шкале.
 *
 * Только для контрольной и теста. Звёзды интерактивов
 * (`src/lib/interactives/scoring.ts`) и оценка по фото
 * (`backend/src/llm/prompts/form-grading.ts`) — ДРУГИЕ шкалы, и смешивать их
 * в одном ответе нельзя: у учителя в голове должна быть одна отметка за
 * контрольную, а не три разные.
 */
export type Mark = 5 | 4 | 3 | 2;

/**
 * ПОРОГИ ОТМЕТОК. Единственный источник истины.
 *
 * Пороги идут от высшей отметки к низшей, поэтому «отметка = f(процент)»
 * однозначна: берётся ПЕРВЫЙ порог, у которого процент не меньше `minPercent`.
 *
 * `minPercent: 0` у отметки 2 означает «всё, что ниже 50 %».
 */
export const MARK_THRESHOLDS: readonly { mark: Mark; minPercent: number }[] = [
  { mark: 5, minPercent: 85 },
  { mark: 4, minPercent: 70 },
  { mark: 3, minPercent: 50 },
  { mark: 2, minPercent: 0 },
];

/**
 * Отметка по проценту выполнения работы.
 *
 * Процент вне [0..100] → нижняя отметка (2). Не «исключение» и не «NaN»:
 * испорченный процент не должен превращаться в отметку 5.
 */
export function markForPercent(percent: number): Mark {
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) return 2;
  for (const threshold of MARK_THRESHOLDS) {
    if (percent >= threshold.minPercent) return threshold.mark;
  }
  return 2;
}

/**
 * Полная шкала в процентах — для печати и для API.
 *
 * Диапазоны идут подряд, без пропусков: конец одного + 1 = начало следующего.
 * Учитель печатает шкалу на отдельной странице и должен видеть ровно то, по
 * чему код посчитал отметку.
 */
export function marksScale(): { mark: number; fromPercent: number; toPercent: number }[] {
  return MARK_THRESHOLDS.map((threshold, index) => {
    // Пороги идут ОТ ВЫСШЕЙ отметки к низшей, поэтому верхняя граница
    // диапазона — это порог ПРЕДЫДУЩЕЙ отметки минус один процент.
    // У самой высокой отметки верхняя граница — 100.
    const previous = MARK_THRESHOLDS[index - 1];
    return {
      mark: threshold.mark,
      fromPercent: threshold.minPercent,
      toPercent: previous ? previous.minPercent - 1 : 100,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// КРИТЕРИИ: КОНКРЕТНОСТЬ
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Минимальная длина критерия (символов) после обрезки.
 *
 * Короткая строка не может быть критерием приёмки: в ней нет предмета
 * проверки. «Ответ есть» — это не критерий, это отсутствие критерия.
 */
export const MIN_CRITERION_LENGTH = 15;

/**
 * ОБЩИЕ ФОРМУЛИРОВКИ — стоп-лист.
 *
 * Это ДАННЫЕ, а не ветки в коде: список можно пополнять, не трогая логику.
 * Формулировки записаны в нижнем регистре, без знаков препинания — сравнение
 * идёт по нормализованному тексту.
 *
 * Проверка двумя слоями:
 *   1. НОРМАЛИЗОВАННЫЙ ТЕКСТ СОВПАДАЕТ С ЭЛЕМЕНТОМ СПИСКА — отбрасываем.
 *   2. СЛОВА ОСТАТКА МЕНЬШЕ ВОСЬМИ СИМВОЛОВ — отбрасываем. То есть строка,
 *      в которой кроме общих слов ничего нет («работа выполнена правильно»),
 *      уходит, а строка с конкретным содержанием остаётся, даже если внутри
 *      неё есть слово «правильно» («правильно называет числитель»).
 */
export const GENERIC_CRITERION_PHRASES: readonly string[] = [
  "ответ неполный",
  "ответ неверный",
  "ответ дан",
  "ответ есть",
  "бывают ошибки",
  "работа выполнена",
  "работа выполнена правильно",
  "правильно",
  "верно",
  "всё верно",
  "развёрнутый ответ",
  "развернутый ответ",
  "своими словами",
  "надо знать тему",
  "знание темы",
  "знает тему",
  "соответствует теме",
  "тема раскрыта",
  "раскрыта тема",
  "ответ ученика",
  "частично",
  "полностью",
  "не полностью",
  "работа в целом",
];

/** Привести текст к сравнимому виду: нижний регистр, «ё» → «е», без краёв. */
function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Убрать из текста общие формулировки и вернуть ОСТАВШЕЕСЯ.
 *
 * Фразы вырезаются по СЛОВАМ, а не подстрокой: иначе «верно» вырезалось бы
 * из слова «вероятность» и ломало бы нормальный критерий.
 */
function stripGenericPhrases(normalized: string): string {
  const words = normalized.split(" ").filter(Boolean);
  const phraseWords = GENERIC_CRITERION_PHRASES.map((p) => normalizeText(p).split(" ")).filter(
    (p) => p.length > 0,
  );
  const maxLen = phraseWords.reduce((max, p) => Math.max(max, p.length), 0);

  const out: string[] = [];
  let i = 0;
  while (i < words.length) {
    let matched = false;
    for (let len = Math.min(maxLen, words.length - i); len >= 1; len -= 1) {
      const window = words.slice(i, i + len);
      const isPhrase = phraseWords.some((p) => p.length === len && p.every((w, k) => w === window[k]));
      if (isPhrase) {
        i += len;
        matched = true;
        break;
      }
    }
    if (!matched) {
      out.push(words[i] as string);
      i += 1;
    }
  }
  return out.join(" ");
}

/**
 * Конкретный ли критерий.
 *
 * Отбрасываются:
 *   · не строки (null, числа, массивы);
 *   · строки короче {@link MIN_CRITERION_LENGTH} символов после обрезки;
 *   · строки, совпадающие со стоп-листом общих формулировок;
 *   · строки, от которых после вырезания общих формулировок не остаётся
 *     содержания.
 */
export function isConcreteCriterion(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length < MIN_CRITERION_LENGTH) return false;
  const normalized = normalizeText(trimmed);
  if (!normalized) return false;
  if (GENERIC_CRITERION_PHRASES.some((p) => normalizeText(p) === normalized)) return false;
  if (stripGenericPhrases(normalized).length < 8) return false;
  return true;
}

/** Оставить только конкретные критерии из списка. */
export function concreteCriteria(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string => typeof item === "string" && isConcreteCriterion(item),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// БАЛЛЫ ЗА ЗАДАНИЕ
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Вес задания, если его тип НЕ найден в реестре.
 *
 * Тип вне реестра — это дефект (такое задание и не печатается, и не
 * проверяется), но считать баллы всё равно надо. Значение одно на все такие
 * задания, чтобы оно не выглядело как «выдуманная» величина: это средний
 * вес по реестру, и одинаковый для всех неизвестных типов.
 */
export const DEFAULT_TASK_WEIGHT = 2;

/**
 * Максимальный балл за задание по ТИПУ — из реестра.
 *
 * Модель присылает своё поле `points`, и оно ИГНОРИРУЕТСЯ: два разных числа
 * о балле одного задания в одном файле — это ровно та поломка, которую ТЗ
 * чинит. Вес — свойство ФОРМЫ задания, а форма описана в реестре.
 */
export function maxPointsForTaskType(type: unknown): number {
  if (typeof type !== "string") return DEFAULT_TASK_WEIGHT;
  return getTaskTypeSpec(type)?.weight ?? DEFAULT_TASK_WEIGHT;
}

/** Максимальный балл за задание (по его типу). */
export function taskMaxPoints(task: { type?: unknown; points?: unknown } | null | undefined): number {
  return maxPointsForTaskType(task?.type);
}

// ─────────────────────────────────────────────────────────────────────────────
// БЛОК `evaluation` — ОТВЕТ API
// ─────────────────────────────────────────────────────────────────────────────

/** Критерии одного задания с кодовым максимальным баллом. */
export interface EvaluationCriterion {
  /** Номер задания в работе (номер ставит сервер). */
  number: number;
  /** Конкретные критерии приёмки. */
  criteria: string[];
  /** Максимальный балл за задание — из реестра типов. */
  maxPoints: number;
}

/** Одна шкала отметок. */
export interface EvaluationMarkScale {
  mark: number;
  fromPercent: number;
  toPercent: number;
}

/**
 * Критерии и шкала ОДНОЙ работы (листа, теста или варианта контрольной).
 *
 * Для контрольной таких блоков два — по числу вариантов.
 */
export interface EvaluationPart {
  /** Номер варианта: 1 — лист или тест, 1 и 2 — варианты контрольной. */
  variant: number;
  /** Название работы (для контрольной — «Вариант 1»). */
  title: string;
  /** Критерии по заданиям. Пусто — критериев сформировать не удалось. */
  criteria: EvaluationCriterion[];
  /** Типичные ошибки по теме — от модели. */
  typicalMistakes: string[];
  /** Рекомендация учителю — от модели. `null`, если не прошла проверку. */
  recommendation: string | null;
  /** Сумма максимальных баллов по всем заданиям работы. */
  totalMaxPoints: number;
  /** Шкала отметок 5/4/3/2. */
  marks: EvaluationMarkScale[];
}

/** Задание в том виде, в каком его нужно посчитать. */
export interface EvaluationTaskInput {
  number?: number;
  type?: string;
  /** Модельное поле `points` — ИГНОРИРУЕТСЯ, вес берётся из реестра. */
  points?: number;
  criteria?: string[] | null;
}

/**
 * То, что прислала модель: типичные ошибки и рекомендация учителю.
 *
 * Критериев здесь нет и быть не должно: они лежат в `task.criteria` (AD-4).
 * Второе место для одних и тех же данных — это ровно та ошибка, которую ТЗ
 * чинит, поэтому модельный блок читается только здесь, а критерии собираются
 * из заданий.
 */
export interface ModelEvaluation {
  typicalMistakes: string[];
  recommendation: string | null;
}

/**
 * Прочитать модельный блок `evaluation` — осторожно.
 *
 * Мусор (не массив, не строка, `null`) не становится данными: пустой блок
 * честнее выдуманной рекомендации.
 */
export function readModelEvaluation(raw: unknown): ModelEvaluation {
  if (!raw || typeof raw !== "object") return { typicalMistakes: [], recommendation: null };
  const source = raw as { typicalMistakes?: unknown; recommendation?: unknown };

  const typicalMistakes: string[] = [];
  if (Array.isArray(source.typicalMistakes)) {
    for (const item of source.typicalMistakes) {
      if (typeof item !== "string") continue;
      const trimmed = item.trim();
      if (isConcreteCriterion(trimmed)) typicalMistakes.push(trimmed);
    }
  }

  let recommendation: string | null = null;
  if (typeof source.recommendation === "string") {
    const trimmed = source.recommendation.trim();
    if (isConcreteCriterion(trimmed)) recommendation = trimmed;
  }

  return { typicalMistakes, recommendation };
}

/**
 * Собрать блок `evaluation` для одной работы.
 *
 * ВСЁ, кроме типичных ошибок и рекомендации, считается КОДОМ:
 *   · критерии — из `task.criteria` (после проверки на конкретность);
 *   · максимальный балл — из реестра типов;
 *   · сумма баллов — по всем заданиям работы;
 *   · шкала отметок — из порогов выше.
 */
export function buildEvaluationPart(args: {
  variant: number;
  title: string;
  tasks: readonly EvaluationTaskInput[];
  /** Модельный блок `evaluation` (сырой, из ответа модели). */
  model?: unknown;
}): EvaluationPart {
  const criteria: EvaluationCriterion[] = [];
  let totalMaxPoints = 0;

  args.tasks.forEach((task, index) => {
    const maxPoints = taskMaxPoints(task);
    totalMaxPoints += maxPoints;
    const taskCriteria = concreteCriteria(task?.criteria);
    if (taskCriteria.length === 0) return;
    criteria.push({
      number: typeof task?.number === "number" ? task.number : index + 1,
      criteria: taskCriteria,
      maxPoints,
    });
  });

  const model = readModelEvaluation(args.model);

  return {
    variant: args.variant,
    title: args.title,
    criteria,
    typicalMistakes: model.typicalMistakes,
    recommendation: model.recommendation,
    totalMaxPoints,
    marks: marksScale(),
  };
}
