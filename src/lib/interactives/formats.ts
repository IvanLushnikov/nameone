/**
 * Реестр форматов интерактивов (TZ-13 §4.3, пункт «реестр 6 форматов»).
 *
 * Здесь три вещи, которые нужны ВСЕМ слоям — конструктору учителя, плеерам и
 * странице прохождения:
 *   1. `FORMAT_META` — метаданные для показа учителю (название, сложность,
 *      «сколько кода стоит» по ТЗ §2.1, настройки, которые он увидит);
 *   2. `normalizeOptions()` — единственное место, где сырой JSON из
 *      `config_json` превращается в ТИПИЗИРОВАННЫЕ опции формата. Плеер не
 *      гадает по форме JSON, а получает гарантированные числа и массивы;
 *   3. `validateFormatOptions()` — сообщения об ошибках для конструктора.
 *
 * Значения по умолчанию взяты из ТЗ §2 («настраивается учителем: 10/20/30
 * секунд или без таймера», «2–4 корзины», «8×8, для телефона 6×6», «3–5 мин»,
 * «100/200/300/400»). Это дефолты ДЛЯ КОНСТРУКТОРА: если LLM-ранклер не
 * вернул опцию, играем с этими — плохой конфиг лучше, чем пустой плеер (ТЗ Р-3).
 */

import {
  INTERACTIVE_FORMATS,
  type AnyFormatOptions,
  type FortuneWheelOptions,
  type InteractiveFormat,
  type InteractiveOptions,
  type JeopardyOptions,
  type JumpTruthOptions,
  type QuizRaceOptions,
  type SortBasketsOptions,
  type SortSequenceOptions,
} from "./types";

/** Насколько формат сложен в разработке — прямо из ТЗ §2.1. */
export type FormatDifficulty = "low" | "medium" | "high";

export interface FormatMeta {
  /** Название для учителя. */
  title: string;
  /** Одна строка «что делает ученик». */
  mechanic: string;
  emoji: string;
  difficulty: FormatDifficulty;
  /** Оценка объёма фронта в днях — ТЗ §2.1, нужна конструктору и прогнозу. */
  codeDays: number;
  /** Рекомендуем для первого показа учителю (ТЗ сценарий А, шаг 3). */
  recommended?: boolean;
  /** Подписи настроек, которые увидит учитель (для конструктора). */
  settings: string[];
  /** Можно ли показывать иллюстрации к заданиям (ТЗ §4.8). */
  supportsSvg: boolean;
}

export const FORMAT_META: Record<InteractiveFormat, FormatMeta> = {
  "quiz-race": {
    title: "Викторина-гонка",
    mechanic: "Серия вопросов на время, очки за скорость ответа",
    emoji: "🏁",
    difficulty: "low",
    codeDays: 2.0,
    recommended: true,
    settings: ["Сколько вопросов", "Таймер на вопрос", "Перемешать варианты"],
    supportsSvg: true,
  },
  "sort-baskets": {
    title: "Группировка по корзинам",
    mechanic: "Перетащить карточки в корзины, счётчик правильных",
    emoji: "🧺",
    difficulty: "medium",
    codeDays: 1.5,
    settings: ["Названия корзин", "Ловушки", "Сколько карточек"],
    supportsSvg: true,
  },
  "jump-truth": {
    title: "Прыг по правде",
    mechanic: "Ход по клеткам, кубик и утверждения «правда / ложь»",
    emoji: "🎲",
    difficulty: "high",
    codeDays: 3.0,
    settings: ["Размер поля", "Сколько мин", "Сколько утверждений"],
    supportsSvg: false,
  },
  "fortune-wheel": {
    title: "Колесо фортуны",
    mechanic: "Крутим колесо — выпадает вопрос из сектора",
    emoji: "🎡",
    difficulty: "medium",
    codeDays: 2.0,
    settings: ["Секторы колеса", "Вопросов в секторе"],
    supportsSvg: true,
  },
  jeopardy: {
    title: "Своя игра",
    mechanic: "Доска с номинациями и очками, соло или по очереди",
    emoji: "🏆",
    difficulty: "medium",
    codeDays: 2.5,
    settings: ["Номинации", "Сколько клеток", "Режим: соло / очередь"],
    supportsSvg: true,
  },
  "sort-sequence": {
    title: "Сортировка",
    mechanic: "Расставить объекты в правильном порядке",
    emoji: "🔢",
    difficulty: "low",
    codeDays: 1.5,
    settings: ["Принцип сортировки", "Сколько объектов", "Порядок или две корзины"],
    supportsSvg: true,
  },
};

/** Дефолты опций — ТЗ §2. Учитель может поменять, но не обязан. */
export const DEFAULT_OPTIONS: Record<InteractiveFormat, InteractiveOptions> = {
  "quiz-race": { itemCount: 10, secondsPerItem: 20, shuffleOptions: true },
  "sort-baskets": { itemCount: 10, baskets: ["Свой", "Чужой"], maxErrors: 5 },
  "jump-truth": { itemCount: 12, boardSize: 8, mines: 3 },
  "fortune-wheel": { sectors: ["Сложение", "Вычитание", "Порядок действий"], questionsPerSector: 3 },
  jeopardy: {
    categories: ["Лёгкое", "Среднее", "Сложное"],
    rows: 4,
    pointLadder: [100, 200, 300, 400],
    mode: "solo",
  },
  "sort-sequence": { itemCount: 8, mode: "order", principle: "ascending" },
};

/** Тип-гард формата — для разбора ответа API и query-строки. */
export function isInteractiveFormat(value: unknown): value is InteractiveFormat {
  return (
    typeof value === "string" &&
    (INTERACTIVE_FORMATS as readonly string[]).includes(value)
  );
}

/** Метаданные формата. Для неизвестного значения — дефолт без падения. */
export function formatMeta(format: InteractiveFormat): FormatMeta {
  return FORMAT_META[format] ?? FORMAT_META["quiz-race"];
}

/* ─── Нормализация опций ─────────────────────────────────────────────────── */

/** Список закрытых принципов сортировки (ТЗ §2.7: «не пишет свой»). */
export const SORT_PRINCIPLES: Record<string, string> = {
  ascending: "По возрастанию",
  descending: "По убыванию",
  alphabet: "По алфавиту",
  chronology: "По хронологии",
  size: "По размеру",
};

/** Зажимает число в диапазон, подставляя дефолт на мусоре. */
function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Чистый массив строк без пустых и дублей, обрезанный по длине. */
function cleanStrings(value: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const s = raw.trim().slice(0, maxLen);
    if (!s) continue;
    if (out.includes(s)) continue;
    out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

/** Положительные числа из массива, по возрастанию, без дублей. */
function cleanNumbers(value: unknown, min: number, max: number, maxItems: number): number[] {
  if (!Array.isArray(value)) return [];
  const out = new Set<number>();
  for (const raw of value) {
    const n = typeof raw === "number" ? raw : Number(raw);
    if (Number.isFinite(n)) out.add(clampNumber(n, min, max, min));
    if (out.size >= maxItems) break;
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * Сырой JSON опций → типизированные опции формата.
 *
 * ЕДИНСТВЕННОЕ место, где движок решает, что делать с мусором в `config_json`:
 * неизвестные ключи игнорируются, числа зажимаются в диапазоны из ТЗ, строки
 * чистятся. Пустой результат по массиву (например, ноль секторов) заменяется
 * дефолтом — плеер обязан получить что-то, во что можно играть.
 *
 * `switch` исчерпывающий: добавление седьмого формата заставит TS обновить
 * здесь и в `scoring.ts`, и в `InteractivePlayer.tsx`.
 */
/**
 * Приводит сырые опции формата к валидным, с дефолтами и зажимами.
 *
 * Дженерик по `F` заменён на перегрузки: с `F extends InteractiveFormat`
 * TypeScript не сужает `F` внутри `case`, и возврат `QuizRaceOptions` не
 * считался подходящим под `FormatOptionsMap[F]` — пришлось бы кастовать в
 * каждом из шести кейсов. Перегрузки дают тот же точный тип на стороне
 * вызова (`normalizeOptions("quiz-race", …) → QuizRaceOptions`) без кастов
 * в теле.
 */
export function normalizeOptions(
  format: "quiz-race",
  raw?: InteractiveOptions | null,
): QuizRaceOptions;
export function normalizeOptions(
  format: "sort-baskets",
  raw?: InteractiveOptions | null,
): SortBasketsOptions;
export function normalizeOptions(
  format: "jump-truth",
  raw?: InteractiveOptions | null,
): JumpTruthOptions;
export function normalizeOptions(
  format: "fortune-wheel",
  raw?: InteractiveOptions | null,
): FortuneWheelOptions;
export function normalizeOptions(
  format: "jeopardy",
  raw?: InteractiveOptions | null,
): JeopardyOptions;
export function normalizeOptions(
  format: "sort-sequence",
  raw?: InteractiveOptions | null,
): SortSequenceOptions;
/**
 * Запасная перегрузка для вызовов, где формат известен только как
 * `InteractiveFormat` (циклы по всем форматам в тестах и валидаторе).
 * Без неё такой вызов не подходил ни к одной из шести литеральных
 * перегрузок и падал с «not assignable to "sort-sequence"».
 */
export function normalizeOptions(
  format: InteractiveFormat,
  raw?: InteractiveOptions | null,
): AnyFormatOptions;
export function normalizeOptions(
  format: InteractiveFormat,
  raw?: InteractiveOptions | null,
): AnyFormatOptions {
  const o: InteractiveOptions = { ...DEFAULT_OPTIONS[format], ...(raw ?? {}) };

  switch (format) {
    case "quiz-race": {
      const opts: QuizRaceOptions = {
        itemCount: clampNumber(o.itemCount, 3, 20, 10),
        // ТЗ §2.2: 10 / 20 / 30 секунд или 0 (без таймера). Всё остальное
        // округляем к ближайшему разрешённому — иначе таймер врёт учителю.
        secondsPerItem: [0, 10, 20, 30].includes(Number(o.secondsPerItem))
          ? Number(o.secondsPerItem)
          : 20,
        shuffleOptions: o.shuffleOptions !== false,
      };
      return opts;
    }

    case "sort-baskets": {
      const baskets = cleanStrings(o.baskets, 4, 60);
      const opts: SortBasketsOptions = {
        itemCount: clampNumber(o.itemCount, 4, 20, 10),
        // ТЗ §2.3: 2–4 корзины. Одна корзина — не группировка.
        baskets: baskets.length >= 2 ? baskets : ["Свой", "Чужой"],
        maxErrors: clampNumber(o.maxErrors, 0, 50, 5),
      };
      return opts;
    }

    case "jump-truth": {
      // ТЗ §2.4: 8×8 поле, «для телефона — 6×6».
      const boardSize = [6, 8].includes(Number(o.boardSize)) ? Number(o.boardSize) : 8;
      const opts: JumpTruthOptions = {
        itemCount: clampNumber(o.itemCount, 6, 30, 12),
        boardSize,
        // Мин не больше, чем клеток на первой линии (boardSize), иначе
        // финиш недостижим — валидатор учителя об этом предупредит.
        mines: clampNumber(o.mines, 0, boardSize, 3),
      };
      return opts;
    }

    case "fortune-wheel": {
      // ТЗ §2.5: круг на 4–8 секторов.
      const sectors = cleanStrings(o.sectors, 8, 60);
      const opts: FortuneWheelOptions = {
        sectors:
          sectors.length >= 2
            ? sectors
            : (DEFAULT_OPTIONS["fortune-wheel"].sectors as string[]),
        questionsPerSector: clampNumber(o.questionsPerSector, 1, 10, 3),
      };
      return opts;
    }

    case "jeopardy": {
      const categories = cleanStrings(o.categories, 5, 60);
      const ladder = cleanNumbers(o.pointLadder, 1, 1000, 4);
      const opts: JeopardyOptions = {
        categories:
          categories.length >= 2
            ? categories
            : (DEFAULT_OPTIONS.jeopardy.categories as string[]),
        rows: clampNumber(o.rows, 3, 4, 4),
        pointLadder: ladder.length >= 2 ? ladder : [100, 200, 300, 400],
        mode: o.mode === "queue" ? "queue" : "solo",
      };
      return opts;
    }

    case "sort-sequence": {
      const opts: SortSequenceOptions = {
        itemCount: clampNumber(o.itemCount, 3, 12, 8),
        mode: o.mode === "classify" ? "classify" : "order",
        principle: typeof o.principle === "string" && o.principle ? o.principle : "ascending",
      };
      return opts;
    }

    default: {
      // Exhaustiveness: новый формат без кейса — ошибка компиляции.
      const _exhaustive: never = format;
      throw new Error(`Unknown interactive format: ${String(_exhaustive)}`);
    }
  }
}

/* ─── Валидатор опций (для конструктора и тестов) ────────────────────────── */

/**
 * Проверяет опции ФАКТИЧЕСКИ, без молчаливых зажимов: возвращает список
 * проблем на русском для показа учителю. `normalizeOptions` чинит значения,
 * но учитель должен узнать, что его «4 мины» превратились в 3.
 */
export function validateFormatOptions(
  format: InteractiveFormat,
  raw: InteractiveOptions | null | undefined,
): string[] {
  const issues: string[] = [];
  const o = raw ?? {};
  const d = DEFAULT_OPTIONS[format];
  const fixed = normalizeOptions(format, raw);

  /** Сравниваем сырое значение с тем, во что оно превратилось. */
  const checkCount = (key: "itemCount" | "rows" | "mines" | "questionsPerSector" | "boardSize") => {
    if (o[key] === undefined) return;
    const rawVal = Number(o[key]);
    // `fixed` — union шести типов опций, а нужен конкретный ключ из них.
    // Через `unknown`: у типов опций нет общей индексной подписи, и прямое
    // приведение к словарю компилятор отвергает.
    const fixedVal = Number((fixed as unknown as Record<string, unknown>)[key]);
    if (!Number.isFinite(rawVal)) {
      issues.push(`${key}: «${String(o[key])}» — не число, взяли ${fixedVal}`);
    } else if (rawVal !== fixedVal) {
      issues.push(`${key}: ${rawVal} — поправили на ${fixedVal}`);
    }
  };

  switch (format) {
    case "quiz-race":
      checkCount("itemCount");
      if (
        o.secondsPerItem !== undefined &&
        ![0, 10, 20, 30].includes(Number(o.secondsPerItem))
      ) {
        issues.push(
          `secondsPerItem: ${String(o.secondsPerItem)} — можно 10, 20, 30 или 0 (без таймера), взяли ${d.secondsPerItem}`,
        );
      }
      break;

    case "sort-baskets": {
      checkCount("itemCount");
      const baskets = Array.isArray(o.baskets) ? o.baskets.length : 0;
      if (baskets > 0 && baskets < 2) issues.push("Корзин меньше двух — группировать нечего");
      if (baskets > 4) issues.push(`Корзин ${baskets} — максимум 4, оставили 4`);
      break;
    }

    case "jump-truth":
      checkCount("itemCount");
      checkCount("boardSize");
      checkCount("mines");
      // `boardSize` есть только у `JumpTruthOptions`, поэтому в этом кейсе
      // пересоздаём `fixed` через перегрузку — она уже вернёт узкий тип.
      const jt = normalizeOptions("jump-truth", raw);
      if (jt.boardSize === 6 && Number(o.boardSize) === 8) {
        issues.push("Поле 6×6 — это режим для телефона, взяли по умолчанию 6");
      }
      break;

    case "fortune-wheel": {
      checkCount("questionsPerSector");
      const sectors = Array.isArray(o.sectors) ? o.sectors.length : 0;
      if (sectors > 0 && sectors < 2) issues.push("Секторов меньше двух — колесо не крутится");
      if (sectors > 8) issues.push(`Секторов ${sectors} — максимум 8, оставили 8`);
      break;
    }

    case "jeopardy": {
      checkCount("rows");
      if (o.mode !== undefined && o.mode !== "solo" && o.mode !== "queue") {
        issues.push(`mode: ${String(o.mode)} — бывает «solo» или «queue»`);
      }
      const ladder = Array.isArray(o.pointLadder) ? o.pointLadder.length : 0;
      if (ladder > 4) issues.push(`Столбцов ${ladder} — максимум 4`);
      break;
    }

    case "sort-sequence":
      checkCount("itemCount");
      if (o.mode !== undefined && o.mode !== "order" && o.mode !== "classify") {
        issues.push(`mode: ${String(o.mode)} — бывает «order» или «classify»`);
      }
      if (o.principle !== undefined && !SORT_PRINCIPLES[String(o.principle)]) {
        issues.push(
          `principle: ${String(o.principle)} — выберите из списка (${Object.keys(SORT_PRINCIPLES).join(", ")})`,
        );
      }
      break;

    default: {
      const _exhaustive: never = format;
      throw new Error(`Unknown interactive format: ${String(_exhaustive)}`);
    }
  }

  return issues;
}

/**
 * Итоговая оценка объёма фронта по всем шести форматам, в днях —
 * ТЗ §2.1 (итого 12.5 дня). Нужна прогнозу продакта, не коду.
 */
export function totalCodeDays(): number {
  return INTERACTIVE_FORMATS.reduce((sum, f) => sum + formatMeta(f).codeDays, 0);
}
