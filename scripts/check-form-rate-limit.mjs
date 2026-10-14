#!/usr/bin/env node
/**
 * Проверка лимита отправок публичной формы (лист 1.1.1).
 *
 * Зачем отдельный скрипт, если есть тесты. Тест S9 в
 * backend/tests/unit/publicForms.test.ts доказывает ПОВЕДЕНИЕ: 60 отправок
 * проходят, 61-я отклоняется. Скрипт доказывает другое — что в коде стоит
 * именно ожидаемое число, до того как тест вообще запустили. Иначе поломка
 * «кто-то вернул 10» обнаруживалась бы на уроке, а не в CI.
 *
 *   node scripts/check-form-rate-limit.mjs
 *
 * Условия, оба обязательны:
 *   · formSubmitLimit  — лимит на пару «форма + IP» = 60/час;
 *   · formSubmitIpLimit — глобальный потолок по IP = 200/час.
 *
 * Потолок 200 проверяется не «на всякий случай»: его задача — ловить бота
 * после того, как лимит пары перестал быть первой преградой. Если он тоже
 * уехал вниз, урок снова сломается, только по другой причине.
 *
 * Успех — ровно `FORM_RATE_LIMIT_OK` в stdout. Любой другой исход — ненулевой
 * код возврата и разбор в stderr: молчать или «пройти на всякий случай» нельзя,
 * потому что этот скрипт — дешёвый детектор именно тихой порчи.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Источник истины — тот файл, где живут сами лимиты. */
const SOURCE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "backend",
  "src",
  "routes",
  "publicForms.ts",
);

const EXPECTED_PAIR_LIMIT = 60;
const EXPECTED_IP_LIMIT = 200;

/**
 * Вырезать тело настроек middleware: от первой `{` после вызова до закрывающей
 * `});`. Внутри объекта `});` не встречается, поэтому первое совпадение —
 * это честный конец блока, а не середина keyFn.
 */
function readMiddlewareOptions(src, constName) {
  const decl = src.indexOf(`const ${constName} = rateLimitMiddleware(`);
  if (decl === -1) {
    throw new Error(
      `в ${SOURCE} нет объявления «const ${constName} = rateLimitMiddleware(» — ` +
        `лимит переехал или переименован, проверка не знает, где его искать`,
    );
  }
  const bodyStart = src.indexOf("{", decl);
  const bodyEnd = src.indexOf("});", bodyStart);
  if (bodyStart === -1 || bodyEnd === -1) {
    throw new Error(`не удалось выделить блок настроек у ${constName} — файл правился вручную?`);
  }
  return src.slice(bodyStart, bodyEnd);
}

/** Достать целое поле из блока настроек. */
function readField(body, constName, field) {
  const found = body.match(new RegExp(`\\b${field}:\\s*(\\d+)`));
  if (!found) {
    throw new Error(`в настройках ${constName} нет числового поля «${field}»`);
  }
  return Number(found[1]);
}

/**
 * То же, но без падения: окно нужно только для диагностики и не входит в
 * условия прохода. Отсутствие окна не должно ронять проверку, которая
 * обязана смотреть ровно на два числа.
 */
function readFieldLoose(body, constName, field) {
  try {
    return readField(body, constName, field);
  } catch {
    return "?";
  }
}

try {
  const src = readFileSync(SOURCE, "utf8");

  const pairBody = readMiddlewareOptions(src, "formSubmitLimit");
  const ipBody = readMiddlewareOptions(src, "formSubmitIpLimit");

  const pairLimit = readField(pairBody, "formSubmitLimit", "limit");
  const ipLimit = readField(ipBody, "formSubmitIpLimit", "limit");
  const pairWindow = readFieldLoose(pairBody, "formSubmitLimit", "windowSec");
  const ipWindow = readFieldLoose(ipBody, "formSubmitIpLimit", "windowSec");

  const problems = [];
  if (pairLimit !== EXPECTED_PAIR_LIMIT) {
    problems.push(
      `лимит на пару «форма + IP» = ${pairLimit}, ожидалось ${EXPECTED_PAIR_LIMIT}` +
        ` — класс из 30 человек с одного школьного Wi-Fi снова упрётся в лимит`,
    );
  }
  if (ipLimit !== EXPECTED_IP_LIMIT) {
    problems.push(
      `потолок по IP = ${ipLimit}, ожидалось ${EXPECTED_IP_LIMIT} — ` +
        `либо бот проходит, либо урок ломается на параллелях`,
    );
  }
  if (problems.length) {
    // Окно — не условие прохода, а диагностика: за час эти числа и имеют смысл.
    problems.push(`(окна: пара ${pairWindow}с, IP ${ipWindow}с — /час только при 3600)`);
    for (const p of problems) console.error(`ПРОВАЛ: ${p}`);
    console.error("FORM_RATE_LIMIT_OK НЕ ПРОЙДЕНА");
    process.exit(1);
  }

  // Ровно одна строка: гейт читает вывод, лишних строк быть не должно.
  console.log("FORM_RATE_LIMIT_OK");
} catch (err) {
  // Молчать нельзя: «скрипт ничего не напечатал» и «скрипт упал» — разные
  // диагнозы, и оба означают, что лимит сейчас никем не проверен.
  console.error(`ПРОВАЛ: проверку лимита не удалось выполнить — ${err instanceof Error ? err.message : String(err)}`);
  console.error("FORM_RATE_LIMIT_OK НЕ ПРОЙДЕНА");
  process.exit(1);
}