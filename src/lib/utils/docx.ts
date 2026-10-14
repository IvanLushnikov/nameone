import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  PageOrientation,
  Table,
  TableLayoutType,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  Footer,
  Header,
  PageNumber,
  Math as DocxMath,
  type ParagraphChild,
} from "docx";
import type { Worksheet, WorksheetTask } from "@/lib/types";
import { parseMathText, type MathSegment } from "@/lib/math/latex";
import { latexToOmml, latexToUnicode } from "@/lib/math/latex-to-omml";
import { SITE_HOST } from "@/lib/site";
// ТЗ-26 Ф-3: в шапку и в свойства файла — название предмета по-русски,
// а не внутренний ключ (`algebra`).
import { subjectDisplayName } from "@/lib/content/subject-display-name";

/**
 * Генератор DOCX для рабочего листа.
 * Учитель может открыть в Word/LibreOffice и отредактировать.
 */

/**
 * Задание с опциональным LaTeX-полем (Ф-10).
 *
 * `text_latex` в `src/lib/types.ts` пока нет — берём структурным пересечением,
 * тем же приёмом, что и `chartSpec` в WorksheetPreview. `text` не подменяем:
 * он остаётся источником правды для проверки ответов, `text_latex` — только
 * для отрисовки (здесь — в виде OMML, потому что KaTeX в документ не едет).
 */
type TaskWithLatex = WorksheetTask & { text_latex?: string };

/* -------------------------------------------------------------------------- */
/*  Дробь, написанная через косую черту                                       */
/* -------------------------------------------------------------------------- */

/**
 * ЗАЧЕМ ЭТОТ БЛОК (лист 2.1.4, решение владельца 14.10.2026).
 *
 * `parseMathText` (LEGACY-режим) умеет дробь вида `3/4` — там атом с обеих
 * сторон. Но `(x² − 9)/(x² + 6x + 9)` он НЕ узнаёт: по обе стороны косой
 * черты не атом, а выражение в скобках. Такая строка уходила в экран и в
 * DOCX обычным текстом — учитель видел «(x² − 9)/(x² + 6x + 9)», то есть
 * ровно то, из-за чего материал выдаёт генератор.
 *
 * Модуль живёт здесь, а не в `MathText`, потому что ЭКРАН и ВЫГРУЗКА обязаны
 * резать текст одинаково: если превью покажет дробь с чертой, а DOCX — строку,
 * учитель получит два разных материала. Зависимость при этом односторонняя:
 * клиентский компонент `MathText` импортирует чистую функцию отсюда, а этот
 * модуль ничего не знает про React (обратная зависимость сломала бы границу
 * сервер/клиент в Next).
 *
 * ЧЕГО МЫ НЕ ТРОГАЕМ. Атом/атом (`3/4`, `x/2`, `12/16`) и степени в скобках
 * (`8^(1/3)`) уже разбирает `parseLegacyMath` — если скобок рядом с чертой
 * нет, мы молча отступаем и не лезем в его работу. Так мы физически не можем
 * испортить то, что сегодня работает, и не превращаем «км/ч» или «июль/август»
 * в дроби.
 */

/** Часть «атома»: буква или цифра (в том числе с точкой/запятой). */
const ATOM_CHAR = /[0-9A-Za-zА-Яа-яЁё.,]/;

/**
 * Верхние индексы в юникоде — часть атома (`x²`, `10⁻³`). В LaTeX их не
 * переводим: см. комментарий про `innerFractions` и потерю степени в OMML.
 */
const SUPERSCRIPT_CHAR = /[\u00B9\u00B2\u00B3\u2070\u2074-\u2079\u207B\u207A]/;

/**
 * Что вообще допустимо отдать KaTeX/OMML как числитель или знаменатель.
 * Всё остальное (`%`, `#`, `$`, `&`) НЕ пропускаем: такие строки оставляем
 * как есть, потому что сломанная формула хуже, чем её отсутствие.
 */
const LATEX_SAFE =
  /^[0-9A-Za-zА-Яа-яЁё\s+\-−=^_.,()·×÷°\u00B9\u00B2\u00B3\u2070\u2074-\u2079\u207B\u207A]*$/;

type Operand = {
  /** Содержимое без внешних скобок. */
  text: string;
  /** Границы в исходной строке — по ним собирается `fallback`. */
  start: number;
  end: number;
  /** Сторона была в скобках — именно этот случай раньше не распознавался. */
  paren: boolean;
};

function matchParenForward(input: string, open: number): number {
  let depth = 0;
  for (let i = open; i < input.length; i += 1) {
    if (input[i] === "(") depth += 1;
    else if (input[i] === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function matchParenBackward(input: string, close: number): number {
  let depth = 0;
  for (let i = close; i >= 0; i -= 1) {
    if (input[i] === ")") depth += 1;
    else if (input[i] === "(") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function isAtomChar(ch: string | undefined): boolean {
  if (ch === undefined) return false;
  return ATOM_CHAR.test(ch) || SUPERSCRIPT_CHAR.test(ch);
}

/** Слева от `/`: скобочная группа либо максимальный «атом». */
function readLeft(input: string, slash: number): Operand | null {
  let i = slash - 1;
  while (i >= 0 && /\s/.test(input[i])) i -= 1;
  if (i < 0) return null;

  if (input[i] === ")") {
    const open = matchParenBackward(input, i);
    if (open < 0) return null;
    return { text: input.slice(open + 1, i), start: open, end: i + 1, paren: true };
  }

  let start = i;
  while (start - 1 >= 0 && isAtomChar(input[start - 1])) start -= 1;
  // Минус приклеиваем к атому, иначе в дроби `-3/(x + 1)` знак уедет наружу и
  // в DOCX уедет текстовый «−» перед формулой вместо числителя «−3».
  if (start > 0 && (input[start - 1] === "-" || input[start - 1] === "\u2212")) start -= 1;
  return { text: input.slice(start, i + 1), start, end: i + 1, paren: false };
}

/** Справа от `/`: скобочная группа либо максимальный «атом». */
function readRight(input: string, from: number): Operand | null {
  let i = from;
  while (i < input.length && /\s/.test(input[i])) i += 1;
  if (i >= input.length) return null;

  if (input[i] === "(") {
    const close = matchParenForward(input, i);
    if (close < 0) return null;
    return { text: input.slice(i + 1, close), start: i, end: close + 1, paren: true };
  }

  let end = i + 1;
  while (end < input.length && isAtomChar(input[end])) end += 1;
  return { text: input.slice(i, end), start: i, end, paren: false };
}

/** Простая дробь внутри скобок: `(1/2)/(3/4)` → вложенный `\frac`. */
const INNER_FRACTION_RE = new RegExp(
  String.raw`(-?\d+(?:[.,]\d+)?|[A-Za-zА-Яа-яЁё])\/(-?\d+(?:[.,]\d+)?|[A-Za-zА-Яа-яЁё])`,
  "g"
);

function innerFractions(latex: string): string {
  return latex.replace(INNER_FRACTION_RE, (whole, num: string, den: string) => {
    // Буквы с обеих сторон — это не дробь («км/ч»).
    if (!/^-?\d/.test(num) && !/^\d/.test(den)) return whole;
    return `\\frac{${num}}{${den}}`;
  });
}

/**
 * Верхние индексы мы в числа НЕ переводим: `x²` остаётся `x²` и в KaTeX, и в
 * OMML-конвертере.
 *
 * Соблазн большой: в Word юникодный «²» в обычном текстовом run не поднимается
 * над базовой линией, а `x^{2}` даёт настоящий надстрочный индекс. Но
 * `latex-to-omml.ts` (файл НЕ в этом листе) при разборе аргумента в фигурных
 * скобках возвращает `slots.map((slot) => slot.node)` — вместе со скриптами.
 * То есть `\frac{x^{2}}{y}` теряет двойку ЦЕЛИКОМ и в Word выходит `x` вместо
 * `x²`. Потерянная степень хуже неподнятой: материал с неверной формулой учитель
 * отдаст в класс. Поэтому оставляем юникод — он читается и в Word, и в KaTeX.
 *
 * Лист 2.1.5 закрыл половину этой дыры: `keepScriptsInsideFrac` ниже страхует
 * `^{...}`/`_{...}` внутри числителя и знаменателя (степень не теряется). До
 * настоящего надстрочного индекса OMML внутри дроби дело дойдёт, когда
 * `parseArgument` в `latex-to-omml.ts` перестанет выбрасывать скрипты.
 */

/** Дописывает обычный текст к предыдущему сегменту, не разрывая его на два span. */
function pushText(segments: MathSegment[], value: string): void {
  if (!value) return;
  const last = segments[segments.length - 1];
  if (last && last.type === "text") last.value += value;
  else segments.push({ type: "text", value });
}

/**
 * Режет кусок обычного текста на «скобочные» дроби: `(x² − 9)/(x² + 6x + 9)`,
 * `5/(x + 1)`, `(a+b)/c`, `(1/2)/(3/4)`.
 *
 * `fallback` у такой дроби — ИСХОДНЫЙ текст со косой чертой. То есть если
 * KaTeX не загрузится или формула не разберётся, учитель получит ровно то,
 * что видел раньше, — а не `frac{x^2 - 9}{...}`.
 */
function splitComplexFractions(input: string): MathSegment[] {
  const segments: MathSegment[] = [];
  let last = 0;

  for (let i = 0; i < input.length; i += 1) {
    if (input[i] !== "/") continue;
    // Черт уже съеден предыдущей дробью — заходить внутрь нельзя.
    if (i < last) continue;

    const left = readLeft(input, i);
    if (!left) continue;
    const right = readRight(input, i + 1);
    if (!right) continue;
    // Без скобок это атом/атом — зона ответственности parseLegacyMath.
    if (!left.paren && !right.paren) continue;
    // Перед скобками стоит имя функции: `sin(x)/2`. Если завернуть в дробь одни
    // скобки, «sin» отделится от своей дроби и запись станет НЕВЕРНОЙ. Такое
    // оставляем линейным — так оно и выглядело раньше.
    if (left.paren && left.start > 0 && /[A-Za-zА-Яа-яЁё]/.test(input[left.start - 1])) continue;

    const num = left.text.trim();
    const den = right.text.trim();
    if (!num || !den) continue;
    if (!LATEX_SAFE.test(num) || !LATEX_SAFE.test(den)) continue;

    const numLatex = innerFractions(num);
    const denLatex = innerFractions(den);

    pushText(segments, input.slice(last, left.start));
    segments.push({
      type: "math",
      latex: `\\frac{${numLatex}}{${denLatex}}`,
      fallback: input.slice(left.start, right.end),
    });

    last = right.end;
    i = right.end - 1;
  }

  pushText(segments, input.slice(last));

  return segments;
}

/**
 * Единая точка разделения текста задания на текст и формулы.
 *
 * Ею пользуются ОБА вывода материала: превью (`MathText` → KaTeX) и DOCX
 * (`mathChildren` ниже → OMML). Расходиться им нельзя: учитель сверяет
 * распечатку с тем, что видел на экране.
 */
export function splitFormulaText(text: string, textLatex?: string | null): MathSegment[] {
  const base = parseMathText(text, textLatex);
  const result: MathSegment[] = [];

  for (const segment of base) {
    if (segment.type === "text") result.push(...splitComplexFractions(segment.value));
    else result.push(segment);
  }

  return result;
}

/** Оформление обычных (не формульных) кусков текста внутри абзаца. */
type FormulaTextRunOptions = {
  bold?: boolean;
  italics?: boolean;
  color?: string;
  size?: number;
};

/* -------------------------------------------------------------------------- */
/*  Степень внутри дроби: почему нужен страховочный перевод                      */
/* -------------------------------------------------------------------------- */

/**
 * Ищет парную `{...}` после `\frac` и возвращает границы обоих аргументов
 * (числителя и знаменателя). Это НЕ второй разбор формул — только балансировка
 * скобок, чтобы точечно починить конкретное место.
 */
function fracArgumentRanges(src: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let i = 0;

  while (i < src.length) {
    if (!src.startsWith("\\frac", i)) {
      i += 1;
      continue;
    }
    let j = i + "\\frac".length;
    for (let arg = 0; arg < 2; arg += 1) {
      while (j < src.length && /\s/.test(src[j])) j += 1;
      if (src[j] !== "{") break;
      let depth = 0;
      let close = -1;
      for (let k = j; k < src.length; k += 1) {
        if (src[k] === "{") depth += 1;
        else if (src[k] === "}") {
          depth -= 1;
          if (depth === 0) {
            close = k;
            break;
          }
        }
      }
      if (close < 0) break;
      ranges.push([j, close]);
      j = close + 1;
    }
    i = j;
  }

  return ranges;
}

/**
 * ЗАЧЕМ ЭТА СТРАХОВКА (лист 2.1.5, п. 3).
 *
 * `latex-to-omml.ts` при разборе аргумента команды в фигурных скобках
 * возвращает `slots.map((slot) => slot.node)` — то есть ВМЕСТЕ СО СКРИПТАМИ.
 * На верхнем уровне `x^{2}` собирается в `MathSuperScript` корректно, а внутри
 * аргумента двойка пропадает ЦЕЛИКОМ: `\frac{x^{2}}{y}` уезжает в Word как
 * `\frac{x}{y}`. Это не «некрасиво», а неверная формула в материале, который
 * учитель отдаёт в класс.
 *
 * Что делаем. Внутри числителя и знаменателя `^{...}`/`_{...}` переводим
 * юникодом ЧЕРЕЗ `latexToUnicode` — это тот же самый юникод-слой, на который
 * уже опирается рабочий лист для `x²`, поэтому и читаемость, и внешний вид
 * совпадают с сегодняшним поведением. Вне дробей ничего не трогаем: там
 * конвертер степень обрабатывает и так, и настоящий надстрочный индекс в Word
 * лучше юникодного.
 *
 * ЧЕГО ЭТО НЕ ДЕЛАЕТ. Настоящий надстрочный индекс ВНУТРИ дроби (`<m:sSup>`
 * внутри `<m:num>`) требует правки самого `parseArgument` в
 * `latex-to-omml.ts` — файл не в этом листе. Поэтому здесь гарантируется
 * «степень НЕ потеряна», а не «степень набрана OMML-скриптом».
 */
function keepScriptsInsideFrac(latex: string): string {
  if (!latex.includes("\\frac")) return latex;

  const ranges = fracArgumentRanges(latex);
  if (ranges.length === 0) return latex;

  let out = latex;
  // С конца, чтобы границы предыдущих правок не «поехали».
  for (let r = ranges.length - 1; r >= 0; r -= 1) {
    const [start, end] = ranges[r];
    const body = out
      .slice(start + 1, end)
      .replace(/\^\s*\{([^{}]*)\}/g, (_w, script: string) => latexToUnicode(`^{${script}}`))
      .replace(/_\s*\{([^{}]*)\}/g, (_w, script: string) => latexToUnicode(`_{${script}}`));
    out = out.slice(0, start + 1) + body + out.slice(end);
  }
  return out;
}

/** Единственная точка вызова конвертера: сначала страховка степени, потом OMML. */
function toOmml(latex: string) {
  return latexToOmml(keepScriptsInsideFrac(latex));
}

/* -------------------------------------------------------------------------- */
/*  OMML → строка XML (для PPTX)                                                */
/* -------------------------------------------------------------------------- */

/**
 * Объекты `docx` умеют отдавать разобранное OMML-дерево (`prepForXml`), и для
 * PPTX это ровно то, что нужно: PowerPoint хранит формулы тем же языком OMML,
 * только в обёртке `a14:m`. Собирать второй LaTeX-разбор ради этого нельзя —
 * он разъехался бы с DOCX-конвертером. Здесь только СЕРИАЛИЗАЦИЯ уже
 * разобранного дерева, без единого решения о том, что такое дробь и степень.
 */
type OmmlTree = Record<string, unknown>;

function isOmmlTree(value: unknown): value is OmmlTree {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ommlEscape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function ommlAttrs(tree: OmmlTree): string {
  const raw = tree._attr;
  if (!isOmmlTree(raw)) return "";
  return Object.entries(raw)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => ` ${k}="${ommlEscape(String(v))}"`)
    .join("");
}

/** Атрибутов нет и детей нет — `<m:degHide/>`, иначе пара с содержимым. */
function ommlIsEmptyElement(value: unknown): boolean {
  return (
    isOmmlTree(value) &&
    Object.entries(value)
      .filter(([k]) => k !== "_attr")
      .every(([, v]) => v === undefined || (Array.isArray(v) && v.length === 0))
  );
}

function ommlValueToXml(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return ommlEscape(value);
  if (typeof value === "number" || typeof value === "boolean") return ommlEscape(String(value));
  if (Array.isArray(value)) return value.map(ommlValueToXml).join("");
  return ommlChildrenToXml(value as OmmlTree);
}

function ommlChildrenToXml(tree: OmmlTree): string {
  return Object.entries(tree)
    .filter(([key]) => key !== "_attr")
    .map(([key, value]) => {
      if (ommlIsEmptyElement(value)) return `<${key}${ommlAttrs(value as OmmlTree)}/>`;
      if (Array.isArray(value)) return `<${key}>${ommlValueToXml(value)}</${key}>`;
      return `<${key}${ommlAttrs(value as OmmlTree)}>${ommlValueToXml(value)}</${key}>`;
    })
    .join("");
}

/**
 * LaTeX → строка OMML для PPTX.
 *
 * @returns готовый фрагмент `<m:oMath>…</m:oMath>`, либо `null`, если формула
 *          не входит в поддерживаемое подмножество — вызывающий обязан откатиться
 *          на юникод.
 */
export function ommlXml(latex: string): string | null {
  const components = toOmml(latex);
  if (!components || components.length === 0) return null;

  const xml = components
    .flatMap((component) => {
      // `prepForXml` — внутренний метод `XmlComponent`; в контекст ему не
      // нужно ничего (Math-классы его игнорируют), но тип его требует.
      const prep = (component as unknown as { prepForXml?: (ctx: unknown) => unknown }).prepForXml;
      if (typeof prep !== "function") return [];
      const tree = prep.call(component, { file: {}, viewWrapper: {}, stack: [] });
      return isOmmlTree(tree) ? [ommlChildrenToXml(tree)] : [];
    })
    .join("");

  return xml === "" ? null : `<m:oMath>${xml}</m:oMath>`;
}

/* -------------------------------------------------------------------------- */
/*  Сегменты → содержимое абзаца                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Сегменты → содержимое абзаца, где формулы становятся нативной математикой
 * Word. Текстовые сегменты идут обычными `TextRun`, формульные — OMML через
 * `latexToOmml`.
 *
 * @returns `null`, если хоть одну формулу в OMML превести не удалось.
 */
function ommlChildren(
  segments: readonly MathSegment[],
  run: FormulaTextRunOptions = {}
): ParagraphChild[] | null {
  const children: ParagraphChild[] = [];
  for (const segment of segments) {
    if (segment.type === "text") {
      if (segment.value) children.push(new TextRun({ text: segment.value, ...run }));
      continue;
    }
    const omml = toOmml(segment.latex);
    if (!omml) return null;
    children.push(new DocxMath({ children: omml }));
  }
  return children;
}

/**
 * Тот же абзац, но с юникод-фолбэком вместо OMML (`⅛ ⅓ ² √ × ·`).
 * Последний рубеж: файл обязан остаться читаемым, лучше «2/3», чем пустота.
 */
function unicodeChildren(
  segments: readonly MathSegment[],
  run: FormulaTextRunOptions = {}
): ParagraphChild[] {
  const children: ParagraphChild[] = [];
  for (const segment of segments) {
    if (segment.type === "text") {
      if (segment.value) children.push(new TextRun({ text: segment.value, ...run }));
      continue;
    }
    children.push(new TextRun({ text: latexToUnicode(segment.latex), ...run }));
  }
  return children;
}

/**
 * Собирает содержимое абзаца рабочего листа.
 *
 * ОТКАТ НА ИСХОДНЫЙ `text`. Если формула из `text_latex` в OMML не
 * превратилась, абзац собирается заново из `text` — ровно так же, как ведёт себя
 * превью (состояние `failed` в `MathText`). Это не перестраховка, а защита от
 * тихой порчи материала: у неразобранной формулы нет читаемого запасного вида,
 * `latexToUnicode("\\frac{1}{")` выдаёт «1», и в раздаточном файле вместо
 * задания «Упростите выражение (a + 3)/(a − 3)» оказывается «Упростите
 * выражение 1». Источник правды для проверки ответов — `text`, и в файл должен
 * попадать именно он.
 */
function mathChildren(text: string, textLatex?: string, size?: number): ParagraphChild[] {
  return formulaChildren(text, { textLatex, size });
}

/**
 * ОБЩАЯ ТОЧКА ВХОДА ДЛЯ ВСЕХ ТИПОВ МАТЕРИАЛА (лист 2.1.5).
 *
 * Карточки, КТП, план урока и презентация обязаны резать текст РОВНО ТАК ЖЕ,
 * как рабочий лист, иначе учитель сверяет распечатку с экраном и видит разные
 * формулы в одном материале. Поэтому каждый из этих модулей зовёт эту функцию,
 * а не пишет свой разбор: второй разбор — это гарантированный расхожий
 * результат через месяц (один поправили, второй забыли).
 *
 * Формулы едут в Word нативной математикой (`<m:f>`), а не строкой в скобках,
 * и учитель может их править прямо в документе.
 */
export function formulaChildren(
  text: string,
  options: FormulaTextRunOptions & { textLatex?: string | null } = {}
): ParagraphChild[] {
  const { textLatex, ...run } = options;

  const segments = splitFormulaText(text, textLatex);

  const children = ommlChildren(segments, run);
  if (children) return children;

  // Тот же откат, что у рабочего листа: битый `text_latex` уводит абзац на
  // исходный `text`, чтобы в файл не уехал огрызок формулы.
  const plain = splitFormulaText(text, undefined);
  return ommlChildren(plain, run) ?? unicodeChildren(plain, run);
}

/**
 * Ширины колонок таблицы ответов.
 *
 * Заданы ОДИН раз и используются в трёх местах: на `Table` (`columnWidths`),
 * на всех строках (`width` в `TableRow`) и через `layout: FIXED`. Раньше
 * ширины были только в строке заголовка, из-за чего Google Docs рисовал
 * посимвольные колонки (скрин от учительницы) — ему не хватало сетки
 * `tblGrid` и фиксированного layout.
 *
 * Единицы — DXA (twips). A4 портрет = 11906, минус поля 1000+1000 = 9906.
 * Пропорции 8 / 32 / 60 (№ / Ответ / Пояснение) от ширины 9906.
 */
const COL_NO_PCT = 8;
const COL_ANSWER_PCT = 32;
const COL_EXPLAIN_PCT = 60;
const TABLE_TOTAL_DXA = 9906;
const COLUMN_WIDTHS_DXA = [
  Math.round((TABLE_TOTAL_DXA * COL_NO_PCT) / 100),
  Math.round((TABLE_TOTAL_DXA * COL_ANSWER_PCT) / 100),
  Math.round((TABLE_TOTAL_DXA * COL_EXPLAIN_PCT) / 100),
];

/** То же самое, но в процентах — так надёжнее понимают Word и LibreOffice. */
const COLUMN_WIDTHS_PCT = [COL_NO_PCT, COL_ANSWER_PCT, COL_EXPLAIN_PCT];

/**
 * `width` для ячейки по индексу колонки. Задаём ВСЕМ строкам (и шапке, и
 * данным) — иначе строки данных растягиваются по содержимому.
 */
function cellWidthPct(colIndex: number): { size: number; type: (typeof WidthType)[keyof typeof WidthType] } {
  return { size: COLUMN_WIDTHS_PCT[colIndex] ?? 100, type: WidthType.PERCENTAGE };
}

export async function generateWorksheetDocx(
  worksheet: Worksheet,
  options: { withAnswers?: boolean; withExplanations?: boolean; isDemo?: boolean } = {}
): Promise<Blob> {
  const { withAnswers = true, withExplanations = true, isDemo = false } = options;

  const children: Array<Paragraph | Table> = [];

  // Пометка заготовки — ПЕРВОЙ строкой файла (NEW-EXPORT-1, 06.10.2026).
  //
  // На экране демо-режим помечен плашкой, на печати — водяным знаком, а вот
  // выгруженный DOCX выглядел ровно как обычный готовый материал: учитель
  // отдавал его на печать или в класс, не зная, что это типовой шаблон.
  // Заготовка обязана быть видна в самом файле — иначе пометка теряется
  // ровно там, где файл уходит из приложения.
  if (isDemo) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: "ДЕМОНСТРАЦИОННАЯ ЗАГОТОВКА",
            bold: true,
            size: 22,
            color: "C0392B",
          }),
        ],
        alignment: AlignmentType.LEFT,
        spacing: { after: 60 },
      })
    );
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: "Это типовой шаблон, а не созданный материал. Текст заданий не учительский — не раздавайте его ученикам.",
            size: 18,
            color: "C0392B",
          }),
        ],
        alignment: AlignmentType.LEFT,
        spacing: { after: 240 },
      })
    );
  }

  // Шапка листа
  children.push(
    new Paragraph({
      text: "Рабочий лист",
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.LEFT,
      spacing: { after: 60 },
    }),
    new Paragraph({
      children: [
        new TextRun({ text: worksheet.title, bold: true, size: 28 }),
      ],
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          // ТЗ-26 Ф-3: раньше здесь печатался ключ предмета —
          // «algebra · 8 класс». Ключ остаётся ключом (роутеры, запросы к бэку),
          // но в раздаточном материале его быть не должно.
          text: `${subjectDisplayName(worksheet.subject)} · ${worksheet.grade} класс · `,
        }),
        new TextRun({
          text:
            worksheet.difficulty === "easy"
              ? "лёгкий уровень"
              : worksheet.difficulty === "medium"
                ? "средний уровень"
                : "сложный уровень",
        }),
      ],
      spacing: { after: 200 },
    })
  );

  // Поля для имени и класса
  children.push(
    new Paragraph({
      children: [new TextRun({ text: "Имя: ____________________________________", size: 22 })],
      spacing: { after: 120 },
    }),
    new Paragraph({
      children: [new TextRun({ text: "Класс: ___________________________________", size: 22 })],
      spacing: { after: 240 },
    })
  );

  // Задания
  for (const task of worksheet.tasks) {
    const taskLatex = (task as TaskWithLatex).text_latex;

    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: `${task.number}. `, size: 24 }),
          ...mathChildren(task.text, taskLatex, 24),
        ],
        spacing: { after: 80 },
      }),
      ...(task.options ?? []).map(
        (opt, i) =>
          new Paragraph({
            children: [
              new TextRun({ text: `   ${String.fromCharCode(65 + i)}) `, size: 22 }),
              ...mathChildren(opt, undefined, 22),
            ],
            spacing: { after: 40 },
          })
      ),
      new Paragraph({
        children: [
          new TextRun({
            text: `Ответ: ________________________________________________     (${task.points} ${task.points === 1 ? "балл" : "балла"})`,
            size: 20,
            color: "888888",
          }),
        ],
        spacing: { after: 240 },
      })
    );
  }

  // Подвал листа
  // Подвал листа.
  // ВАЖНО: «проверено AI» пишем ТОЛЬКО когда проверка реально прошла.
  // Раньше строка печаталась безусловно, для любого листа: на экране бейдж
  // честно показывал «не проверено» (и исчезал на печати), а в скачанном
  // DOCX оставалось утверждение «проверено AI» — ровно тот вопрос, который
  // задала учительница.
  const allVerified =
    !isDemo &&
    worksheet.tasks.length > 0 &&
    worksheet.tasks.every((t) => t.verified === true);

  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: isDemo
            ? `УчЛист · ${SITE_HOST} · демонстрационная заготовка`
            : allVerified
              ? `УчЛист · ${SITE_HOST} · проверено AI`
              : `УчЛист · ${SITE_HOST}`,
          size: 18,
          color: "999999",
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { before: 400 },
    })
  );

  // Страница ответов
  if (withAnswers) {
    children.push(
      new Paragraph({
        text: "",
        pageBreakBefore: true,
      }),
      new Paragraph({
        text: "Ответы и пояснения",
        heading: HeadingLevel.HEADING_1,
        spacing: { after: 60 },
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: "Только для учителя — не раздавать ученикам",
            italics: true,
            color: "C73213",
            size: 22,
          }),
        ],
        spacing: { after: 200 },
      })
    );

    const rows: TableRow[] = [
      new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: "№", bold: true })] })],
            width: cellWidthPct(0),
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: "Ответ", bold: true })] })],
            width: cellWidthPct(1),
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: "Пояснение", bold: true })] })],
            width: cellWidthPct(2),
          }),
        ],
      }),
      ...worksheet.tasks.map(
        (task) =>
          new TableRow({
            children: [
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: String(task.number), bold: true })] })],
                width: cellWidthPct(0),
              }),
              new TableCell({
                children: [
                  new Paragraph({ children: mathChildren(task.answer ?? "—", undefined) }),
                ],
                width: cellWidthPct(1),
              }),
              new TableCell({
                children: [
                  new Paragraph({
                    children: mathChildren(
                      withExplanations && task.explanation ? task.explanation : "—"
                    ),
                  }),
                ],
                width: cellWidthPct(2),
              }),
            ],
          })
      ),
    ];

    children.push(
      new Table({
        rows,
        width: { size: 100, type: WidthType.PERCENTAGE },
        // Фиксированный layout + явная сетка колонок: без этого Google Docs
        // пересчитывает ширины по содержимому и «размазывает» колонки.
        layout: TableLayoutType.FIXED,
        columnWidths: COLUMN_WIDTHS_DXA,
        borders: {
          top: { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" },
          bottom: { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" },
          left: { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" },
          right: { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" },
          insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "EEEEEE" },
          insideVertical: { style: BorderStyle.SINGLE, size: 1, color: "EEEEEE" },
        },
      })
    );
  }

  const doc = new Document({
    creator: "УчЛист",
    title: worksheet.title,
    description: `${subjectDisplayName(worksheet.subject)} · ${worksheet.grade} класс`,
    sections: [
      {
        properties: {
          page: {
            size: { orientation: PageOrientation.PORTRAIT },
            margin: { top: 1000, right: 1000, bottom: 1000, left: 1000 },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: `УчЛист · ${SITE_HOST}`,
                    size: 16,
                    color: "BBBBBB",
                  }),
                ],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: "Стр. ", size: 16, color: "BBBBBB" }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 16, color: "BBBBBB" }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  return await Packer.toBlob(doc);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
