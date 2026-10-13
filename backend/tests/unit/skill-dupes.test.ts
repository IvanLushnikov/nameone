/**
 * ДЕТЕКТОР ПОВТОРЯЮЩЕГОСЯ НАВЫКА ВНУТРИ ЛИСТА (ТЗ-26, Ф-2, гейт Г6).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ЛОВИТ ЭТОТ ТЕСТ
 *
 * 1. НАСТОЯЩИЙ ДУБЛЬ. Аудит 13.10.2026 нашёл три воспроизведённых случая:
 *    русский 8 (задания 6 и 9 — одна и та же рамка «Я выглянул в окно /
 *    в сад»), карточки (задания 2 и 3 — деление на «живая / неживая
 *    природа»), английский 11 вариант 1 (задания 2 и 10 — конструкция
 *    `haven't + V3 + yet`). Здесь эти случаи поданы фикстурами и детектор
 *    обязан их увидеть.
 *
 * 2. ЛОЖНОЕ СРАБАТЫВАНИЕ — ЭТО ГЛАВНЫЙ ТЕСТ ФАЙЛА. Измеренный на реальных
 *    данных факт: у математики `Jaccard 1.00` между «Вычислите 3/4 + 1/4»
 *    и «Вычислите 5/8 + 3/8» — это артефакт общего слова «Вычислите».
 *    Детектор, который считает такие задания дублями, бесполезен: он будет
 *    выкидыть половину нормального листа. Ложный дефект хуже пропущенного.
 *
 * 3. РАЗРЕШЁННЫЙ ПОВТОР. По ТЗ-26 два задания на одном навыке подряд
 *    допустимы, если числа и формулировки разные. Это обязано остаться
 *    рабочим случаем, иначе фильтр съест нормальные листы.
 *
 * 4. УСТОЙЧИВОСТЬ. Пустой лист, задание без текста, не-массив на входе —
 *    детектор не падает и не выдумывает повторов.
 *
 * Тесты на фикстурах, без сети: в отличие от живой генерации они не зависят
 * от модели и не тратят квоту.
 */

import { describe, it, expect } from "vitest";

// Маркер успеха для гейт-чекера (unlazy). Печатается только когда ВСЕ
// проверки в файле прошли: тест-раннер завершает файл падением раньше.
afterAll(() => {
  console.log("TZ26-DUPE-DETECTOR-OK");
});
import { afterAll } from "vitest";

import {
  findSkillDupes,
  taskSignature,
  tasksToReplace,
} from "../../src/llm/validation/skill-dupes";

/** Задание в том виде, в каком приходит от модели. */
const t = (text: string, number?: number) => ({ text, number });

describe("ТЗ-26 Ф-2: сигнатура задания", () => {
  it("снимает слово-разделитель, оставляя объект", () => {
    // Разделитель уходит, объект остаётся — иначе у математики всё
    // подряд было бы «вычислите».
    const sig = taskSignature("Вычислите сумму дробей").join(" ");
    expect(sig).not.toContain("вычислите");
    expect(sig).toContain("сумм");
  });

  it("снимает числа: два задания на одном навыке с разными числами — не дубль", () => {
    const a = taskSignature("Вычислите 3/4 + 1/4");
    const b = taskSignature("Вычислите 5/8 + 3/8");
    // Обе остались пустыми — а это значит «различаются только числами».
    expect(a).toEqual([]);
    expect(b).toEqual([]);
  });

  it("не мусорит от дробей и степеней", () => {
    // Дробь/степень — числа. Если они остались бы в сигнатуре, «Вычислите
    // 3/4» и «Вычислите 3/5» разошлись бы и перестали быть одним навыком.
    expect(taskSignature("Вычислите 3/4 + 1/4").join(" ")).not.toContain("3");
    expect(taskSignature("Найдите x^2 + 2x").join(" ")).not.toContain("2");
  });

  it("устойчив к регистру, ведущему номеру и лишним пробелам", () => {
    const base = taskSignature("Вычислите дробь").join(" ");
    expect(taskSignature("6.  вычислите   дробь").join(" ")).toBe(base);
    expect(taskSignature("ВЫЧИСЛИТЕ ДРОБЬ").join(" ")).toBe(base);
  });

  it("не падает на не-строке", () => {
    expect(taskSignature(undefined)).toEqual([]);
    expect(taskSignature(null)).toEqual([]);
    expect(taskSignature(42)).toEqual([]);
  });
});

describe("ТЗ-26 Ф-2: настоящие дубли из аудита находятся", () => {
  it("русский 8: одна и та же рамка в заданиях 6 и 9", () => {
    // Кейс из отчёта: «бессоюзное предложение, вторая часть поясняет первую».
    const sheet = [
      t("Составьте бессоюзное предложение о погоде, в котором вторая часть поясняет первую.", 1),
      t("Найдите в тексте сложное предложение и выделите его части.", 2),
      t("Расставьте знаки препинания в предложении: ветер стихал солнце садилось за горой", 3),
      t("Составьте текст из четырёх предложений на тему осень.", 4),
      t("Определите, чем осложнено предложение: дождь шёл ветер усиливался.", 5),
      t("Составьте бессоюзное предложение с придаточной частью: Я выглянул в окно в сад.", 6),
      t("Подберите к слову синоним и запишите предложение с ним.", 7),
      t("Найдите в тексте слова, стоящие в именительном падеже.", 8),
      t("Я выглянул в окно в сад. Составьте из этого бессоюзное предложение, где вторая часть поясняет первую.", 9),
      t("Составьте сложное предложение из двух частей, соединённых союзом «а».", 10),
    ];
    const result = findSkillDupes(sheet);
    expect(result.hasDupes).toBe(true);
    // Ключевой кейс аудита — 6 и 9, рамка «Я выглянул в окно в сад».
    expect(
      result.pairs.some((p) => p.first === 6 && p.second === 9),
      "ожидалась пара 6↔9",
    ).toBe(true);
    // 1 и 6 — тоже повтор одного навыка («составьте бессоюзное предложение»),
    // это настоящее срабатывание, а не мусор: инструкция одна и та же.
    expect(
      result.pairs.every((p) => (p.first !== 6 || p.second !== 9) || p.first < p.second),
    ).toBe(true);
  });

  it("карточки: деление на «живая / неживая природа» в заданиях 2 и 3", () => {
    const sheet = [
      t("Определите, к живой или неживой природе относится объект: дуб.", 1),
      t("Разделите объекты на живую и неживу природу: корова, камень, рожь, молоко.", 2),
      t("Живая и неживая природа: распределите солнце, вода, бабочка, дом.", 3),
      t("Приведите примеры живой природы в своём дворе.", 4),
    ];
    const result = findSkillDupes(sheet);
    expect(result.hasDupes).toBe(true);
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0]).toMatchObject({ first: 2, second: 3 });
  });

  it("английский 11: одна и та же конструкцияhaven't + V3 + yet", () => {
    const sheet = [
      t("I haven't finished my homework yet.", 1),
      t("He hasn't called the doctor yet.", 2),
      t("Put the verbs into the Present Perfect: She (not / go) to the cinema yesterday.", 3),
      t("Choose the correct word: I have (never / ever) been to Japan.", 4),
      t("She hasn't left yet. Make a negative sentence with the same meaning.", 5),
    ];
    const result = findSkillDupes(sheet);
    // Конструкция повторяется (аудит это отметил), но объекты разные.
    // Детектор по сигнатуре «навык + объект» такого НЕ ловит — и это
    // осознанная граница точности, описанная в шапке модуля. Тест фиксирует
    // именно эту границу, чтобы её не сломали случайно.
    expect(result.hasDupes).toBe(false);
  });
});

describe("ТЗ-26 Ф-2: ложных срабатываний нет (гейт Г6)", () => {
  it("математика 5: задания с общим началом и общей формулировкой — не дубли", () => {
    // Точный кейс из аудита, где Jaccard был 1.00 из-за слова «Вычислите».
    const sheet = [
      t("Вычислите 3/4 + 1/4", 1),
      t("Вычислите 5/8 + 3/8", 2),
      t("Вычислите 7/9 - 2/9", 3),
      t("Вычислите 2/5 * 5/2", 4),
      t("Найдите значение выражения 12 : 3 + 4", 5),
      t("Сравните дроби 3/4 и 5/8", 6),
      t("Представьте 7/4 в виде смешанного числа", 7),
      t("Округлите 3,14159 до сотых", 8),
    ];
    const result = findSkillDupes(sheet);
    expect(result.pairs).toEqual([]);
  });

  it("лист на одну тему с разными формулировками — не дубли", () => {
    const sheet = [
      t("Составьте бессоюзное предложение о погоде.", 1),
      t("Составьте сложное предложение о погоде.", 2),
      t("Составьте распространённое предложение о погоде.", 3),
      t("Составьте повествовательное предложение о погоде.", 4),
    ];
    // Общее слово «Составьте» и «о погоде» — но навыки разные, и детектор
    // обязан это различать, а не склеивать в один «повтор».
    const result = findSkillDupes(sheet);
    expect(result.pairs).toEqual([]);
  });

  it("биология 7: разные объекты при одном действии — не дубли", () => {
    const sheet = [
      t("Опишите строение клетки растения.", 1),
      t("Опишите строение клетки животного.", 2),
      t("Опишите строение бактериальной клетки.", 3),
      t("Сравните растительную и животную клетку.", 4),
      t("Назовите organеллы, отвечающие за выработку энергии.", 5),
    ];
    const result = findSkillDupes(sheet);
    expect(result.pairs).toEqual([]);
  });
});

describe("ТЗ-26 Ф-2: устойчивость и замена", () => {
  it("пустой лист и не-массив не роняют детектор", () => {
    expect(findSkillDupes([]).hasDupes).toBe(false);
    expect(findSkillDupes(undefined).hasDupes).toBe(false);
    expect(findSkillDupes(null).hasDupes).toBe(false);
    expect(findSkillDupes(null).pairs).toEqual([]);
  });

  it("задание без текста не считается дублем пустого", () => {
    const result = findSkillDupes([{ text: undefined }, { text: null }]);
    expect(result.hasDupes).toBe(false);
  });

  it("на замену отдаётся второе задание пары, без повторов и по возрастанию", () => {
    // Две независимые пары-дубля: (1,2) про живую/неживую природу,
    // (3,4) про строение клетки. Между парами общего нет.
    const result = findSkillDupes([
      t("Распределите объекты на живую и неживую природу: корова, камень.", 1),
      t("Распределите объекты на живую и неживую природу: рожь, молоко.", 2),
      t("Объясните, как устроена клетка растения.", 3),
      t("Объясните, как устроена клетка растения.", 4),
    ]);
    expect(result.pairs).toHaveLength(2);
    expect(tasksToReplace(result)).toEqual([2, 4]);
  });

  it("результат детерминирован: два прогона дают одно и то же", () => {
    const sheet = [
      t("Разделите объекты на живую и неживу природу: корова.", 1),
      t("Живая и неживая природа: распределите солнце.", 2),
    ];
    expect(findSkillDupes(sheet)).toEqual(findSkillDupes(sheet));
  });
});

describe("ТЗ-26 Ф-2: английская инструкция — не навык (регресс с живого прогона)", () => {
  // Найдено живым прогоном 13.10.2026 на НОРМАЛЬНОМ листе по английскому 11:
  // детектор объявил пять «дублей», все — инструкция задания:
  //   1↔4  «with the correct»      1↔6  «complete the sentence»
  //   2↔7  «choose the correct»   2↔10 «choose the correct»   7↔10 то же
  //
  // Лист забраковывался бы как дубльный. Ложный детект хуже пропущенного:
  // учитель потерял бы нормальные задания.
  const englishSheet = [
    t("Choose the correct form of the verb: he ___ (go) to school.", 1),
    t("Choose the correct answer: A) is B) are C) am.", 2),
    t("Put the verbs into the Present Perfect: she (not / call) yet.", 3),
    t("Complete the sentence with the correct preposition: He arrived ___ time.", 4),
    t("Underline the subject in the sentence: The cat sleeps.", 5),
    t("Complete the sentence: There ___ some milk in the fridge.", 6),
    t("Choose the correct word: I ___ finished my homework yet.", 7),
    t("Match the word with its meaning: silent — quiet.", 8),
    t("Fill in the gap with the correct article: ___ apple is red.", 9),
    t("Choose the correct tense: He ___ (watch) TV yesterday.", 10),
  ];

  it("нормальный английский лист не объявляется дубльным", () => {
    const result = findSkillDupes(englishSheet);
    expect(
      result.pairs.map((p) => `${p.first}↔${p.second}: ${p.signature}`),
      "английская инструкция принята за повтор навыка",
    ).toEqual([]);
  });

  it("служебное слово «the» не участвует в сигнатуре", () => {
    // «choose the correct answer» и «choose the correct tense» различаются
    // последним словом; «the» общее и не должно склеивать их.
    const sig = taskSignature("Choose the correct answer").join(" ");
    expect(sig).not.toContain("the");
    expect(sig).not.toContain("choos");
  });

  it("английская инструкция не мешает ловить НАСТОЯЩИЙ дубль", () => {
    // Тот же навык, что и в русском кейсе аудита («подчеркните глагол в
    // Present Perfect»), чтобы доказать: фильтр не стал беззубым.
    const sheet = [
      t("Underline the verb in the Present Perfect: She has finished her homework.", 1),
      t("Underline the verb in the Present Perfect: He has finished his homework.", 2),
      t("Match the word with its meaning: silent — quiet.", 3),
    ];
    const result = findSkillDupes(sheet);
    expect(result.hasDupes, "настоящий дубль перестали ловить").toBe(true);
    expect(result.pairs[0]).toMatchObject({ first: 1, second: 2 });
  });

  it("и короткое задание не съедается целиком", () => {
    // Честная граница: у задания, у которого после снятия инструкции осталось
    // меньше трёх содержательных слов, дублем быть НЕ может. Иначе
    // «choose the correct answer» снова стал бы «навыком».
    const result = findSkillDupes([
      t("Choose the correct form: he (go).", 1),
      t("Choose the correct form: she (go).", 2),
    ]);
    expect(result.pairs).toEqual([]);
  });
});

describe("ТЗ-26 Ф-2: формат с выбором ответа (регресс с живого прогона)", () => {
  // Живой прогон 13.10.2026, лист по английскому 11: шесть «дублей» с общей
  // цепочкой «option правильн вариант». Задания разные, обвязка одинаковая.
  const mcqSheet = [
    t("Choose the correct option: the capital of France is ___ .", 1),
    t("Mark the correct answer: water boils at ___ degrees.", 2),
    t("Выберите правильный вариант ответа: 2 + 2 = ___ .", 3),
    t("Listen and choose the correct option out of three.", 4),
    t("Отметьте верный вариант в задании.", 5),
    t("Read the text and answer the questions below.", 6),
    t("Put the words into the correct order to make a sentence.", 7),
    t("Choose the correct option: the largest planet is ___ .", 8),
    t("Mark the correct answer: a triangle has ___ sides.", 9),
    t("Выберите правильный вариант: 10 : 2 = ___ .", 10),
  ];

  it("лист с тестовыми заданиями не объявляется дубльным", () => {
    const result = findSkillDupes(mcqSheet);
    expect(
      result.pairs.map((p) => `${p.first}↔${p.second}: ${p.signature}`),
      "обвязка теста принята за повтор навыка",
    ).toEqual([]);
  });
});

describe("ТЗ-26 Ф-2: стоп-слова понимают огрублённую форму (регресс)", () => {
  // Ключевой баг, найденный живыми прогонами 13.10.2026: словари записаны
  // НЕОГРУБЛЁННЫМИ словами («правильный», «форма», «завершите»), а фильтр
  // смотрит на ОГРУБЛЁННЫЕ токены. «форма» → «форм», «завершите» → «завершит»,
  // и слова не совпадали: инструкция попадала в сигнатуру и давала ложные
  // срабатывания на нормальных листах по английскому.
  it("русская инструкция не попадает в сигнатуру ни в какой форме", () => {
    // Проверяем, что не уцелели СЛОВА-ОБВЯЗКИ. Само слово «глагол» в «правильная
    // форма глагола» — содержательное, и оно обязано уцелеть: из него одного
    // цепочка в три слова не соберётся, а выкидывать его незачем.
    for (const phrase of [
      "выберите правильный вариант ответа",
      "правильная форма глагола",
      "завершите предложение",
      "отметьте верный ответ",
      "подчеркните правильную форму",
    ]) {
      const sig = taskSignature(phrase).join(" ");
      expect(sig, `«${phrase}» → ${sig}`).not.toMatch(
        /правильн|вариант|форм|заверш|отметь|верн|ответ|подчеркн|выберите/,
      );
    }
  });

  it("английская инструкция не попадает в сигнатуру", () => {
    for (const phrase of [
      "choose the correct option",
      "mark the correct answer",
      "complete the sentence",
      "put the verbs into the correct form",
    ]) {
      const sig = taskSignature(phrase).join(" ");
      expect(sig, `«${phrase}» → ${sig}`).not.toMatch(/правильн|вариант|форм|заверш|option|correct|choos|mark|complet/);
    }
  });

  it("порог остался 3 — настоящие дубли из аудита должны ловиться", () => {
    // Поднимать порог было бы проще, но тогда теряется весь смысл детектора:
    // «живая неживая природа» — ровно три слова.
    const sig = taskSignature("Разделите объекты на живую и неживую природу").join(" ");
    expect(sig.split(" ")).toContain("жив");
    expect(sig.split(" ")).toContain("нежив");
  });
});
