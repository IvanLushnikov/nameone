#!/usr/bin/env node
/**
 * Проверка, что сверка коротких ответов подключена к потоку (лист 3.1.6, G3).
 *
 * Зачем скрипт, если есть тесты. Тесты доказывают ПОВЕДЕНИЕ: включил — модель
 * ответила, выключил — не ответила. Скрипт доказывает другое — что в коде не
 * вернулось то, о чём забыли. Ровно три вещи, каждая уже стоила работы:
 *
 *   1. ДВИЖОК ВЫЗЫВАЕТСЯ ИЗ ПОТОКА. `gradeShortAnswerWithLlm` написан, покрыт
 *      тестами и не зовётся ниоткуда — это была исходная дыра листа. Скрипт
 *      смотрит вызов из роута отправки, а не наличие функции.
 *   2. СЕРВИС РАЗБОРА ЧИСТЫЙ. `formGrading.ts` не должен импортировать
 *      провайдеров: такой импорт утягивал весь LLM-стек в тестовый пул, и
 *      workerd падал с «No such module» — 781 зелёный тест превращались в
 *      ноль. Ленивый `await import` не спасает, сборщик поднимает его обратно.
 *   3. РЕШЕНИЕ УЧИТЕЛЯ ЧИТАЕТСЯ ЯВНО, А ВЕРДИКТЫ РАЗНЫЕ. Галочка по умолчанию
 *      снята, и «верно от машины» не должно выглядеть как «верно от учителя».
 *
 * Проверки строковые, а не «по вайбстайлу»: именно тихое возвращение этих
 * трёх вещей и не замечают тесты.
 *
 *   node scripts/check-short-answer-wiring.mjs
 *
 * Зависимостей нет, Node ≥ 18, ничего не устанавливается и никуда не ходит.
 * Успех — ровно `SHORT_ANSWER_WIRED_OK` в stdout.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Прочитать файл. Отсутствие файла — провал, но с точным текстом. */
function read(...segments) {
  const path = join(ROOT, ...segments);
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    throw new Error(
      `не удалось прочитать ${segments.join("/")} — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

const publicForms = read("backend", "src", "routes", "publicForms.ts");
const grading = read("backend", "src", "services", "formGrading.ts");
const llmCheck = read("backend", "src", "llm", "shortAnswerCheck.ts");
const journal = read("backend", "src", "routes", "journal.ts");
const journalTypes = read("src", "lib", "journal", "types.ts");

const problems = [];

/** Проверка «есть ли текст в файле». Дословный поиск: регулярка тут — место тихой порчи. */
function mustContain(file, src, needle, why) {
  if (!src.includes(needle)) problems.push(why);
}

/** Проверка «не должно быть». Тот же принцип: точная строка, а не стиль. */
function mustNotContain(file, src, needle, why) {
  if (src.includes(needle)) problems.push(why);
}

// ── 1. Движок зовётся из потока отправки ──────────────────────────────────────

mustContain(
  "publicForms.ts",
  publicForms,
  'from "../llm/shortAnswerCheck"',
  "роут отправки не импортирует llm/shortAnswerCheck — движок сверки не подключён к потоку",
);
mustContain(
  "publicForms.ts",
  publicForms,
  "gradeShortAnswerWithLlm({",
  "роут отправки не зовёт gradeShortAnswerWithLlm — отправка идёт без сверки",
);
mustContain(
  "publicForms.ts",
  publicForms,
  "gradeSubmissionWithShortAnswerLlm({",
  "роут отправки не зовёт gradeSubmissionWithShortAnswerLlm",
);
mustContain(
  "publicForms.ts",
  publicForms,
  "readShortAnswerLlmSettings(form.payload_json)",
  "роут отправки не читает решение учителя — сверка либо всегда, либо никогда",
);

// ── 2. Сервис разбора остаётся чистым ─────────────────────────────────────────

mustNotContain(
  "formGrading.ts",
  grading,
  "../llm/router",
  "formGrading.ts снова тянет LLM-роутер: тестовый пул workerd на этом падает с «No such module»",
);
mustNotContain(
  "formGrading.ts",
  grading,
  "../llm/prompts",
  "formGrading.ts импортирует промпты LLM — сервис разбора перестал быть чистым",
);
mustNotContain(
  "formGrading.ts",
  grading,
  'await import("../llm',
  "в formGrading.ts появился ленивый импорт LLM: сборщик поднимает его обратно в статический граф, чистоты не даёт",
);
mustNotContain(
  "formGrading.ts",
  grading,
  "callWithFallback",
  "formGrading.ts вызывает провайдера напрямую — сеть должна жить в llm/shortAnswerCheck",
);
mustContain(
  "shortAnswerCheck.ts",
  llmCheck,
  'from "./router"',
  "модуль обращения к модели не импортирует роутер — сверка не может позвать провайдера",
);
mustContain(
  "shortAnswerCheck.ts",
  llmCheck,
  "callWithFallback(",
  "модуль обращения к модели не зовёт провайдера",
);

// ── 3. Решение учителя читается явно, по умолчанию ВЫКЛЮЧЕНО ──────────────────

mustContain(
  "formGrading.ts",
  grading,
  "export const SHORT_ANSWER_LLM_DISABLED: ShortAnswerLlmSettings = { enabled: false, enabledAt: null }",
  "нет явного выключенного состояния сверки — значение по умолчанию не зафиксировано в коде",
);
mustContain(
  "formGrading.ts",
  grading,
  "if (flag.enabled !== true) return SHORT_ANSWER_LLM_DISABLED",
  "настройка сверки читается не строго: любой мусор в снимке должен означать «не тратить деньги», а не «тратить»",
);
mustContain(
  "formGrading.ts",
  grading,
  "if (!args.settings.enabled) return graded;",
  "поток отправки не выходит раньше сверки при выключенной галочке",
);
mustContain(
  "journal.ts",
  journal,
  'journalRouter.post("/forms/:id/short-answer-llm"',
  "у учителя нет ручки включения/выключения сверки на конкретной форме",
);

// ── 4. Вердикт машины и вердикт учителя не сливаются ───────────────────────────

mustContain(
  "formGrading.ts",
  grading,
  'if (meta.decidedBy === "teacher")',
  "журнал не различает решение учителя и решение машины",
);
mustContain(
  "formGrading.ts",
  grading,
  '"model_correct"',
  "в журнале нет отдельного состояния для уверенного вердикта модели",
);
mustContain(
  "journal.ts",
  journal,
  "applyTeacherOverride(",
  "роут журнала не зовёт переопределение учителем — исправить машину нечем",
);
mustContain(
  "journal.ts",
  journal,
  "modelVerdict: grade.modelVerdict",
  "при правке учителя теряется снимок вердикта модели: через месяц не понять, что поправил человек",
);
for (const [state, why] of [
  ["model_correct", "нет подписи «верно — проверил ИИ»"],
  ["teacher_correct", "нет подписи «верно — поставил учитель»"],
  ["needs_review", "нет подписи «не уверен — проверьте сами»"],
]) {
  mustContain("journal/types.ts", journalTypes, `"${state}"`, why);
}
mustContainsDistinctLabels(journalTypes);

// ── Вывод ─────────────────────────────────────────────────────────────────────

/**
 * Подписи трёх состояний обязаны быть РАЗНЫМИ строками.
 *
 * Отдельная проверка, а не три `includes`: три одинаковые подписи удовлетворяют
 * трём проверкам выше, и журнал снова стал бы врать — всё «верно» выглядит
 * одинаково.
 */
function mustContainsDistinctLabels(src) {
  const labels = [
    'model_correct: "верно — проверил ИИ"',
    'teacher_correct: "верно — поставил учитель"',
    'needs_review: "не уверен — проверьте сами"',
  ].filter((l) => src.includes(l));
  const unique = new Set(labels);
  if (unique.size !== 3) {
    problems.push(
      "подписи «верно от ИИ», «верно от учителя» и «не уверен» должны быть разными строками — иначе журнал не отличает чьё решение",
    );
  }
}

try {
  if (problems.length) {
    for (const p of problems) console.error(`ПРОВАЛ: ${p}`);
    console.error("SHORT_ANSWER_WIRED_OK НЕ ПРОЙДЕНА");
    process.exit(1);
  }
  console.log("SHORT_ANSWER_WIRED_OK");
} catch (err) {
  // Молчать нельзя: «скрипт ничего не напечатал» и «скрипт упал» — разные диагнозы.
  console.error(
    `ПРОВАЛ: проверку не удалось выполнить — ${err instanceof Error ? err.message : String(err)}`,
  );
  console.error("SHORT_ANSWER_WIRED_OK НЕ ПРОЙДЕНА");
  process.exit(1);
}