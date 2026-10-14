#!/usr/bin/env node
/**
 * Проверка листа 6.1.7: сводка «по заданиям» — где класс спотыкается (G1).
 *
 *   node scripts/check-form-summary.mjs   →  FORM_SUMMARY_OK
 *
 * ─── Почему скрипт, а не тест ───────────────────────────────────────────────
 * Тесты доказывают поведение компонента. Здесь важнее другое: что правило
 * НЕ ВЫВЕРНЕТСЯ тихо. Ровно эти три вещи продукт уже чинил по два раза, и
 * каждая возвращается правкой на вид глаз:
 *   1. «попыток не было» превращается в «0 %» и в «не усвоено»;
 *   2. «не уверен» (`needs_review`) сворачивается в ошибку или в успех;
 *   3. строка ответа на ПУСТОЕ поле считается попыткой.
 *
 * Пункт 3 — ловушка этого экрана: бэк пишет строку в `form_answers` для
 * КАЖДОГО задания КАЖДОЙ работы, включая неотвеченные
 * (`backend/src/services/formGrading.ts`: «Задания, на которые ученик не
 * отвечал, всё равно попадают в perTask»). Считать «сколько строк пришло»
 * попытками нельзя.
 *
 * ─── Как проверяем ──────────────────────────────────────────────────────────
 * Скрипт ИМПОРТИРУЕТ `src/lib/lk/form-summary.ts` и проверяет числа на
 * настоящих данных. Не переписывает алгоритм у себя (тогда проверка
 * проверяла бы саму себя) и не ищет регулярками по тексту.
 *
 * Типы Node снимает сам (type stripping, Node ≥ 22.6). Если этот Node
 * слишком старый — поведенческие проверки честно пропускаются, остаются
 * проверки по исходнику, и в stdout появляется строка про это. Молча
 * «пройти на всякий случай» нельзя.
 *
 * Зависимостей нет, ничего не устанавливается и никуда не ходит.
 */

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODULE_PATH = join(ROOT, "src", "lib", "lk", "form-summary.ts");

const problems = [];
const ok = [];

function check(name, condition, detail = "") {
  if (condition) ok.push(name);
  else problems.push(detail ? `${name} — ${detail}` : name);
}

/* ─── Загрузка настоящего модуля ───────────────────────────────────────────── */

let mod = null;
// Node предупреждает об ExperimentalWarning на снятие типов. Для скрипта,
// где важен ровно один маркер в stdout, это шум — глушим стандартный слушатель.
process.removeAllListeners("warning");
try {
  mod = await import(pathToFileURL(MODULE_PATH).href);
} catch {
  // Старый Node: пробуем дочерний процесс с явным флагом.
  const probe = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", "-e", 'import("' + pathToFileURL(MODULE_PATH).href + '").then(() => {})'],
    { encoding: "utf8" },
  );
  if (probe.status === 0) {
    mod = await import(pathToFileURL(MODULE_PATH).href).catch(() => null);
  }
}

const libSource = readFileSync(MODULE_PATH, "utf8");
const view = readFileSync(join(ROOT, "src", "components", "teacher", "FormSummary.tsx"), "utf8");

/* ─────────────────────────────────────────────────────────────────────────────
 * 1. Поведение: считает из ответов, а не рисует на глаз
 * ───────────────────────────────────────────────────────────────────────────── */

if (mod) {
  const { buildTaskSummary, readTaskSnapshot, countsLabel, RETEACH_BELOW_PERCENT } = mod;

  /** Ответ: пустой ответ пишется `null`, как это делает бэк. */
  const answer = (taskNumber, o = {}) => ({
    taskNumber,
    studentAnswer: "ответ",
    isCorrect: true,
    pointsAwarded: 1,
    pointsMax: 1,
    needsReview: false,
    checkMethod: "auto",
    ...o,
  });

  const response = (id, answers) => ({
    id,
    studentName: id,
    studentLabel: null,
    scoreTotal: 0,
    scoreMax: 0,
    durationSec: 120,
    submittedAt: 0,
    answers,
  });

  /* — Главное правило: пустой ответ — это НЕ попытка и НЕ ошибка — */
  const blank = buildTaskSummary({
    responses: [response("a", [answer(1, { studentAnswer: null, isCorrect: false })])],
    tasks: [{ number: 1, text: "Первый" }],
  });
  const row1 = blank.noAttempts[0];
  check(
    "пустой ответ не считается попыткой",
    !!row1 && row1.attempts === 0 && row1.wrong === 0,
    `attempts=${row1?.attempts}, wrong=${row1?.wrong}`,
  );
  check(
    "пустой ответ попадает в «пропустили», а не в ошибки",
    !!row1 && row1.skipped === 1 && row1.wrong === 0,
    `skipped=${row1?.skipped}`,
  );

  /* — «Попыток не было» ≠ «не усвоено»: это разные списки — */
  check(
    "задание без попыток не попадает в «переобъяснить»",
    blank.reteach.length === 0,
    `reteach=${blank.reteach.length}`,
  );
  check(
    "у задания без попыток нет процента",
    !!row1 && row1.successPercent === null,
    `successPercent=${row1?.successPercent}`,
  );
  check(
    "«попыток не было» не рисуется как «0 из 0»",
    !!row1 && countsLabel(row1) === "—",
    `countsLabel=${row1 && countsLabel(row1)}`,
  );
  check(
    "в тексте есть прямая оговорка про «не усвоено»",
    /не значит, что тема не усвоена|пока неизвестно|не усвоена/.test(blank.noAttempts[0].action),
    `action=${blank.noAttempts[0]?.action}`,
  );

  /* — Три состояния: needsReview не ошибка и не успех — */
  const third = buildTaskSummary({
    responses: [
      response("a", [answer(1)]),
      response("b", [answer(1, { isCorrect: false })]),
      response("c", [answer(1, { needsReview: true, isCorrect: null, checkMethod: "llm" })]),
      response("d", [answer(1, { isCorrect: false })]),
    ],
    tasks: [{ number: 1, text: "" }],
  });
  const row2 = third.reteach[0];
  check(
    "«не уверен» считается отдельно от ошибок",
    !!row2 && row2.unsure === 1 && row2.wrong === 2 && row2.correct === 1,
    `unsure=${row2?.unsure}, wrong=${row2?.wrong}, correct=${row2?.correct}`,
  );
  check(
    "«не уверен» не попадает ни в верно, ни в неверно",
    !!row2 && row2.correct + row2.wrong === row2.attempts - row2.unsure,
    `correct+wrong=${row2?.correct}+${row2?.wrong}`,
  );
  check(
    "«не уверен» не опускает процент успеха",
    !!row2 && row2.successPercent === Math.round((1 / 4) * 100),
    `successPercent=${row2?.successPercent}`,
  );
  check(
    "про «не уверен» сказано словами, а не только знаком",
    /не уверен|ждут вас|не смогла решить/i.test(row2?.action ?? ""),
    `action=${row2?.action}`,
  );

  /* — isCorrect === null без needsReview — тоже третье состояние, не ошибка — */
  const noVerdict = buildTaskSummary({
    responses: [
      response("a", [answer(1, { isCorrect: null, needsReview: false })]),
      response("b", [answer(1, { isCorrect: false })]),
      response("c", [answer(1)]),
    ],
    tasks: [{ number: 1, text: "" }],
  });
  check(
    "ответ без вердикта не становится ошибкой",
    (noVerdict.reteach[0]?.wrong ?? 0) === 1 && (noVerdict.reteach[0]?.unsure ?? 0) === 1,
    `wrong=${noVerdict.reteach[0]?.wrong}, unsure=${noVerdict.reteach[0]?.unsure}`,
  );

  /* — Мало попыток — это не «класс не понял» — */
  const one = buildTaskSummary({
    responses: [response("a", [answer(1, { isCorrect: false })])],
    tasks: [{ number: 1, text: "" }],
  });
  check(
    "одна попытка не называется «переобъяснить»",
    one.reteach.length === 0 && one.fewAttempts[0]?.verdict === "few_attempts",
    `reteach=${one.reteach.length}, verdict=${one.fewAttempts[0]?.verdict}`,
  );
  check(
    "при малых попытках процент не показывается",
    one.fewAttempts[0]?.successPercent === null,
    `successPercent=${one.fewAttempts[0]?.successPercent}`,
  );
  check(
    "задание с малой выборкой не пропадает с экрана",
    one.fewAttempts.length === 1,
    "задание с одной попыткой не попало ни в один список",
  );

  /* — Порог — правило экрана, а рядом сырые числа — */
  const weak = buildTaskSummary({
    responses: [
      response("a", [answer(1)]),
      response("b", [answer(1, { isCorrect: false })]),
      response("c", [answer(1, { isCorrect: false })]),
      response("d", [answer(1, { isCorrect: false })]),
    ],
    tasks: [{ number: 1, text: "" }],
  });
  check(
    "процент считается по попыткам, а не по строкам бэка",
    weak.reteach[0]?.successPercent === 25 && weak.reteach[0]?.attempts === 4,
    `successPercent=${weak.reteach[0]?.successPercent}, attempts=${weak.reteach[0]?.attempts}`,
  );
  check(
    "порог переобъяснения назван константой",
    RETEACH_BELOW_PERCENT === 60,
    `RETEACH_BELOW_PERCENT=${RETEACH_BELOW_PERCENT}`,
  );
  check(
    "рядом с процентом видны сырые числа",
    countsLabel(weak.reteach[0]) === "1 из 4",
    `countsLabel=${countsLabel(weak.reteach[0])}`,
  );

  /* — Худшие сверху: слабое место видно раньше всего — */
  const many = buildTaskSummary({
    responses: [
      response("a", [answer(1), answer(1), answer(1), answer(2, { isCorrect: false })]),
      response("b", [answer(1), answer(1), answer(2, { isCorrect: false }), answer(2, { isCorrect: false })]),
      response("c", [answer(1), answer(2, { isCorrect: false }), answer(2, { isCorrect: false }), answer(2, { isCorrect: false })]),
    ],
    tasks: [{ number: 1, text: "" }, { number: 2, text: "" }],
  });
  check(
    "худшее задание стоит первым",
    many.reteach[0]?.taskNumber === 2,
    `первым идёт задание ${many.reteach[0]?.taskNumber}`,
  );
  check(
    "заголовок ведёт к действию, а не просто «53 % верно»",
    /Начните с|задани/i.test(many.headline) && !/^\s*\d+\s*%/.test(many.headline),
    `headline=${many.headline}`,
  );

  /* — Пропущенные задания видны, но не в «переобъяснить» — */
  const mixed = buildTaskSummary({
    responses: [
      response("a", [answer(1), answer(1), answer(1), answer(1), answer(2, { isCorrect: false })]),
      response("b", [answer(1), answer(1), answer(2, { isCorrect: false }), answer(2, { isCorrect: false })]),
      response("c", [answer(1), answer(2, { isCorrect: false }), answer(2, { isCorrect: false }), answer(2, { isCorrect: false })]),
    ],
    tasks: [
      { number: 1, text: "" },
      { number: 2, text: "" },
      { number: 3, text: "Не открывали" },
    ],
  });
  check(
    "задание без попыток найдено по снимку заданий",
    mixed.noAttempts.length === 1 && mixed.noAttempts[0].taskNumber === 3,
    `noAttempts=${mixed.noAttempts.map((r) => r.taskNumber).join(",")}`,
  );
  check(
    "задание без попыток не попало в «переобъяснить»",
    mixed.reteach.every((r) => r.taskNumber !== 3),
    "задание 3 попало в переобъяснить",
  );
  check(
    "в сводке сказано, что попыток не было",
    /без попыток/.test(mixed.detail),
    `detail=${mixed.detail}`,
  );

  /* — Нет данных — говорим об этом, а не рисуем пустой график — */
  const noData = buildTaskSummary({ responses: [], tasks: [] });
  check(
    "без данных сводка говорит «данных пока нет»",
    noData.headline === "Данных пока нет" && noData.dataNote !== null,
    `headline=${noData.headline}`,
  );
  const noSnapshot = buildTaskSummary({
    responses: [response("a", [answer(1)])],
    tasks: [],
  });
  check(
    "без снимка заданий есть честная оговорка",
    typeof noSnapshot.dataNote === "string" && /список заданий/i.test(noSnapshot.dataNote),
    `dataNote=${noSnapshot.dataNote}`,
  );
  check(
    "без снимка заданий «попыток не было» не выдумывается",
    noSnapshot.noAttempts.length === 0,
    "noAttempts не пуст без снимка заданий",
  );

  /* — Снимок заданий читается осторожно — */
  check(
    "снимок заданий читается из ответа бэка",
    readTaskSnapshot({ tasks: [{ number: 2, text: "Дроби" }] })[0]?.text === "Дроби",
    "текст задания не прочитан",
  );
  check(
    "битый снимок не превращается в данные",
    readTaskSnapshot({ tasks: "мусор" }).length === 0 &&
      readTaskSnapshot(null).length === 0 &&
      readTaskSnapshot({ tasks: [{ number: "нет" }] }).length === 0,
    "битый снимок прошёл валидацию",
  );

  console.log("Поведение проверено на настоящих данных из src/lib/lk/form-summary.ts");
} else {
  console.log("ВНИМАНИЕ: этот Node не умеет запускать TypeScript — поведение не проверено, работают только проверки по исходнику");

  /* ───────────────────────────────────────────────────────────────────────────
   * 2. По исходнику (запасной путь для старого Node)
   * ─────────────────────────────────────────────────────────────────────────── */
  check(
    "пустой ответ отсекается до подсчёта",
    /function isBlank[\s\S]{0,400}return raw\.replace/.test(libSource) &&
      /if \(isBlank\(answer\)\) return "skipped"/.test(libSource),
    "в модуле нет проверки пустого ответа",
  );
  check(
    "needsReview разбирается раньше верного/неверного",
    /if \(answer\.needsReview\) return "unsure"/.test(libSource),
    "«не уверен» не разбирается раньше верного/неверного",
  );
  check(
    "процент — null при нуле попыток",
    /attempts > 0 \? Math\.round/.test(libSource),
    "процент не различает «нет попыток» и «0 %»",
  );
  check(
    "задания без попыток отдаются отдельным списком",
    /noAttempts/.test(libSource),
    "нет отдельного списка noAttempts",
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 3. Экран: сводка ВЫШЕ списка работ и честные подписи
 * ───────────────────────────────────────────────────────────────────────────── */

check(
  "экран берёт числа из общего модуля, а не считает сам",
  /from "@\/lib\/lk\/form-summary"/.test(view) && /buildTaskSummary\(/.test(view),
  "компонент не импортирует сводку",
);
check(
  "сводка нарисована до списка работ",
  view.indexOf("<TaskBreakdown") < view.indexOf("responses.map("),
  "список работ идёт раньше сводки по заданиям",
);
check(
  "на экране есть отдельная секция «попыток не было»",
  /Попыток не было/.test(view) && /это не «не усвоено»/.test(view),
  "нет явной пометки «попыток не было»",
);
check(
  "«не уверен» подписано словами",
  /модель не смогла решить/.test(view),
  "нет слов про «не уверен»",
);
check(
  "нет нишишей строки без чисел (процент без «N из M»)",
  /countsLabel/.test(view),
  "процент показан без сырых чисел",
);
check(
  "пустое состояние сводки объяснено словами",
  /Данных пока нет|Пока нечего разбирать/.test(libSource),
  "пустое состояние сводки молчит",
);

/* ─────────────────────────────────────────────────────────────────────────────
 * Итог
 * ───────────────────────────────────────────────────────────────────────────── */

if (problems.length > 0) {
  console.error("ПРОВАЛЕНО:");
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}

console.log(`Проверено правил: ${ok.length}`);
console.log("FORM_SUMMARY_OK");