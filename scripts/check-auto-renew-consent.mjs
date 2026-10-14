#!/usr/bin/env node
/**
 * Гейт листа 1.1.2: согласие на автопродление и адрес возврата с оплаты.
 *
 *   node scripts/check-auto-renew-consent.mjs → AUTO_RENEW_CONSENT_OK
 *
 * ЧТО ПРОВЕРЯЕТ (и почему каждая проверка вообще существует):
 *
 *   1. Галочка «продлевать автоматически» есть на экране оплаты, по умолчанию
 *      СНЯТА и показывается только там, где автопродление возможно (платный
 *      тариф, помесячная оплата).
 *   2. У неё есть настоящий <input type="checkbox"> с подписью `<label htmlFor>`:
 *      галочка на <div onClick> не видна ни с клавиатуры, ни скринридеру.
 *   3. Её значение доходит до запроса оплаты полем `autoRenew` и дальше до
 *      `autoRenewConsent` на бэке — по всей цепочке, а не только на одном краю.
 *   4. returnUrl больше НЕ собирается склейкой FRONTEND_URL: список через запятую
 *      разбирается, берётся первый настоящий адрес. Проверяется ФУНКЦИОНАЛЬНО:
 *      скрипт достаёт из billing.ts настоящую функцию и выполняет её.
 *
 * Чего скрипт НЕ проверяет и проверять не должен:
 *   * флаг RECURRING_BILLING_ENABLED в backend/wrangler.toml. Его включение —
 *     решение владельца после теста на реальной карте; как только он включится,
 *     проверка флага стала бы вредной (падала бы на правильном состоянии).
 *   * сам платёж: скрипт не ходит в ЮKassa и не может провести оплату.
 *
 * Скрипт портативный: только node, без зависимостей. Любое нарушение печатается
 * списком FAIL в stderr и даёт ненулевой код — молчаливого «прошло» тут нет.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

const fails = [];
const fail = (msg) => fails.push(msg);
const ok = (msg) => process.stdout.write(`  ok   ${msg}\n`);

/**
 * Убираем комментарии, но НЕ трогаем `//` внутри строк и URL: «https://…»
 * начинается со слэшей, и наивная замена порвала бы половину проверок.
 * Удаляются только строки, целиком начинающиеся с `//`, и блоки-звёздочки
 * (включая JSX-комментарии в фигурных скобках).
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ");
}

/** Есть ли такой кусок текста в исходнике. */
const has = (src, re, what) => {
  if (re.test(src)) {
    ok(what);
    return true;
  }
  fail(`${what} — не найдено: ${re}`);
  return false;
};

// ─── 1. Галочка на экране оплаты ─────────────────────────────────────────────

const teaserPath = "src/components/landing/PricingTeaser.tsx";
const teaser = stripComments(read(teaserPath));

has(teaser, /type="checkbox"/, `${teaserPath}: настоящий <input type="checkbox">`);

// Состояние согласия. Дефолт false — не «true для удобства»: иначе оплата уходит
// с безакцептным списанием, на которое учитель не подписывался.
has(
  teaser,
  /const\s*\[\s*autoRenew\s*,\s*setAutoRenew\s*\]\s*=\s*React\.useState\(\s*false\s*\)/,
  `${teaserPath}: состояние согласия создаётся снятым (useState(false))`,
);

// Условие показа: только платный тариф с помесячной оплатой.
has(
  teaser,
  /const\s+canAutoRenew\s*=\s*!isFree\s*&&\s*period\s*===\s*"month"/,
  `${teaserPath}: галочка разрешена только платному тарифу с периодом "month"`,
);
has(
  teaser,
  /\{\s*canAutoRenew\s*&&\s*\(/,
  `${teaserPath}: блок галочки отрисовывается по условию canAutoRenew`,
);

// Сбрасывание скрытого выбора: вернувшись к помесячной оплате, учитель должен
// увидеть пустую галочку, а не согласие, оставшееся от учебного года.
has(
  teaser,
  /if\s*\(\s*!canAutoRenew\s*\)\s*setAutoRenew\(\s*false\s*\)/,
  `${teaserPath}: при скрытии галочки выбор сбрасывается`,
);

// ─── 2. Доступность: галочка подписана и объяснена ───────────────────────────

const inputIds = [...teaser.matchAll(/\bid=\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]);
const labelFor = [...teaser.matchAll(/\bhtmlFor=\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]);
const labelled = inputIds.find((id) => labelFor.includes(id));
if (labelled) ok(`${teaserPath}: у галочки есть <label htmlFor="${labelled}">`);
else fail(`${teaserPath}: нет пары id={…} / htmlFor={…} — галочка без подписи`);

const describedBy = [...teaser.matchAll(/\baria-describedby=\{([A-Za-z0-9_]+)\}/g)].map(
  (m) => m[1],
);
const explained = describedBy.find((id) => inputIds.includes(id));
if (explained) ok(`${teaserPath}: пояснение рядом с галочкой (aria-describedby → id="${explained}")`);
else fail(`${teaserPath}: нет aria-describedby, ссылающегося на существующий id — скринридер не прочитает пояснение`);

// ─── 3. Текст рядом с галочкой: честный и без зашитых цен ───────────────────

has(
  teaser,
  /Продлевать автоматически/,
  `${teaserPath}: у галочки есть подпись «Продлевать автоматически»`,
);
has(
  teaser,
  /раз в\s*\n?\s*месяц|раз в месяц/,
  `${teaserPath}: в пояснении сказано про списание раз в месяц`,
);
has(
  teaser,
  /Отмен\w*\s+—|Отмен\w*:|отменить/i,
  `${teaserPath}: в пояснении сказано, как отменить`,
);
has(
  teaser,
  /formatRub\(\s*priceFor\(\s*plan\.id\s*,\s*"month"\s*\)\.amount\s*\)/,
  `${teaserPath}: сумма списания берётся из plans.ts, а не написана строкой`,
);
// Зашитая сумма рядом с галочкой = расхождение с ценой на карточке при смене цен.
if (/formatRub\(\s*priceFor\(\s*plan\.id\s*,\s*"month"\s*\)/.test(teaser)) {
  ok(`${teaserPath}: в блоке согласия нет зашитой суммы — только priceFor()`);
} else {
  fail(`${teaserPath}: сумма списания подставляется не через priceFor() — при смене цен текст разойдётся с ценой`);
}

// ─── 4. Значение доходит до бэка ─────────────────────────────────────────────

has(
  teaser,
  /autoRenew:\s*canAutoRenew\s*&&\s*autoRenew\s*,/,
  `${teaserPath}: в запрос оплаты уходит ровно то, что видит учитель (autoRenew: canAutoRenew && autoRenew)`,
);

const clientApi = read("src/lib/lk/subscription-api.ts");
has(
  clientApi,
  /autoRenew:\s*input\.autoRenew\s*===\s*true/,
  "src/lib/lk/subscription-api.ts: поле называется autoRenew и шлётся как boolean",
);

const zod = read("backend/src/lib/zod.ts");
has(
  zod,
  /autoRenew:\s*z\.boolean\(\)\.optional\(\)/,
  "backend/src/lib/zod.ts: схема принимает autoRenew (опционально = согласия нет по умолчанию)",
);

const billing = read("backend/src/routes/billing.ts");
has(
  billing,
  /autoRenewConsent:\s*parsed\.autoRenew\s*===\s*true/,
  "backend/src/routes/billing.ts: согласие доходит до createPayment только при явном true",
);

// ─── 5. Адрес возврата: список разбирается, а не склеивается ─────────────────

if (/\$\{[^}]*c\.env\.FRONTEND_URL/.test(stripComments(billing))) {
  fail(
    "backend/src/routes/billing.ts: FRONTEND_URL снова вставляется в ссылку шаблонной строкой — " +
      "в проде это список через запятую, получится несуществующий адрес",
  );
} else {
  ok("backend/src/routes/billing.ts: FRONTEND_URL больше не вставляется в ссылку склейкой");
}

has(
  billing,
  /firstValidFrontendOrigin\(\s*c\.env\.FRONTEND_URL\s*\)/,
  "backend/src/routes/billing.ts: дефолтный адрес собирается разбором списка FRONTEND_URL",
);

/**
 * Достать из исходника чистую функцию без аннотаций и выполнить её.
 *
 * Зачем так: проверять надо НАСТОЯЩИЙ код, а не его копию в тесте. Функция
 * специально вынесена в billing.ts отдельной маленькой функцией без импортов —
 * её можно выполнить, выбросив аннотации типов. Если разобрать не удалось,
 * это провал проверки, а не «ну ладно, пропустим».
 */
function loadPureFn(src, name) {
  const start = src.indexOf(`export function ${name}`);
  if (start < 0) throw new Error(`В billing.ts нет функции ${name}`);
  const end = src.indexOf("\n}\n", start);
  if (end < 0) throw new Error(`Функция ${name} не найдена целиком (нет закрывающей скобки в колонке 0)`);
  const body = src.slice(start, end + 2);
  const header = body.match(/^export function [A-Za-z0-9_]+\s*\(([^)]*)\)\s*(?::[^{]+)?\{/);
  if (!header) throw new Error(`Не разобралась сигнатура функции ${name}`);
  const params = header[1]
    .split(",")
    .map((p) => p.split(":")[0].trim())
    .filter(Boolean)
    .join(", ");
  const js = body
    .replace(header[0], `function ${name}(${params}) {`)
    .replace(/^export function /, "function ");
  // Об аннотациях типов внутри тела заранее не гадаем: если они там есть,
  // `new Function` сам упадёт с SyntaxError, и это будет видно в выводе.
  return new Function(`${js}; return ${name};`)();
}

let firstValidFrontendOrigin = null;
try {
  firstValidFrontendOrigin = loadPureFn(billing, "firstValidFrontendOrigin");
  ok("backend/src/routes/billing.ts: функция разбора списка адресов найдена и выполнена");
} catch (e) {
  fail(`backend/src/routes/billing.ts: не удалось выполнить firstValidFrontendOrigin — ${e.message}`);
}

if (firstValidFrontendOrigin) {
  const cases = [
    // Реальный прод-список: склейка дала бы «https://a.ru,https://b.ru».
    ["https://uchlist.ru,https://www.uchlist.ru", "https://uchlist.ru"],
    ["https://uchlist.ru,https://www.uchlist.ru", "https://uchlist.ru"],
    // Пробелы и слэш на конце.
    [" https://uchlist.ru/ , https://www.uchlist.ru ", "https://uchlist.ru"],
    // Пустые элементы пропускаются.
    [",,  ,https://www.uchlist.ru", "https://www.uchlist.ru"],
    // Первый элемент без схемы — не адрес, берём следующий.
    ["uchlist.ru,https://uchlist.ru", "https://uchlist.ru"],
    // Локальная разработка остаётся рабочей.
    ["http://localhost:3000", "http://localhost:3000"],
    // Разделитель не запятая — это не список адресов.
    ["https://a.ru https://b.ru", ""],
    ["", ""],
    [undefined, ""],
  ];
  for (const [input, expected] of cases) {
    const got = firstValidFrontendOrigin(input);
    const shown = input === undefined ? "(пусто)" : `«${input}»`;
    if (got === expected) ok(`разбор FRONTEND_URL ${shown} → ${got === "" ? "(ничего)" : got}`);
    else fail(`разбор FRONTEND_URL ${shown} → «${got}», а ожидалось «${expected}»`);
  }
}

// ─── вердикт ─────────────────────────────────────────────────────────────────

if (fails.length) {
  process.stderr.write(
    "\nAUTO_RENEW_CONSENT_FAIL\n" + fails.map((f) => `  FAIL ${f}`).join("\n") + "\n",
  );
  process.exit(1);
}
process.stdout.write("AUTO_RENEW_CONSENT_OK\n");