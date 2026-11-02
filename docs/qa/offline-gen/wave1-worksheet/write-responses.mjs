#!/usr/bin/env node
/** Writes raw-model response.json for wave1 worksheet cases. */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const dataDir = path.join(__dirname, "data");
const responses = {};

if (fs.existsSync(dataDir)) {
  for (const f of fs.readdirSync(dataDir).filter((x) => x.endsWith(".json"))) {
    const id = f.replace(/\.json$/, "");
    responses[id] = JSON.parse(fs.readFileSync(path.join(dataDir, f), "utf8"));
  }
}

Object.assign(responses, {
  W1: {
    title: "Рабочий лист: обыкновенные дроби (5 класс)",
    subject: "math",
    grade: 5,
    topic: "Обыкновенные дроби",
    difficulty: "medium",
    tasks: [
      {
        number: 1,
        text: "Сократите дробь: 6/9 = __",
        text_latex: "Сократите дробь: $\\frac{6}{9}$ = __",
        type: "computation",
        answer: "2/3",
        explanation: "НОД(6 и 9) = 3. Делим числитель и знаменатель на 3: 6/9 = 2/3.",
        points: 1,
        skill: "сокращение дроби",
      },
      {
        number: 2,
        text: "Запишите дробь: три пятых = __",
        type: "short-answer",
        answer: "3/5",
        explanation: "Число 3 — числитель, 5 — знаменатель.",
        points: 1,
        skill: "запись дроби",
      },
      {
        number: 3,
        text: "Где дробь больше?",
        type: "multiple-choice",
        options: ["2/3", "3/5", "1/2", "4/9"],
        answer: "2/3",
        explanation: "Приведём к общему знаменателю 15: 2/3 = 10/15, 3/5 = 9/15, 1/2 = 7,5/15, 4/9 ≈ 6,7/15. Наибольшая — 2/3.",
        points: 2,
        skill: "сравнение дробей",
      },
      {
        number: 4,
        text: "Сложите: 1/4 + 2/4 = __",
        text_latex: "Сложите: $\\frac{1}{4} + \\frac{2}{4}$ = __",
        type: "computation",
        answer: "3/4",
        explanation: "Знаменатели одинаковые, складываем числители: 1 + 2 = 3.",
        points: 1,
        skill: "сложение дробей",
      },
      {
        number: 5,
        text: "Образец: 4/8 = 1/2. Выполните по образцу: 10/15 = __",
        type: "pattern",
        sample: "Образец: 4/8 = 1/2 (делим на 4).",
        answer: "2/3",
        explanation: "10 и 15 делятся на 5: 10/15 = 2/3.",
        points: 2,
        skill: "сокращение по образцу",
      },
      {
        number: 6,
        text: "Вычислите: 5/6 − 1/6 = __",
        type: "computation",
        answer: "4/6",
        explanation: "5 − 1 = 4, знаменатель 6. Можно сократить до 2/3, но в ответе оставим 4/6.",
        points: 1,
        skill: "вычитание дробей",
      },
      {
        number: 7,
        text: "Из 7/8 м ленты отрезали 2/8 м. Сколько осталось? Ответ: __ м",
        type: "word-problem",
        answer: "5/8",
        explanation: "7/8 − 2/8 = 5/8 м.",
        points: 2,
        skill: "дроби в задаче",
      },
      {
        number: 8,
        text: "Ученик решил: 2/5 + 1/5 = 3/10. Найдите ошибку и запишите верный ответ.",
        type: "error-fixing",
        answer: "3/5",
        explanation: "При одинаковых знаменателях складывают числители, знаменатель не меняют.",
        points: 2,
        skill: "исправление ошибки",
      },
      {
        number: 9,
        text: "По таблице найдите, какая дробь равна 1/2.",
        type: "table-task",
        table: {
          headers: ["Дробь", "Значение"],
          rows: [
            ["3/6", "?" ],
            ["2/5", "?" ],
            ["4/8", "?" ],
          ],
        },
        answer: "3/6 и 4/8",
        explanation: "3/6 = 1/2 и 4/8 = 1/2 после сокращения.",
        points: 2,
        skill: "равные дроби",
      },
      {
        number: 10,
        text: "Выберите все дроби, которые меньше 1/2.",
        type: "multi-answer",
        options: ["1/3", "3/4", "2/7", "5/8"],
        answer: "1, 3",
        explanation: "1/3 и 2/7 меньше 1/2; 3/4 и 5/8 больше.",
        points: 3,
        skill: "сравнение с 1/2",
      },
      {
        number: 11,
        text: "Объясните своими словами, что показывает знаменатель дроби.",
        type: "open-ended",
        answer: null,
        criteria: [
          "Называет, что знаменатель показывает, на сколько равных частей разделили целое",
          "Приводит пример с дробью из темы",
        ],
        explanation: "Проверяйте, что ученик связывает знаменатель с делением на равные части.",
        points: 2,
        skill: "смысл знаменателя",
      },
      {
        number: 12,
        text: "Приведите к общему знаменателю и сложите: 1/3 + 1/6 = __",
        type: "computation",
        answer: "1/2",
        explanation: "1/3 = 2/6, 2/6 + 1/6 = 3/6 = 1/2.",
        points: 3,
        skill: "общий знаменатель",
      },
    ],
  },
});

for (const [id, body] of Object.entries(responses)) {
  const p = path.join(__dirname, id, "response.json");
  fs.writeFileSync(p, JSON.stringify(body, null, 2) + "\n", "utf8");
  console.log(id, body.tasks.length);
}
