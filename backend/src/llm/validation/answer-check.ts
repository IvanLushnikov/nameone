/**
 * Детерминированная сверка ответа модели с эталоном из банка задач.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЗАЧЕМ ЭТОТ ФАЙЛ, А НЕ «ПРАВИЛЬНЫЙ ТЕКСТ ПРОМПТА»
 * ─────────────────────────────────────────────────────────────────────────────
 * Изначально SOLVE_PROMPT получал `expectedAnswer` как подсказку, а VERIFY_PROMPT
 * сравнивал это же подстроенное решение с ТЕМ ЖЕ эталоном. Совпадение там было
 * гарантировано по построению: первая подстановка делала вид, что модель
 * «проверила себя сама». Живая проверка это подтвердила — на заведомо неверном
 * эталоне «42» при задаче «3/8 + 1/8» ручка вернула `verified: true`, причём
 * числа 42 не было даже в тексте объяснения.
 *
 * Формулировки промпта исправлены (см. prompts/self-verify.ts), но на одних
 * формулировках поломку не поймать: их нечем проверить в тесте, и модель снова
 * может «забыть про эталон» — а цена ошибки здесь не косметическая, по вердикту
 * решается, зачтена ли ученику работа. Поэтому поверх ответа модели стоит
 * СРАВНЕНИЕ СТРОК, которое нельзя уговорить: модель говорит «верно», а код
 * всё равно отдаёт `verified: false`, если числа банально разные.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ПОЧЕМУ ЭТО НЕ «ПОДСТАВНОЙ ОТВЕТ»
 * ─────────────────────────────────────────────────────────────────────────────
 * Обратная сторона медали — ложные срабатывания. Наивное `a === b` зарубило бы
 * «4/8» против «1/2» (это ОДИН ответ) и ругалось бы на «0.50» против «0.5».
 * Поэтому сверка УМЕЕТ НЕ РЕШАТЬ: сомнительные пары дают `incomparable`, и тогда
 * вердикт модели остаётся в силе. Сверка может только ЗАПРЕТИТЬ «верно» там, где
 * расхождение бесспорно, — обратного (навязать «верно») она не умеет.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ГРАНИЦЫ (честно, потому что метод сравнения строк всегда неполон)
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. Дробь против десятичной записи сравнивается ЧИСЛЕННО, иначе не ловился бы
 *      главный случай («42» против «1/2» — числа разные). Но если значения
 *      совпадают с точностью десятичной стороны («1/3» против «0.33» — одна
 *      величина, просто разная точность записи), пара помечается
 *      `incomparable` и вердикт остаётся за моделью. Это защита от ложной
 *      тревоги на округлениях.
 *   2. Единицы измерения сравниваются как текст. «5 см» против «5» → не решаем
 *      (эталон могли записать без единицы). «5 см» против «5 м» → mismatch.
 *   3. Словарные ответы («синий», «да», «3 человека») не разбираются вовсе →
 *      incomparable. Для математики этого достаточно, для русского/окружающего
 *      мира сверка просто молчит и отдаёт слово модели.
 */

export type AnswerMatch = "match" | "mismatch" | "incomparable";

/** Число в точном виде дроби + единица измерения текстом. */
interface CanonicalAnswer {
  num: bigint;
  den: bigint;
  /** Род исходной записи: дробь или десятичное число. */
  kind: "fraction" | "decimal";
  /**
   * Сколько знаков после запятой было НАПИСАНО в десятичной записи.
   * Нужно, чтобы понять, различаются ли «1/3» и «0.33» по сути или только
   * по точности. Для дробей равно 0.
   */
  decimals: number;
  /**
   * Десятичная запись КАК НАПИСАНА, целым числом в десятичных разрядах:
   * «0.33» → 33n, «-1.5» → -15n. Для дробей null.
   * Нужен именно в таком виде, потому что сокращённая дробь (0.50 → 1/2)
   * теряет исходную точность записи.
   */
  written: bigint | null;
  unit: string;
}

const TRIM_CHARS = /[*`"'«»“”]/g;

/** Сквозной мусор: markdown, кавычки, лишние пробелы, хвостовая точка. */
function cleanAnswer(raw: string): string {
  return raw
    .replace(TRIM_CHARS, "")
    .replace(/\s+/g, " ")
    .trim()
    // Запятая между цифрами — десятичный разделитель («0,5» = «0.5»).
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/[\s.;:!?]+$/, "")
    .trim();
}

/** Единица измерения — слово, слово из двух слов, «%» или «°». */
function isUnitLike(unit: string): boolean {
  return /^(?:%|°|[a-zA-Zа-яА-ЯёЁ][a-zA-Zа-яА-ЯёЁ]*(?:[ ]+[a-zA-Zа-яА-ЯёЁ]+)?)$/.test(unit);
}

/** Собрать точную дробь из числителя и знаменателя, сократив на НОД. */
function asFraction(num: bigint, den: bigint): { num: bigint; den: bigint } {
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  const a = num < 0n ? -num : num;
  const b = den;
  const gcd = (x: bigint, y: bigint): bigint => (y === 0n ? x : gcd(y, x % y));
  const g = gcd(a, b) || 1n;
  return { num: num / g, den: den / g };
}

/** Десятичное число → точная дробь (0.5 = 5/10 = 1/2). */
function decimalToFraction(text: string): { num: bigint; den: bigint; decimals: number; written: bigint } {
  const negative = text.startsWith("-");
  const [intPart = "0", fracPart = ""] = text.replace("-", "").split(".");
  const den = 10n ** BigInt(fracPart.length);
  const num = BigInt(`${intPart}${fracPart}` || "0");
  return {
    ...asFraction(negative ? -num : num, den),
    decimals: fracPart.length,
    written: negative ? -num : num,
  };
}

/** Округлить дробь до `decimals` знаков после запятой (половина — от нуля). */
function roundFraction(num: bigint, den: bigint, decimals: number): bigint {
  const scaled = num * 10n ** BigInt(decimals);
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  // round-half-away-from-zero целочисленно: (2·|x| + d) / (2·d).
  const rounded = (2n * abs + den) / (2n * den);
  return negative ? -rounded : rounded;
}

/**
 * Разобрать ответ в сравнимую форму. null = форма не разобрана (текст,
 * разные единицы, мусор) → по такой строке НЕ выносим вердикт.
 */
function canonicalize(raw: string): CanonicalAnswer | null {
  const cleaned = cleanAnswer(raw);
  if (!cleaned) return null;

  // Смешанное число: «1 1/2» → неправильная дробь 3/2.
  const mixed = cleaned.match(/^(-?\d+)[ ]+(\d+)[ ]*[/:][ ]*(\d+)$/);
  if (mixed) {
    const whole = BigInt(mixed[1]!);
    const num = BigInt(mixed[2]!);
    const den = BigInt(mixed[3]!);
    if (den === 0n) return null;
    // «-1 1/2» читается как -1,5, то есть знак задаёт целая часть:
    // числитель = sign(whole) * (|whole| * den + num).
    const absWhole = whole < 0n ? -whole : whole;
    const sign = whole < 0n ? -1n : 1n;
    return { ...asFraction(sign * (absWhole * den + num), den), kind: "fraction", decimals: 0, written: null, unit: "" };
  }

  // Обычная дробь: «4 / 8» → 1/2.
  const fraction = cleaned.match(/^(-?\d+)[ ]*[/:][ ]*(\d+)$/);
  if (fraction) {
    const den = BigInt(fraction[2]!);
    if (den === 0n) return null;
    return { ...asFraction(BigInt(fraction[1]!), den), kind: "fraction", decimals: 0, written: null, unit: "" };
  }

  // Число с необязательной единицей: «42», «0.50», «5 см», «50%».
  const number = cleaned.match(/^(-?\d+(?:\.\d+)?)(.*)$/);
  if (!number) return null;
  const unit = (number[2] ?? "").trim();
  if (unit && !isUnitLike(unit)) return null;
  return { ...decimalToFraction(number[1]!), kind: "decimal", unit };
}

/**
 * Классифицировать пару «ответ модели / эталон».
 *
 * match        — числа равны (включая эквивалентные записи дроби).
 * mismatch     — числа заведомо разные, вердикт «верно» невозможен.
 * incomparable — не решаем: вердикт остаётся за моделью.
 */
export function classifyAnswerMatch(proposedAnswer: string, expectedAnswer: string): AnswerMatch {
  const a = canonicalize(proposedAnswer);
  const b = canonicalize(expectedAnswer);
  if (!a || !b) return "incomparable";

  if (a.unit !== b.unit) {
    // Единицы с обеих сторон, но разные — расхождение настоящее.
    // С одной стороны — не решаем: запись без единицы тоже норма.
    return a.unit && b.unit ? "mismatch" : "incomparable";
  }

  // Точное числовое равенство: сюда попадает и «42» против «1/2» → mismatch,
  // и «4/8» против «1/2» → match.
  if (a.num * b.den === b.num * a.den) return "match";

  // Числа разные. Если одна сторона записана дробью, а вторая — округлённой
  // десятичной, это может быть одна величина с разной точностью («1/3» и
  // «0.33»). Проверяем округление дроби до знаков после запятой второй стороны:
  // совпало → это НЕ расхождение, а вопрос точности записи, решение по нему
  // принимает модель. Не совпало → расхождение настоящее.
  if (a.kind !== b.kind) {
    const [asDecimal, asFractionValue] = a.kind === "decimal" ? [a, b] : [b, a];
    if (roundFraction(asFractionValue.num, asFractionValue.den, asDecimal.decimals) === asDecimal.written) {
      return "incomparable";
    }
  }

  return "mismatch";
}

export interface SelfVerifyReconcileInput {
  /** Что сказала модель в verify-проходе. */
  modelVerified: boolean;
  /** Извлечённый финальный ответ solve-прохода. */
  proposedAnswer: string;
  /** Эталон из банка задач. Пусто или undefined — эталона нет. */
  expectedAnswer?: string;
}

export interface SelfVerifyReconcileResult {
  verified: boolean;
  /** true = модель сказала «верно», а сверка увидела расхождение. */
  overridden: boolean;
  /** Пояснение для учителя; null, если сверка не вмешивалась. */
  note: string | null;
}

/**
 * Итоговый вердикт = ответ модели, ограниченный детерминированной сверкой.
 *
 * Правило ровно одно: сверка может ЗАПРЕТИТЬ «верно», но никогда не может его
 * выдать. Эталон пуст (задание без эталона) или пара неразрешима — вердикт
 * модели остаётся как есть. Это поведение, а не оптимизация точности.
 */
export function reconcileSelfVerifyVerdict(input: SelfVerifyReconcileInput): SelfVerifyReconcileResult {
  const expected = (input.expectedAnswer ?? "").trim();
  if (!expected) {
    // Эталона нет — сравнивать не с чем. Это нормальный случай, а не сбой:
    // проверяется только корректность решения, и это уже сказал промпт.
    return { verified: input.modelVerified, overridden: false, note: null };
  }

  const verdict = classifyAnswerMatch(input.proposedAnswer, expected);
  if (verdict === "mismatch") {
    return {
      verified: false,
      overridden: input.modelVerified,
      note:
        `Ответ «${input.proposedAnswer.trim()}» не совпадает с эталоном ` +
        `«${expected}» — работа помечена непроверенной по расхождению.`,
    };
  }

  return { verified: input.modelVerified, overridden: false, note: null };
}