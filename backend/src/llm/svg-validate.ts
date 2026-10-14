/**
 * Проверка схемы графика (`chart_spec`) ДО отрисовки (лист 2.1.8).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЗАЧЕМ ЭТОТ ФАЙЛ, А НЕ `zod` НА ФРОНТЕ
 * ─────────────────────────────────────────────────────────────────────────────
 * На фронте схема уже описана в `src/lib/llm/svg-spec.ts` (zod). Продублировать
 * её импортом нельзя: бэк — отдельный npm-проект и файлов фронта не видит.
 * Поэтому контракт переписан здесь вручную, а сверка двух реализаций закрыта
 * тестом `tests/unit/svgGraphGen.test.ts` (набор типов и лимиты совпадают).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ПРАВИЛО, КОТОРОЕ ЗДЕСЬ ГЛАВНОЕ
 * ─────────────────────────────────────────────────────────────────────────────
 * Ответ модели — это текст от внешней системы. Рисовалка на фронте доверяет
 * структуре: она индексирует `data.values[i]` по `data.labels[i]` и рисует
 * то, что пришло. Мусорная схема не «нарисуется криво», а разъедется по
 * индексам или покажет пустые оси. Поэтому здесь две разные реакции:
 *
 *   · НЕИЗВЕСТНОЕ ПОЛЕ — вырезается (белый список ключей). Поле не нужно
 *     рисовальщику, но его присутствие не делает график вредным.
 *   · СЛОМАННЫЕ ДАННЫЕ (нет типа, абсурдные координаты, пустые оси, длины
 *     не совпали, точка вне шкалы, связь на несуществующий атом) — схема
 *     отбрасывается ЦЕЛИКОМ. Рисовать половину нельзя: учитель получит
 *     картинку, которой нет в задании.
 *
 * Проверка БЕЗ zod не случайность: отказ должен возвращать ЧИТАЕМУЮ причину по
 * коду (`absurd-value`, `empty-axis`, …), потому что она уходит в лог — по ней
 * видно, что подмена заготовки была, а не «молча забыли нарисовать».
 */

/** Типы графиков, которые понимает рисовалка на фронте. */
export const CHART_TYPES = [
  "bar",
  "line",
  "pie",
  "number_line",
  "geometry",
  "biology",
  "chemistry",
] as const;

export type ChartType = (typeof CHART_TYPES)[number];

/** Схема, прошедшая проверку. Отдельный тип ради discriminated union на фронте. */
export type ValidChartSpec = { type: ChartType } & Record<string, unknown>;

export type ChartIssueCode =
  | "not-an-object"
  | "missing-type"
  | "unknown-type"
  | "unknown-field"
  | "multiple-charts"
  | "bad-text"
  | "text-too-long"
  | "not-finite"
  | "absurd-value"
  | "too-few-items"
  | "too-many-items"
  | "mismatched-length"
  | "empty-axis"
  | "bad-range"
  | "point-out-of-range"
  | "bad-enum"
  | "bad-symbol"
  | "duplicate-id"
  | "dangling-bond";

export interface ChartIssue {
  code: ChartIssueCode;
  /** Путь до поля, например `data.series[1].values`. */
  path: string;
  detail: string;
}

export interface ChartValidation {
  ok: boolean;
  /** null, когда схема отброшена. */
  spec: ValidChartSpec | null;
  /** Все найденные проблемы — уходят в лог, учителю не показываются. */
  issues: ChartIssue[];
}

/**
 * Потолок для любого числа на графике.
 *
 * 1 000 000 — потому что «координаты в миллионах» (типичный сбой модели, когда
 * она путает единицы измерения и пишет 3 000 000 вместо 3) не рисуются
 * осмысленно: вся разметка схлопывается в одну точку у края. Школьная
 * математика выше этого не поднимается, поэтому отсечка ничего живого не
 * съедает.
 */
export const MAX_ABS_CHART_VALUE = 1_000_000;

/** Границы шкалы `number_line` — как на фронте (`svg-spec.ts`). */
export const MAX_NUMBER_LINE_SPAN = 100;

// ─────────────────────────────────────────────────────────────────────────────
// Помощники
// ─────────────────────────────────────────────────────────────────────────────

interface Ctx {
  issues: ChartIssue[];
  /** Схема битая: дальше проверять смысла нет. */
  fatal: boolean;
}

function issue(ctx: Ctx, code: ChartIssueCode, path: string, detail: string): void {
  ctx.issues.push({ code, path, detail });
}

function fail(ctx: Ctx, code: ChartIssueCode, path: string, detail: string): void {
  issue(ctx, code, path, detail);
  ctx.fatal = true;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

/** Убрать непечатаемые символы — модель иногда рвёт строку прямо посреди JSON. */
function stripControlChars(s: string): string {
  // eslint-disable-next-line no-control-regex -- именно эти символы и чистим
  return s.replace(/[\u0000-\u001f\u007f]/g, "");
}

/**
 * Обязательный текст: 1..max символов, без `<` и `>`.
 *
 * `&` пропускаем: рисовалка сама экранирует XML. А угловые скобки — не
 * пропускаем: это единственное, что отличает «подпись столбца» от куска разметки,
 * и проверять это дешевле, чем искать потом дыру в SVG учительского листа.
 */
function requiredText(
  ctx: Ctx,
  value: unknown,
  path: string,
  max: number,
): string | undefined {
  if (typeof value !== "string") {
    fail(ctx, "bad-text", path, `ожидалась строка, пришло ${typeof value}`);
    return undefined;
  }
  const clean = stripControlChars(value).trim();
  if (clean === "") {
    fail(ctx, "bad-text", path, "пустая строка");
    return undefined;
  }
  if (clean.length > max) {
    fail(ctx, "text-too-long", path, `${clean.length} символов при лимите ${max}`);
    return undefined;
  }
  if (/[<>]/.test(clean)) {
    fail(ctx, "bad-text", path, "в строке есть < или >");
    return undefined;
  }
  return clean;
}

/** Необязательный текст: пустое значение — норма, кривое — нет. */
function optionalText(
  ctx: Ctx,
  value: unknown,
  path: string,
  max: number,
  out: Record<string, unknown>,
  key: string,
): void {
  if (value === undefined || value === null) return;
  const text = requiredText(ctx, value, path, max);
  if (text !== undefined) out[key] = text;
}

function finiteNumber(
  ctx: Ctx,
  value: unknown,
  path: string,
  opts: { min?: number; max?: number } = {},
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(ctx, "not-finite", path, `ожидалось конечное число, пришло ${JSON.stringify(value)}`);
    return undefined;
  }
  // Порядок величины проверяется ДО частных границ: иначе «-3 000 000 см»
  // прошёл бы как «отрицательное число больше нуля» и уехал бы на лист.
  if (Math.abs(value) > MAX_ABS_CHART_VALUE) {
    fail(
      ctx,
      "absurd-value",
      path,
      `|${value}| больше ${MAX_ABS_CHART_VALUE} — похоже на потерянный порядок величины`,
    );
    return undefined;
  }
  if (opts.min !== undefined && value < opts.min) {
    fail(ctx, "absurd-value", path, `${value} меньше допустимого ${opts.min}`);
    return undefined;
  }
  if (opts.max !== undefined && value > opts.max) {
    fail(ctx, "absurd-value", path, `${value} больше допустимого ${opts.max}`);
    return undefined;
  }
  return value;
}

/**
 * Число на графике: конечное, в пределах MAX_ABS_CHART_VALUE.
 *
 * Границы по модулю, а не только сверху: отрицательные значения допустимы
 * (числовая прямая, график функции ниже оси), минус десять тысяч миллионов —
 * нет. Отдельное имя нужно для читаемости мест вызова: `finiteNumber` —
 * «число с частными границами», `chartNumber` — «число, которое попадёт на
 * рисунок».
 */
function chartNumber(ctx: Ctx, value: unknown, path: string): number | undefined {
  return finiteNumber(ctx, value, path);
}

/** Оставить только известные ключи, остальные — в issues. */
function pick(
  ctx: Ctx,
  src: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(src)) {
    if (allowed.includes(key)) out[key] = src[key];
    else issue(ctx, "unknown-field", `${path}${path ? "." : ""}${key}`, "поле не рисуется — вырезано");
  }
  return out;
}

/** Массив строк одинаковой длины — подписи категорий. */
function labelList(
  ctx: Ctx,
  value: unknown,
  path: string,
  min: number,
  max: number,
): string[] | undefined {
  if (!Array.isArray(value)) {
    fail(ctx, "bad-text", path, "ожидался массив подписей");
    return undefined;
  }
  if (value.length < min) {
    fail(ctx, "too-few-items", path, `${value.length} шт. при минимуме ${min}`);
    return undefined;
  }
  if (value.length > max) {
    fail(ctx, "too-many-items", path, `${value.length} шт. при максимуме ${max}`);
    return undefined;
  }
  const out: string[] = [];
  value.forEach((item, i) => {
    const text = requiredText(ctx, item, `${path}[${i}]`, 30);
    if (text !== undefined) out.push(text);
  });
  return out.length === value.length ? out : undefined;
}

function valueList(
  ctx: Ctx,
  value: unknown,
  path: string,
  min: number,
  max: number,
  opts: { nonNegative?: boolean } = {},
): number[] | undefined {
  if (!Array.isArray(value)) {
    fail(ctx, "not-finite", path, "ожидался массив чисел");
    return undefined;
  }
  if (value.length < min) {
    fail(ctx, "too-few-items", path, `${value.length} шт. при минимуме ${min}`);
    return undefined;
  }
  if (value.length > max) {
    fail(ctx, "too-many-items", path, `${value.length} шт. при максимуме ${max}`);
    return undefined;
  }
  const out: number[] = [];
  value.forEach((item, i) => {
    const num =
      opts.nonNegative === true
        ? finiteNumber(ctx, item, `${path}[${i}]`, { min: 0 })
        : chartNumber(ctx, item, `${path}[${i}]`);
    if (num !== undefined) out.push(num);
  });
  return out.length === value.length ? out : undefined;
}

function oneOf<T extends string>(
  ctx: Ctx,
  value: unknown,
  path: string,
  allowed: readonly T[],
): T | undefined {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    fail(ctx, "bad-enum", path, `ожидалось одно из [${allowed.join(", ")}]`);
    return undefined;
  }
  return value as T;
}

function uniqueIds(ctx: Ctx, ids: (string | undefined)[], path: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (id === undefined) continue;
    if (seen.has(id)) {
      fail(ctx, "duplicate-id", path, `идентификатор «${id}» повторяется`);
      return;
    }
    seen.add(id);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Проверки по типам
// ─────────────────────────────────────────────────────────────────────────────

/** Общие текстовые поля, одинаковые у всех типов. */
function commonFields(
  ctx: Ctx,
  src: Record<string, unknown>,
  out: Record<string, unknown>,
): void {
  const title = requiredText(ctx, src.title, "title", 100);
  if (title !== undefined) out.title = title;
  optionalText(ctx, src.x_label, "x_label", 50, out, "x_label");
  optionalText(ctx, src.y_label, "y_label", 50, out, "y_label");
  optionalText(ctx, src.caption, "caption", 150, out, "caption");
  optionalText(ctx, src.question, "question", 150, out, "question");
}

/**
 * Числа столбчатой диаграммы — только неотрицательные.
 *
 * Здесь мы строже фронта (`svg-spec.ts` разрешает любые числа): рисовальщик
 * берёт `Math.max(0, …)` и отрицательный столбец просто исчезает — учитель
 * получает диаграмму без столбца и без причины. Лучше заготовка, чем молча
 * выкинутый элемент. Промпт просит то же самое (`все значения ≥ 0`).
 */
function checkBar(ctx: Ctx, src: Record<string, unknown>, out: Record<string, unknown>): void {
  const raw = pick(ctx, src, ["type", "title", "x_label", "y_label", "caption", "data"], "");
  commonFields(ctx, raw, out);
  const data = isPlainObject(raw.data) ? raw.data : null;
  if (!data) {
    fail(ctx, "bad-text", "data", "нет блока данных");
    return;
  }
  const inner = pick(ctx, data, ["labels", "values"], "data");
  const labels = labelList(ctx, inner.labels, "data.labels", 2, 12);
  const values = valueList(ctx, inner.values, "data.values", 2, 12, { nonNegative: true });
  if (!labels || !values) return;
  if (labels.length !== values.length) {
    fail(ctx, "mismatched-length", "data", `подписей ${labels.length}, значений ${values.length}`);
    return;
  }
  // Все нули — это пустая диаграмма: учитель видит рамку без столбцов и решает,
  // что график сломан. Данные есть, рисовать нечего — возвращаем заготовку.
  if (values.every((v) => v === 0)) {
    fail(ctx, "empty-axis", "data.values", "все значения равны нулю — рисовать нечего");
    return;
  }
  out.data = { labels, values };
}

function checkLine(ctx: Ctx, src: Record<string, unknown>, out: Record<string, unknown>): void {
  const raw = pick(ctx, src, ["type", "title", "x_label", "y_label", "caption", "data"], "");
  commonFields(ctx, raw, out);
  const data = isPlainObject(raw.data) ? raw.data : null;
  if (!data) {
    fail(ctx, "bad-text", "data", "нет блока данных");
    return;
  }
  const inner = pick(ctx, data, ["labels", "series"], "data");
  const labels = labelList(ctx, inner.labels, "data.labels", 2, 20);
  if (!labels) return;
  if (!Array.isArray(inner.series) || inner.series.length < 1) {
    fail(ctx, "too-few-items", "data.series", "нужна хотя бы одна серия");
    return;
  }
  if (inner.series.length > 3) {
    fail(ctx, "too-many-items", "data.series", `${inner.series.length} серий при максимуме 3`);
    return;
  }
  const series: { name: string; values: number[] }[] = [];
  inner.series.forEach((item, i) => {
    if (!isPlainObject(item)) {
      fail(ctx, "bad-text", `data.series[${i}]`, "ожидался объект {name, values}");
      return;
    }
    const name = requiredText(ctx, item.name, `data.series[${i}].name`, 50);
    const values = valueList(ctx, item.values, `data.series[${i}].values`, 2, 20);
    if (!name || !values) return;
    if (values.length !== labels.length) {
      fail(
        ctx,
        "mismatched-length",
        `data.series[${i}].values`,
        `${values.length} значений при ${labels.length} подписях`,
      );
      return;
    }
    series.push({ name, values });
  });
  if (series.length !== inner.series.length) return;
  if (series.every((s) => s.values.every((v) => v === 0))) {
    fail(ctx, "empty-axis", "data.series", "во всех сериях нули — рисовать нечего");
    return;
  }
  out.data = { labels, series };
}

function checkPie(ctx: Ctx, src: Record<string, unknown>, out: Record<string, unknown>): void {
  const raw = pick(ctx, src, ["type", "title", "caption", "data"], "");
  commonFields(ctx, raw, out);
  const data = isPlainObject(raw.data) ? raw.data : null;
  if (!data) {
    fail(ctx, "bad-text", "data", "нет блока данных");
    return;
  }
  const inner = pick(ctx, data, ["labels", "values"], "data");
  const labels = labelList(ctx, inner.labels, "data.labels", 2, 12);
  const values = valueList(ctx, inner.values, "data.values", 2, 12, { nonNegative: true });
  if (!labels || !values) return;
  if (labels.length !== values.length) {
    fail(ctx, "mismatched-length", "data", `подписей ${labels.length}, значений ${values.length}`);
    return;
  }
  if (!values.some((v) => v > 0)) {
    fail(ctx, "empty-axis", "data.values", "все значения нулевые — круг не собрать");
    return;
  }
  out.data = { labels, values };
}

function checkNumberLine(
  ctx: Ctx,
  src: Record<string, unknown>,
  out: Record<string, unknown>,
): void {
  const raw = pick(ctx, src, ["type", "title", "caption", "range", "step", "points"], "");
  commonFields(ctx, raw, out);

  const range = Array.isArray(raw.range) ? raw.range : null;
  if (!range || range.length !== 2) {
    fail(ctx, "bad-range", "range", "ожидалась пара [min, max]");
    return;
  }
  const min = chartNumber(ctx, range[0], "range[0]");
  const max = chartNumber(ctx, range[1], "range[1]");
  if (min === undefined || max === undefined) return;
  if (!(min < max)) {
    fail(ctx, "bad-range", "range", `min (${min}) не меньше max (${max})`);
    return;
  }
  if (max - min > MAX_NUMBER_LINE_SPAN) {
    fail(
      ctx,
      "bad-range",
      "range",
      `размах ${max - min} больше ${MAX_NUMBER_LINE_SPAN} — шкала влезет в подпись оси`,
    );
    return;
  }
  out.range = [min, max];

  if (raw.step !== undefined && raw.step !== null) {
    const step = chartNumber(ctx, raw.step, "step");
    if (step === undefined) return;
    if (step <= 0) {
      fail(ctx, "absurd-value", "step", `шаг должен быть положительным, пришло ${step}`);
      return;
    }
    out.step = step;
  }

  if (raw.points !== undefined && raw.points !== null) {
    if (!Array.isArray(raw.points)) {
      fail(ctx, "bad-text", "points", "ожидался массив точек");
      return;
    }
    if (raw.points.length > 10) {
      fail(ctx, "too-many-items", "points", `${raw.points.length} точек при максимуме 10`);
      return;
    }
    const points: Record<string, unknown>[] = [];
    raw.points.forEach((item, i) => {
      if (!isPlainObject(item)) {
        fail(ctx, "bad-text", `points[${i}]`, "ожидался объект {value, label, color}");
        return;
      }
      const inner = pick(ctx, item, ["value", "label", "color"], `points[${i}]`);
      const value = chartNumber(ctx, inner.value, `points[${i}].value`);
      if (value === undefined) return;
      // Точка вне шкалы не нарисуется: рисовальщик отсекает её краем viewBox,
      // и учитель увидит шкалу без отметки, хотя в задании она есть.
      if (value < min || value > max) {
        fail(ctx, "point-out-of-range", `points[${i}].value`, `${value} вне [${min}, ${max}]`);
        return;
      }
      const point: Record<string, unknown> = { value };
      optionalText(ctx, inner.label, `points[${i}].label`, 30, point, "label");
      if (inner.color !== undefined && inner.color !== null) {
        const color = oneOf(ctx, inner.color, `points[${i}].color`, ["highlight", "normal"]);
        if (color === undefined) return;
        point.color = color;
      }
      points.push(point);
    });
    if (points.length !== raw.points.length) return;
    out.points = points;
  }
}

function checkGeometry(
  ctx: Ctx,
  src: Record<string, unknown>,
  out: Record<string, unknown>,
): void {
  const raw = pick(
    ctx,
    src,
    ["type", "shape", "title", "question", "caption", "annotations", "measurements"],
    "",
  );
  commonFields(ctx, raw, out);
  const shape = oneOf(ctx, raw.shape, "shape", [
    "triangle",
    "rectangle",
    "square",
    "parallelogram",
    "circle",
    "trapezoid",
  ]);
  if (shape === undefined) return;
  out.shape = shape;

  if (raw.annotations !== undefined && raw.annotations !== null) {
    if (!Array.isArray(raw.annotations)) {
      fail(ctx, "bad-text", "annotations", "ожидался массив подписей");
      return;
    }
    if (raw.annotations.length > 8) {
      fail(ctx, "too-many-items", "annotations", `${raw.annotations.length} при максимуме 8`);
      return;
    }
    const annotations: Record<string, unknown>[] = [];
    raw.annotations.forEach((item, i) => {
      if (!isPlainObject(item)) {
        fail(ctx, "bad-text", `annotations[${i}]`, "ожидался объект {label, side}");
        return;
      }
      const inner = pick(ctx, item, ["label", "side"], `annotations[${i}]`);
      const label = requiredText(ctx, inner.label, `annotations[${i}].label`, 50);
      const side = requiredText(ctx, inner.side, `annotations[${i}].side`, 10);
      if (label === undefined || side === undefined) return;
      annotations.push({ label, side });
    });
    if (annotations.length !== raw.annotations.length) return;
    out.annotations = annotations;
  }

  if (raw.measurements !== undefined && raw.measurements !== null) {
    if (!isPlainObject(raw.measurements)) {
      fail(ctx, "bad-text", "measurements", "ожидался объект");
      return;
    }
    const inner = pick(ctx, raw.measurements, ["sides", "angles"], "measurements");
    const measurements: Record<string, unknown> = {};
    if (inner.sides !== undefined && inner.sides !== null) {
      if (!Array.isArray(inner.sides)) {
        fail(ctx, "bad-text", "measurements.sides", "ожидался массив");
        return;
      }
      if (inner.sides.length > 8) {
        fail(ctx, "too-many-items", "measurements.sides", `${inner.sides.length} при максимуме 8`);
        return;
      }
      const sides: Record<string, unknown>[] = [];
      inner.sides.forEach((item, i) => {
        if (!isPlainObject(item)) {
          fail(ctx, "bad-text", `measurements.sides[${i}]`, "ожидался объект");
          return;
        }
        const side = pick(ctx, item, ["id", "value", "unit"], `measurements.sides[${i}]`);
        const id = requiredText(ctx, side.id, `measurements.sides[${i}].id`, 10);
        if (id === undefined) return;
        const out2: Record<string, unknown> = { id };
        if (side.value !== undefined && side.value !== null) {
          const value = finiteNumber(ctx, side.value, `measurements.sides[${i}].value`, { min: 0 });
          if (value === undefined) return;
          out2.value = value;
        }
        optionalText(ctx, side.unit, `measurements.sides[${i}].unit`, 10, out2, "unit");
        sides.push(out2);
      });
      if (sides.length !== inner.sides.length) return;
      uniqueIds(ctx, sides.map((s) => s.id as string), "measurements.sides");
      measurements.sides = sides;
    }
    if (inner.angles !== undefined && inner.angles !== null) {
      if (!Array.isArray(inner.angles)) {
        fail(ctx, "bad-text", "measurements.angles", "ожидался массив");
        return;
      }
      if (inner.angles.length > 8) {
        fail(ctx, "too-many-items", "measurements.angles", `${inner.angles.length} при максимуме 8`);
        return;
      }
      const angles: Record<string, unknown>[] = [];
      inner.angles.forEach((item, i) => {
        if (!isPlainObject(item)) {
          fail(ctx, "bad-text", `measurements.angles[${i}]`, "ожидался объект");
          return;
        }
        const angle = pick(ctx, item, ["id", "value", "unit"], `measurements.angles[${i}]`);
        const id = requiredText(ctx, angle.id, `measurements.angles[${i}].id`, 10);
        if (id === undefined) return;
        const out2: Record<string, unknown> = { id };
        if (angle.value !== undefined && angle.value !== null) {
          const value = finiteNumber(ctx, angle.value, `measurements.angles[${i}].value`, {
            min: 0,
            max: 360,
          });
          if (value === undefined) return;
          out2.value = value;
          // Градусы на шкале геометрии: единица не «°», а «град» — это
          // другой угол. Молча подставлять нельзя, это разные числа.
          out2.unit = "°";
        }
        angles.push(out2);
      });
      if (angles.length !== inner.angles.length) return;
      uniqueIds(ctx, angles.map((a) => a.id as string), "measurements.angles");
      measurements.angles = angles;
    }
    out.measurements = measurements;
  }
}

function checkBiology(ctx: Ctx, src: Record<string, unknown>, out: Record<string, unknown>): void {
  const raw = pick(ctx, src, ["type", "diagram", "title", "question", "caption", "labels"], "");
  commonFields(ctx, raw, out);
  const diagram = oneOf(ctx, raw.diagram, "diagram", [
    "plant-cell",
    "animal-cell",
    "plant",
    "dna",
    "chromosome",
    "animal-class",
  ]);
  if (diagram === undefined) return;
  out.diagram = diagram;
  if (raw.labels === undefined || raw.labels === null) return;
  if (!Array.isArray(raw.labels)) {
    fail(ctx, "bad-text", "labels", "ожидался массив подписей");
    return;
  }
  if (raw.labels.length > 12) {
    fail(ctx, "too-many-items", "labels", `${raw.labels.length} при максимуме 12`);
    return;
  }
  const labels: Record<string, unknown>[] = [];
  raw.labels.forEach((item, i) => {
    if (!isPlainObject(item)) {
      fail(ctx, "bad-text", `labels[${i}]`, "ожидался объект {id, text}");
      return;
    }
    const inner = pick(ctx, item, ["id", "text"], `labels[${i}]`);
    const id = requiredText(ctx, inner.id, `labels[${i}].id`, 30);
    const text = requiredText(ctx, inner.text, `labels[${i}].text`, 100);
    if (id === undefined || text === undefined) return;
    labels.push({ id, text });
  });
  if (labels.length !== raw.labels.length) return;
  uniqueIds(ctx, labels.map((l) => l.id as string), "labels");
  out.labels = labels;
}

function checkChemistry(ctx: Ctx, src: Record<string, unknown>, out: Record<string, unknown>): void {
  const raw = pick(
    ctx,
    src,
    ["type", "diagram", "title", "question", "caption", "atoms", "bonds", "labels"],
    "",
  );
  commonFields(ctx, raw, out);
  const diagram = oneOf(ctx, raw.diagram, "diagram", ["atom", "molecule", "periodic", "reaction"]);
  if (diagram === undefined) return;
  out.diagram = diagram;

  const atomIds: string[] = [];
  if (raw.atoms !== undefined && raw.atoms !== null) {
    if (!Array.isArray(raw.atoms)) {
      fail(ctx, "bad-text", "atoms", "ожидался массив атомов");
      return;
    }
    if (raw.atoms.length > 20) {
      fail(ctx, "too-many-items", "atoms", `${raw.atoms.length} при максимуме 20`);
      return;
    }
    const atoms: Record<string, unknown>[] = [];
    raw.atoms.forEach((item, i) => {
      if (!isPlainObject(item)) {
        fail(ctx, "bad-text", `atoms[${i}]`, "ожидался объект {id, symbol}");
        return;
      }
      const inner = pick(ctx, item, ["id", "symbol"], `atoms[${i}]`);
      const id = requiredText(ctx, inner.id, `atoms[${i}].id`, 10);
      const symbol = requiredText(ctx, inner.symbol, `atoms[${i}].symbol`, 3);
      if (id === undefined || symbol === undefined) return;
      // Символ элемента — это буква и, возможно, строчная: «Fe», «O», «C».
      // Всё остальное («H2O», «<img», «7») — не символ, а мусор, который
      // нарисуется подписью внутри схемы молекулы.
      if (!/^[A-Z][a-z]?$/.test(symbol)) {
        fail(ctx, "bad-symbol", `atoms[${i}].symbol`, `«${symbol}» не похож на символ элемента`);
        return;
      }
      atoms.push({ id, symbol });
      atomIds.push(id);
    });
    if (atoms.length !== raw.atoms.length) return;
    uniqueIds(ctx, atomIds, "atoms");
    out.atoms = atoms;
  }

  if (raw.bonds !== undefined && raw.bonds !== null) {
    if (!Array.isArray(raw.bonds)) {
      fail(ctx, "bad-text", "bonds", " ожидался массив связей");
      return;
    }
    if (raw.bonds.length > 30) {
      fail(ctx, "too-many-items", "bonds", `${raw.bonds.length} при максимуме 30`);
      return;
    }
    const bonds: Record<string, unknown>[] = [];
    raw.bonds.forEach((item, i) => {
      if (!isPlainObject(item)) {
        fail(ctx, "bad-text", `bonds[${i}]`, "ожидался объект {from, to}");
        return;
      }
      const inner = pick(ctx, item, ["from", "to"], `bonds[${i}]`);
      const from = requiredText(ctx, inner.from, `bonds[${i}].from`, 10);
      const to = requiredText(ctx, inner.to, `bonds[${i}].to`, 10);
      if (from === undefined || to === undefined) return;
      // Связь на несуществующий атом рисовальщик не нарисует, а учитель увидит
      // молекулу с «висящим» концом. Если атомы не переданы — сверять не с чем.
      if (atomIds.length > 0 && (!atomIds.includes(from) || !atomIds.includes(to))) {
        fail(ctx, "dangling-bond", `bonds[${i}]`, `связь ${from}→${to} ссылается на неизвестный атом`);
        return;
      }
      bonds.push({ from, to });
    });
    if (bonds.length !== raw.bonds.length) return;
    out.bonds = bonds;
  }

  if (raw.labels !== undefined && raw.labels !== null) {
    if (!Array.isArray(raw.labels)) {
      fail(ctx, "bad-text", "labels", "ожидался массив подписей");
      return;
    }
    if (raw.labels.length > 12) {
      fail(ctx, "too-many-items", "labels", `${raw.labels.length} при максимуме 12`);
      return;
    }
    const labels: Record<string, unknown>[] = [];
    raw.labels.forEach((item, i) => {
      if (!isPlainObject(item)) {
        fail(ctx, "bad-text", `labels[${i}]`, "ожидался объект {id, text}");
        return;
      }
      const inner = pick(ctx, item, ["id", "text"], `labels[${i}]`);
      const id = requiredText(ctx, inner.id, `labels[${i}].id`, 30);
      const text = requiredText(ctx, inner.text, `labels[${i}].text`, 100);
      if (id === undefined || text === undefined) return;
      labels.push({ id, text });
    });
    if (labels.length !== raw.labels.length) return;
    uniqueIds(ctx, labels.map((l) => l.id as string), "labels");
    out.labels = labels;
  }
}

const CHECKERS: Record<ChartType, (ctx: Ctx, src: Record<string, unknown>, out: Record<string, unknown>) => void> = {
  bar: checkBar,
  line: checkLine,
  pie: checkPie,
  number_line: checkNumberLine,
  geometry: checkGeometry,
  biology: checkBiology,
  chemistry: checkChemistry,
};

// ─────────────────────────────────────────────────────────────────────────────
// Точка входа
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Проверить одну схему графика.
 *
 * НЕ БРОСАЕТ: битая схема — это `ok: false` с причинами, а не исключение.
 * Вызывающий (конвейер листа) обязан продолжить генерацию и отдать учителю
 * лист без графика.
 */
export function validateChartSpec(raw: unknown): ChartValidation {
  const ctx: Ctx = { issues: [], fatal: false };

  if (raw === null || raw === undefined) {
    fail(ctx, "not-an-object", "", "схемы нет");
    return { ok: false, spec: null, issues: ctx.issues };
  }
  if (Array.isArray(raw)) {
    // Модель вернула два графика там, где просили один. Выбирать «первый
    // похожий» — угадывание: непонятно, к какому заданию он относится.
    // Отбрасываем целиком и пишем причину.
    fail(ctx, "multiple-charts", "", `вернулось ${raw.length} графиков вместо одного`);
    return { ok: false, spec: null, issues: ctx.issues };
  }
  if (!isPlainObject(raw)) {
    fail(ctx, "not-an-object", "", `пришло ${typeof raw}`);
    return { ok: false, spec: null, issues: ctx.issues };
  }
  if (raw.type === undefined || raw.type === null) {
    fail(ctx, "missing-type", "type", "нет поля type");
    return { ok: false, spec: null, issues: ctx.issues };
  }
  if (typeof raw.type !== "string" || !CHART_TYPES.includes(raw.type as ChartType)) {
    fail(ctx, "unknown-type", "type", `«${String(raw.type)}» не рисуется фронтом`);
    return { ok: false, spec: null, issues: ctx.issues };
  }

  const out: Record<string, unknown> = { type: raw.type };
  CHECKERS[raw.type as ChartType](ctx, raw, out);

  // Неизвестные поля не делают график вредным — их уже вырезал `pick` внутри
  // проверки типа. Остаётся убедиться, что критичного ничего не накопилось.
  if (ctx.fatal) return { ok: false, spec: null, issues: ctx.issues };
  return { ok: true, spec: out as ValidChartSpec, issues: ctx.issues };
}

/** Короткая строка для лога: `unknown-type:type, absurd-value:data.values`. */
export function formatIssues(issues: readonly ChartIssue[]): string {
  return issues.map((i) => `${i.code}:${i.path}`).join(", ");
}