#!/usr/bin/env node
/**
 * Слияние тем-дублей внутри одной пары «предмет + класс».
 *
 * ЗАЧЕМ. В федеральной рабочей программе одна и та же тема встречается
 * несколькими строками — например, «Морфемный разбор» описан и в разделе о
 * составе слова, и в разделе о практике. Сборщик тем каждую строку сделал
 * отдельной темой, а авторские задания дали обеим короткое одинаковое
 * название. В итоге на сайте появляются две страницы с одним заголовком, а
 * для поиска это шум и риск за дубли.
 *
 * ЧТО ДЕЛАЕМ. Темы с одинаковым названием внутри одного класса сливаемся в
 * одну: остаётся тема с самыми разными заданиями, задания всех дублей
 * добавляются к ней по смыслу (совпадения отбрасываются), лишние копии
 * удаляются. Название при этом не меняется — значит и адрес страницы, который
 * мог уже попасть в индекс, остаётся прежним.
 *
 * ЧЕГО НЕ ДЕЛАЕМ. Не сливаем темы с разными названиями даже если задания
 * похожи, и не трогаем пары между разными классами: «Орфоэпия» в 5 и в 8
 * классе — это разные страницы.
 *
 * ЗАПУСК.
 *   node scripts/fgos/merge-duplicate-topics.mjs
 *   node scripts/fgos/merge-duplicate-topics.mjs --apply
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DATA = path.join(ROOT, "src", "lib", "content", "grade-extensions", "fgos-program", "data.json");
const APPLY = process.argv.includes("--apply");

const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^а-яa-z0-9]+/g, " ")
    .trim();

const data = JSON.parse(readFileSync(DATA, "utf8"));

let mergedGroups = 0;
let removedTopics = 0;
let gainedExamples = 0;
const bySubject = {};

for (const [subject, grades] of Object.entries(data)) {
  for (const g of grades) {
    const groups = new Map();
    for (const t of g.topics) {
      const key = norm(t.title);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(t);
    }

    const keep = [];
    for (const [, group] of groups) {
      if (group.length === 1) {
        keep.push(group[0]);
        continue;
      }
      mergedGroups++;
      removedTopics += group.length - 1;
      bySubject[subject] = (bySubject[subject] ?? 0) + (group.length - 1);

      // Оставляем тему, у которой задания не повторяются между собой: у неё
      // выше шанс, что она не выродилась в копию соседа.
      const scored = group
        .map((t) => {
          const texts = t.examples.map((e) => norm(e.text));
          return { topic: t, distinct: new Set(texts).size };
        })
        .sort((a, b) => b.distinct - a.distinct || (a.topic.slug < b.topic.slug ? -1 : 1));
      const winner = scored[0].topic;

      const seen = new Set(winner.examples.map((e) => norm(e.text)));
      for (const other of scored.slice(1)) {
        for (const e of other.topic.examples) {
          const key = norm(e.text);
          if (seen.has(key)) continue;
          seen.add(key);
          winner.examples.push(e);
          gainedExamples++;
        }
        // Ссылка на раздел программы: если у дубля свой раздел, он не теряется.
        if (!winner.fgosRef && other.topic.fgosRef) winner.fgosRef = other.topic.fgosRef;
      }
      // Больше трёх заданий на тему не держим: страница должна оставаться
      // читаемой, а лишние дубли ничего не добавляют.
      winner.examples = winner.examples.slice(0, 3);
      keep.push(winner);
    }

    g.topics = keep;
  }
}

console.log("=".repeat(72));
console.log("СЛИЯНИЕ ТЕМ-ДУБЛЕЙ");
console.log("=".repeat(72));
console.log(`групп с дублями слито: ${mergedGroups}`);
console.log(`тем удалено:           ${removedTopics}`);
console.log(`заданий перенесено:    ${gainedExamples}`);
console.log(`по предметам:          ${JSON.stringify(bySubject)}`);
console.log();

if (!APPLY) {
  console.log("Это сухой прогон. Применить: добавь --apply");
  process.exit(0);
}

writeFileSync(DATA, JSON.stringify(data), "utf8");
console.log(`записано: ${path.relative(ROOT, DATA)}`);