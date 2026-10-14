#!/usr/bin/env node
/**
 * Проверка сверки короткого ответа моделью (лист 3.1.2, G2).
 *
 * Зачем отдельный скрипт, если есть тесты. Тесты доказывают ПОВЕДЕНИЕ: модель
 * сверила ответ, сомнение ушло учителю. Скрипт доказывает другое — что в коде
 * не вернулось то, о чём все забыли:
 *
 *   1. правило честности стоит В ПРОМПТЕ, а не только в вендоре у клиента;
 *   2. низкая уверенность обрабатывается ДО разбора вердикта модели;
 *   3. любая поломка ведёт к учителю, а не к «неправильно»;
 *   4. путь синхронный (его зовёт чужой роут) не сломан.
 *
 * Именно эти четыре вещи тихо разъезжаются при правках: удалили строку про
 * «uncertain» из промпта — модель начала ставить «неправильно» вместо отказа,
 * и ни один тест этого не заметил бы, потому что тест подставлял свой ответ.
 *
 *   node scripts/check-short-answer-grading.mjs
 *
 * Зависимостей нет, Node ≥ 18, ничего не устанавливается и никуда не ходит.
 * Успех — ровно `SHORT_ANSWER_GRADING_OK` в stdout. Любой другой исход —
 * ненулевой код возврата и разбор в stderr: молчать или «пройти на всякий
 * случай» нельзя, этот скрипт — дешёвый детектор тихой порчи.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "backend", "src");

/** Прочитать файл исходников. Отсутствие файла — тоже провал, но с точным текстом. */
function read(relativePath) {
  try {
    return readFileSync(join(SRC, relativePath), "utf8");
  } catch (err) {
    throw new Error(
      `не удалось прочитать backend/src/${relativePath} — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

const grading = read("services/formGrading.ts");
const prompt = read("llm/prompts/form-grading.ts");
const router = read("llm/router.ts");
const types = read("llm/types.ts");

const problems = [];

/**
 * Проверка «есть ли текст в файле». Без регулярки — дословный поиск: регулярка
 * здесь была бы местом, где тихо уезжает то, что мы хотели проверить.
 */
function mustContain(file, src, needle, why) {
  if (!src.includes(needle)) problems.push(why);
}

/**
 * Проверка «не должно быть». Тот же принцип: точная строка, а не вайбстайл.
 */
function mustNotContain(file, src, needle, why) {
  if (src.includes(needle)) problems.push(why);
}

// ── 1. Правило честности живёт в промпте ────────────────────────────────────

// Модель должна знать про третий вариант ответа. Если это убрать из промпта,
// она перестанет им пользоваться — вердикт «uncertain» просто перестанет
// приходить, и всё, что ниже, окажется мёртвым кодом.
mustContain(
  "prompts/form-grading.ts",
  prompt,
  '"uncertain"',
  'в промпте нет третьего ответа "uncertain" — модель не сможет честно отказаться',
);
mustContain(
  "prompts/form-grading.ts",
  prompt,
  'никогда не ставить вместо него "incorrect"',
  "в промпте нет прямого запрета подменять «не уверен» на «неправильно»",
);

// Уверенность обязана быть частью ответа модели — иначе её нечему проверять.
mustContain(
  "prompts/form-grading.ts",
  prompt,
  '"confidence"',
  "в промпте нет поля confidence — уверенность модели не попадёт в сервис",
);

// ── 2. Гейт уверенности стоит ДО разбора вердикта ───────────────────────────

// Порядок функций в normalizeShortAnswerVerdict. Гейт обязан стоять раньше
// разбора: иначе явный correct/incorrect от модели обходит проверку (ровно тот
// баг, который чинили в photoCheckGrading).
const fnStart = grading.indexOf("export function normalizeShortAnswerVerdict");
if (fnStart === -1) {
  problems.push("в formGrading.ts нет normalizeShortAnswerVerdict — вердикт ничем не фильтруется");
} else {
  const gateIndex = grading.indexOf("SHORT_ANSWER_CONFIDENCE_THRESHOLD", fnStart);
  const verdictIndex = grading.indexOf('v === "correct"', fnStart);
  if (gateIndex === -1) {
    problems.push("normalizeShortAnswerVerdict не смотрит на порог уверенности");
  } else if (verdictIndex === -1) {
    problems.push("normalizeShortAnswerVerdict вообще не разбирает correct/incorrect");
  } else if (gateIndex > verdictIndex) {
    problems.push(
      "гейт уверенности стоит ПОСЛЕ разбора вердикта модели — «не уверен» снова " +
        "превратится в «неправильно» (тот же баг, что был с фото)",
    );
  }
}

// Порог обязан быть константой, а не числом в коде.
mustContain(
  "services/formGrading.ts",
  grading,
  "export const SHORT_ANSWER_CONFIDENCE_THRESHOLD",
  "порог уверенности не вынесен в константу — его нельзя проверить и нельзя обсудить",
);

// ── 3. Поломка ведёт к учителю, а не к «неправильно» ────────────────────────

// Ни одна поломка не должна приводить к isCorrect === false на стороне модели.
// isCorrect: false появляется только из вердикта «incorrect».
const modelVerdictsFalse = grading.match(/isCorrect:\s*false/g) ?? [];
const falseOnModelPath = grading
  .split("export async function gradeShortAnswerWithLlm")[1] ?? "";
if (/isCorrect:\s*false/.test(falseOnModelPath)) {
  problems.push(
    "на пути вызова модели есть isCorrect: false — сбой модели может превратиться " +
      "в «неправильно» вместо ручной проверки",
  );
}

// Ручной откат обязателен: он и есть обещание учителю.
mustContain(
  "services/formGrading.ts",
  grading,
  'gradeManual("Модель ответила нечитаемо',
  "нет отката на нечитаемый ответ модели — вместо него учитель увидит «неправильно»",
);
mustContain(
  "services/formGrading.ts",
  grading,
  "catch",
  "вызов модели не защищён try/catch — падение провайдера уронит отправку формы",
);

// ── 4. Синхронный путь не сломан ────────────────────────────────────────────

// routes/publicForms.ts зовёт gradeSubmission СИНХРОННО. Если сделать его
// async ради модели, отправка формы перестанет работать — и это увидит только
// боевая отправка.
const gradeAnswerSig = /export function gradeAnswer\(task: WorksheetTask, value: StudentValue\): GradedAnswer/;
if (!gradeAnswerSig.test(grading)) {
  problems.push(
    "gradeAnswer перестал быть синхронным с прежней сигнатурой — routes/publicForms.ts " +
      "(чужой файл) перестанет собираться",
  );
}
mustNotContain(
  "services/formGrading.ts",
  grading,
  "этап 6",
  "в formGrading.ts осталась причина «LLM-сверка — этап 6» — этап уже сделан, " +
    "и учителю показывается обещание, которого нет",
);

// ── 5. Задача зарегистрирована в роутере и типах ────────────────────────────

mustContain("llm/types.ts", types, '"short-answer-check"', "в GenerationKind нет short-answer-check");
mustContain("llm/router.ts", router, 'case "short-answer-check"', "роутер не знает про short-answer-check");
mustContain(
  "llm/router.ts",
  router,
  'primary: { provider: "polza", model: "gpt-6-luna" }',
  "сверка короткого ответа ушла не на дешёвую Luna — сверка не должна стоить как генерация",
);

// ── 6. Оценка стоимости не выдумана ─────────────────────────────────────────
// Число без расчёта — это выдумка, которая потом утечёт в юнит-экономику.
// Здесь проверяем, что оценка токенов объявлена и что она правдоподобна.
const inMatch = grading.match(/LLM_ANSWER_GRADING_ESTIMATE_TOKENS_IN\s*=\s*(\d+)/);
const outMatch = grading.match(/LLM_ANSWER_GRADING_ESTIMATE_TOKENS_OUT\s*=\s*(\d+)/);
if (!inMatch || !outMatch) {
  problems.push("нет оценки токенов на одну сверку — стоимость посчитать нечем");
} else {
  const tokensIn = Number(inMatch[1]);
  const tokensOut = Number(outMatch[1]);
  // 900 out / 100 in — цена ошибки в оценке: такие числа дают оптимизм,
  // которого в реальном счёте не будет.
  if (tokensIn < 100 || tokensIn > 5000) {
    problems.push(`оценка входных токенов (${tokensIn}) выглядит выдуманной — сверка короткого ответа столько не ест`);
  }
  if (tokensOut < 10 || tokensOut > 500) {
    problems.push(`оценка выходных токенов (${tokensOut}) выглядит выдуманной`);
  }
}

// ── Вывод ───────────────────────────────────────────────────────────────────

try {
  if (problems.length) {
    for (const p of problems) console.error(`ПРОВАЛ: ${p}`);
    console.error("SHORT_ANSWER_GRADING_OK НЕ ПРОЙДЕНА");
    process.exit(1);
  }

  // Ровно одна строка: гейт читает вывод, лишних строк быть не должно.
  console.log("SHORT_ANSWER_GRADING_OK");
} catch (err) {
  // Молчать нельзя: «скрипт ничего не напечатал» и «скрипт упал» — разные
  // диагнозы, и оба означают, что сверка сейчас никем не проверена.
  console.error(
    `ПРОВАЛ: проверку не удалось выполнить — ${err instanceof Error ? err.message : String(err)}`,
  );
  console.error("SHORT_ANSWER_GRADING_OK НЕ ПРОЙДЕНА");
  process.exit(1);
}