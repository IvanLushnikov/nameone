/**
 * LaTeX → OMML для выгрузки в DOCX.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ ПУТЬ. В браузере формулу рисует KaTeX (см. MathText), но в
 * DOCX KaTeX не работает: чанк JS не едет в документ. Для Word нужен OMML —
 * нативная разметка формул (Office Math Markup Language), которую понимают
 * Word, LibreOffice и Google Docs. За неё в библиотеке `docx` отвечают
 * Math-классы (`MathFraction`, `MathSuperScript`, `MathRadical`, …), проверенные
 * по node_modules/docx/dist/index.d.ts.
 *
 * ПОДМНОЖЕСТВО. Умеем `\frac`, `^{}`, `_{}`, `\sqrt`, `\times`, `\cdot`
 * (плюс тривиальные `\div`, `\pm`). Этого хватает для школьных дробей, степеней
 * и произведений. Всё остальное — НЕ поддерживаем (см. `latexToUnicode`).
 *
 * ГЛАВНОЕ ПРАВИЛО: при любой неудаче отдаём ЮНИКОД-ФОЛБЭК (⅛ ⅓ ⅔ ² ³ √ × ·).
 * Приоритет — читаемость документа, а не красота. Учительница должна получить
 * файл, который можно открыть и раздать, пусть и с «2/3» вместо вертикальной
 * дроби. Битый OMML ломает выгрузку целиком — этого допускать нельзя.
 */

import {
  MathFraction,
  MathRadical,
  MathRun,
  MathSubScript,
  MathSubSuperScript,
  MathSuperScript,
  type MathComponent,
} from "docx";

/* -------------------------------------------------------------------------- */
/*  Промежуточное дерево                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Узел + его скрипты. Скрипты храним отдельно от узла, чтобы `x_1^2` собрался
 * в один `MathSubSuperScript`, а не в две вложенные конструкции.
 */
type Slot = {
  node: OmmlNode;
  sub?: OmmlNode[];
  sup?: OmmlNode[];
};

type OmmlNode =
  | { kind: "run"; text: string }
  | { kind: "frac"; num: OmmlNode[]; den: OmmlNode[] }
  | { kind: "sqrt"; body: OmmlNode[] };

class LatexParseError extends Error {}

/* -------------------------------------------------------------------------- */
/*  Разбор                                                                      */
/* -------------------------------------------------------------------------- */

type Cursor = { src: string; pos: number };

/** Символы-разделители команд: `\frac`, `\sqrt`, … Две буквы не читаем. */
function readCommand(cur: Cursor): string {
  // cur.src[cur.pos] === "\\"
  cur.pos += 1;
  const ch = cur.src[cur.pos];
  if (ch === undefined) throw new LatexParseError("висячий обратный слэш");
  if (!/[A-Za-z]/.test(ch)) {
    // `\\`, `\{`, `\,` и прочие односимвольные escapes.
    cur.pos += 1;
    return ch;
  }
  let name = "";
  while (cur.pos < cur.src.length && /[A-Za-z]/.test(cur.src[cur.pos])) {
    name += cur.src[cur.pos];
    cur.pos += 1;
  }
  return name;
}

/** Аргумент команды: `{...}` с вложенностью либо один символ. */
function parseArgument(cur: Cursor): OmmlNode[] {
  while (cur.pos < cur.src.length && /[ \t]/.test(cur.src[cur.pos])) cur.pos += 1;
  if (cur.pos >= cur.src.length) throw new LatexParseError("команда без аргумента");

  if (cur.src[cur.pos] === "{") {
    cur.pos += 1;
    const slots = parseSequence(cur, true);
    if (cur.src[cur.pos] !== "}") throw new LatexParseError("незакрытая {");
    cur.pos += 1;
    return slots.map((slot) => slot.node);
  }

  if (cur.src[cur.pos] === "\\") {
    const cmd = readCommand(cur);
    const literal = commandToLiteral(cmd);
    if (literal === null) throw new LatexParseError(`неподдерживаемая команда \\${cmd}`);
    return [{ kind: "run", text: literal }];
  }

  const ch = cur.src[cur.pos];
  cur.pos += 1;
  return [{ kind: "run", text: ch === "~" ? " " : ch }];
}

/** Однобуквенные escapes и команды-пробелы. `null` = команда не поддержана. */
function commandToLiteral(cmd: string): string | null {
  if ("{}$%&_#".includes(cmd)) return cmd;
  if (cmd === "\\") return "\\";
  if (cmd === "," || cmd === ";" || cmd === ":" || cmd === "!") return " ";
  return null;
}

/** Текстовые команды: сюда попадает всё, что безопасно превратить в строку. */
const TEXT_COMMAND: Record<string, string> = {
  times: "×",
  cdot: "·",
  div: "÷",
  pm: "±",
};

function parseSequence(cur: Cursor, stopAtBrace: boolean): Slot[] {
  const slots: Slot[] = [];
  let text = "";

  const flush = (): void => {
    if (!text) return;
    slots.push({ node: { kind: "run", text } });
    text = "";
  };

  while (cur.pos < cur.src.length) {
    const ch = cur.src[cur.pos];

    if (ch === "}") {
      if (!stopAtBrace) throw new LatexParseError("лишняя }");
      break;
    }

    if (ch === "{") {
      // Голая группа: в OMML своего аналога нет, разворачиваем содержимое.
      cur.pos += 1;
      const inner = parseSequence(cur, true);
      if (cur.src[cur.pos] !== "}") throw new LatexParseError("незакрытая {");
      cur.pos += 1;
      flush();
      for (const slot of inner) slots.push(slot);
      continue;
    }

    if (ch === "\\") {
      const cmd = readCommand(cur);

      if (cmd === "frac") {
        flush();
        const num = parseArgument(cur);
        const den = parseArgument(cur);
        slots.push({ node: { kind: "frac", num, den } });
        continue;
      }
      if (cmd === "sqrt") {
        flush();
        const body = parseArgument(cur);
        slots.push({ node: { kind: "sqrt", body } });
        continue;
      }

      const literal = commandToLiteral(cmd);
      if (literal !== null) {
        text += literal;
        continue;
      }
      if (cmd in TEXT_COMMAND) {
        text += TEXT_COMMAND[cmd];
        continue;
      }
      throw new LatexParseError(`неподдерживаемая команда \\${cmd}`);
    }

    if (ch === "^" || ch === "_") {
      flush();
      cur.pos += 1;
      const script = parseArgument(cur);
      const base = slots.pop();
      if (!base) throw new LatexParseError("степень без основания");
      if (ch === "^") base.sup = script;
      else base.sub = script;
      slots.push(base);
      continue;
    }

    // Пробелы в LaTeX не несут смысла, но в документе читаются — схлопываем
    // серии пробелов в один, чтобы текст не рассыпался.
    if (/\s/.test(ch)) {
      while (cur.pos < cur.src.length && /\s/.test(cur.src[cur.pos])) cur.pos += 1;
      if (text && !text.endsWith(" ")) text += " ";
      continue;
    }

    text += ch;
    cur.pos += 1;
  }

  flush();
  return slots;
}

/* -------------------------------------------------------------------------- */
/*  Дерево → Math-классы docx                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Один узел → компоненты docx.
 *
 * Рекурсия идёт только ВНИЗ по дереву (аргумент дроби → свои узлы), поэтому
 * цикла renderNodes ↔ renderSlots здесь быть не может: renderSlots склеивает
 * узел со скриптами, а этот узел рендерит напрямую, минуя скрипты.
 */
function renderNode(node: OmmlNode): MathComponent[] {
  switch (node.kind) {
    case "run":
      return [new MathRun(node.text)];
    case "frac":
      return [
        new MathFraction({
          numerator: renderNodes(node.num),
          denominator: renderNodes(node.den),
        }),
      ];
    case "sqrt":
      return [new MathRadical({ children: renderNodes(node.body) })];
  }
}

function renderNodes(nodes: readonly OmmlNode[]): MathComponent[] {
  return nodes.flatMap(renderNode);
}

function renderSlots(slots: readonly Slot[]): MathComponent[] {
  return slots.flatMap((slot) => {
    const base = renderNode(slot.node);

    if (slot.sub && slot.sup) {
      return [
        new MathSubSuperScript({
          children: base,
          subScript: renderNodes(slot.sub),
          superScript: renderNodes(slot.sup),
        }),
      ];
    }
    if (slot.sub) {
      return [new MathSubScript({ children: base, subScript: renderNodes(slot.sub) })];
    }
    if (slot.sup) {
      return [new MathSuperScript({ children: base, superScript: renderNodes(slot.sup) })];
    }
    return base;
  });
}

/**
 * LaTeX → компоненты OMML.
 *
 * @returns компоненты для `new Math({ children })`, либо `null`, если формула
 *          не входит в поддерживаемое подмножество или битая. В обоих случаях
 *          вызывающий обязан откатиться на `latexToUnicode`.
 */
export function latexToOmml(latex: string): MathComponent[] | null {
  if (!latex.trim()) return null;
  try {
    const cur: Cursor = { src: latex, pos: 0 };
    const slots = parseSequence(cur, false);
    if (cur.pos !== cur.src.length) return null;
    const components = renderSlots(slots);
    return components.length > 0 ? components : null;
  } catch {
    // Любая ошибка разбора = уходим в юникод, документ должен остаться читаемым.
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/*  Юникод-фолбэк                                                               */
/* -------------------------------------------------------------------------- */

/** Обыкновенные дроби одним символом — то, что учительница хочет видеть. */
const VULGAR_FRACTION: Record<string, string> = {
  "1/2": "½",
  "1/3": "⅓",
  "2/3": "⅔",
  "1/4": "¼",
  "3/4": "¾",
  "1/5": "⅕",
  "2/5": "⅖",
  "3/5": "⅗",
  "4/5": "⅘",
  "1/6": "⅙",
  "5/6": "⅚",
  "1/7": "⅐",
  "1/8": "⅛",
  "3/8": "⅜",
  "5/8": "⅝",
  "7/8": "⅞",
  "1/9": "⅑",
  "1/10": "⅒",
};

const SUPERSCRIPT_CHAR: Record<string, string> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  "-": "⁻",
  "+": "⁺",
  ".": "·",
};

/** Команды, которых нет в OMML-подмножестве, но которые читаются в юникоде. */
const UNICODE_COMMAND: Record<string, string> = {
  times: "×",
  cdot: "·",
  div: "÷",
  pm: "±",
  le: "≤",
  leq: "≤",
  ge: "≥",
  geq: "≥",
  ne: "≠",
  neq: "≠",
  approx: "≈",
  infty: "∞",
  pi: "π",
  degree: "°",
};

/**
 * Переводит строку в верхний индекс. `null`, если есть символы, которые
 * юникодом не выразить — тогда покажем обычное `^(...)`.
 */
function toSuperscript(input: string): string | null {
  let out = "";
  for (const ch of input) {
    const mapped = SUPERSCRIPT_CHAR[ch];
    if (mapped === undefined) return null;
    out += mapped;
  }
  return out || null;
}

/**
 * Юникод-версия LaTeX. Используется, когда OMML не удался (неподдерживаемая
 * команда, битые скобки) и внутри самого конвертера для вложенных дробей.
 *
 * Порядок замен важен: сначала вложенные `\frac`, потом `\sqrt`, потом степени,
 * и только в конце — односимвольные команды и чистка скобок.
 */
export function latexToUnicode(latex: string): string {
  let out = latex;

  // Вложенные дроби: повторяем, пока inside не останется вложенных \frac.
  for (let i = 0; i < 4; i += 1) {
    const next = out.replace(
      /\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g,
      (_whole, num: string, den: string) => {
        const key = `${num}/${den}`;
        return VULGAR_FRACTION[key] ?? `${num}/${den}`;
      }
    );
    if (next === out) break;
    out = next;
  }

  out = out.replace(/\\sqrt\s*\{([^{}]*)\}/g, "√($1)");
  out = out.replace(/\^\s*\{([^{}]*)\}/g, (_w, script: string) => {
    const sup = toSuperscript(script);
    return sup === null ? `^(${script})` : sup;
  });
  out = out.replace(/_\s*\{([^{}]*)\}/g, "($1)");
  out = out.replace(/\\(frac|sqrt)\s*\{([^{}]*)\}/g, "$2");

  // Команды заменяем с границей слова: без неё `\le` съел бы префикс `\left`.
  for (const [cmd, symbol] of Object.entries(UNICODE_COMMAND)) {
    out = out.replace(new RegExp(`\\\\${cmd}(?![A-Za-z])`, "g"), symbol);
  }

  return out
    .replace(/\\left|\\right/g, "")
    .replace(/\\(text|mathrm|mathit|mathbf)\s*\{([^{}]*)\}/g, "$2")
    .replace(/\\/g, "")
    .replace(/[{}]/g, "")
    .replace(/~/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
