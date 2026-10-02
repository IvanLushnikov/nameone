import type { Worksheet, WorksheetTask, GenerationRequest, ExamVariant } from "@/lib/types";
import { getTopic, getSubject } from "@/lib/content/subjects";
import { getUMKById } from "@/lib/content/umk";
import { shortId } from "@/lib/utils/cn";
import { pickChartForTopic } from "./chart-fixtures";
import { selfVerifyTask } from "@/lib/llm/self-verify";

/**
 * Мок-генератор рабочих листов и вариантов экзаменов.
 * В production этот модуль заменится на вызовы OpenAI/Anthropic с self-verification.
 */

const TASK_TEMPLATES: Record<string, WorksheetTask[]> = {
  math: [
    {
      number: 1,
      text: "Решите уравнение: 3x + 12 = 0. Запишите корень.",
      type: "short-answer",
      answer: "x = -4",
      explanation: "3x = -12 → x = -12 : 3 = -4",
      points: 1,
    },
    {
      number: 2,
      text: "Найдите значение выражения: 2 · 5² − 18 ÷ 3.",
      type: "short-answer",
      answer: "44",
      explanation: "5² = 25, 2·25 = 50, 18 ÷ 3 = 6, 50 − 6 = 44",
      points: 2,
    },
    {
      number: 3,
      text: "В треугольнике ABC угол A = 50°, угол B = 60°. Найдите угол C.",
      type: "short-answer",
      answer: "70°",
      explanation: "180° − (50° + 60°) = 70°",
      points: 1,
    },
  ],
  russian: [
    {
      number: 1,
      text: "Вставьте пропущенную букву: пр_бежать, пр_града, пр_зидент.",
      type: "fill-blank",
      answer: "и, и, е",
      explanation: "Приставки ПРИ-/ПРЕ-: значение приближения, неполноты (прибежать ≈ приблизиться); исключения (преграда, президент).",
      points: 2,
    },
    {
      number: 2,
      text: "Определите часть речи: «бегущий».",
      type: "multiple-choice",
      options: ["прилагательное", "причастие", "деепричастие", "глагол"],
      answer: "причастие",
      explanation: "Бегущий = тот, кто бежит; совмещает признаки прилагательного и глагола → причастие.",
      points: 1,
    },
    {
      number: 3,
      text: "Расставьте запятые. Подчеркните причастный оборот как обособленное определение.",
      type: "short-answer",
      answer: "Солнце, освещавшее поля, поднялось выше горизонта.",
      explanation: "Причастный оборот, стоящий после определяемого слова, обособляется запятыми.",
      points: 2,
    },
  ],
  english: [
    {
      number: 1,
      text: "Open the brackets: If I (know) the answer, I (tell) you.",
      type: "fill-blank",
      answer: "knew / would tell",
      explanation: "Conditional II: If + Past Simple, would + infinitive.",
      points: 2,
    },
    {
      number: 2,
      text: "Choose the right form: She ___ to school every day.",
      type: "multiple-choice",
      options: ["go", "goes", "going", "went"],
      answer: "goes",
      explanation: "Present Simple для регулярных действий; 3rd person singular → -s.",
      points: 1,
    },
    {
      number: 3,
      text: "Make passive: They built a new school last year.",
      type: "short-answer",
      answer: "A new school was built last year.",
      explanation: "Past Simple Passive: was/were + V3.",
      points: 1,
    },
  ],
};

const EASY_TEMPLATES = {
  math: [
    { text: "2 + 3 = __", answer: "5" },
    { text: "7 − 4 = __", answer: "3" },
    { text: "5 × 6 = __", answer: "30" },
  ],
  russian: [
    { text: "Вставьте букву: м_ряк", answer: "о", hint: "морЯк" },
    { text: "Найдите корень: водяной", answer: "вод-" },
  ],
  english: [
    { text: "She (go) to school. →", answer: "goes" },
    { text: "Перевод: cat =", answer: "кошка" },
  ],
} as const;

export async function generateWorksheet(req: GenerationRequest): Promise<Worksheet> {
  const topic = getTopic(req.subject, req.grade, req.topic);
  const subject = getSubject(req.subject);
  const templates = TASK_TEMPLATES[req.subject] ?? TASK_TEMPLATES.math;

  const tasks: WorksheetTask[] = [];
  const pool = [...templates];

  // Добиваем до нужного count, используя examples из таксономии и простые шаблоны
  while (tasks.length < req.count) {
    if (topic?.examples.length && tasks.length < topic.examples.length) {
      const ex = topic.examples[tasks.length % topic.examples.length];
      tasks.push({
        number: tasks.length + 1,
        text: ex.text,
        type: ex.text.includes("(") ? "fill-blank" : "short-answer",
        answer: ex.answer,
        explanation: ex.hint,
        points: 1,
      });
    } else if (pool.length > 0) {
      const t = pool.shift()!;
      tasks.push({
        ...t,
        number: tasks.length + 1,
        points: req.difficulty === "easy" ? 1 : req.difficulty === "medium" ? 2 : 3,
      });
    } else if (req.difficulty === "easy") {
      const easy = EASY_TEMPLATES[req.subject as keyof typeof EASY_TEMPLATES] ?? EASY_TEMPLATES.math;
      const e = easy[tasks.length % easy.length];
      tasks.push({
        number: tasks.length + 1,
        text: e.text,
        type: "short-answer",
        answer: e.answer,
        points: 1,
      });
    } else {
      // fallback: генерим вариации
      tasks.push({
        number: tasks.length + 1,
        text: `Задание #${tasks.length + 1} по теме «${topic?.title ?? "материал"}» — выполните по образцу.`,
        type: "short-answer",
        answer: "индивидуальный ответ",
        points: 1,
      });
    }
  }

  const baseTasks = tasks.slice(0, req.count);

  // F-05-B: self-verification — параллельный вызов Worker-а для каждой задачи.
  // Worker может быть недоступен: selfVerifyTask вернёт {verified: null}, генерация не падает.
  const verifiedTasks: WorksheetTask[] = await Promise.all(
    baseTasks.map(async (t) => {
      const r = await selfVerifyTask({
        subject: req.subject,
        grade: req.grade,
        topic: topic?.slug ?? req.topic,
        text: t.text,
        expectedAnswer: t.answer,
      });
      return {
        ...t,
        verified: r.verified,
        verifiedExplanation: r.explanation,
      };
    })
  );

  const titlePrefix =
    req.type === "test" ? "Тест" :
    req.type === "cards" ? "Карточки" :
    req.type === "control" ? "Контрольная" :
    "Рабочий лист";

  // TZ-08: если в meta пробрасывался УМК, добавляем его в заголовок.
  // Это best-effort: если id невалиден — getUMKById вернёт undefined, и мы ничего не добавляем.
  const umkId = typeof req.meta?.umk === "string" ? req.meta.umk : null;
  const umkEntry = umkId ? getUMKById(req.subject, umkId) : null;
  const umkSuffix = umkEntry ? ` · ${umkEntry.short}` : "";

  return {
    id: shortId(),
    title: topic?.title ? `${titlePrefix} · ${topic.title}${umkSuffix}` : `${titlePrefix}${umkSuffix}`,
    subject: subject?.title ?? req.subject,
    grade: req.grade,
    topic: topic?.slug ?? req.topic,
    difficulty: req.difficulty,
    tasks: adaptTasksForType(verifiedTasks, req.type),
    createdAt: new Date().toISOString(),
    // Phase 1: подбираем chart_spec из фикстур (Phase 2 заменим на LLM-выдачу).
    chartSpec: pickChartForTopic(req.subject, req.topic) ?? undefined,
  };
}

/**
 * F-09: дифференциация по типу артефакта.
 *
 * - "worksheet" — оставляем как есть (свободные ответы + опции если были).
 * - "test"      — приводим задания к multiple-choice: если есть готовые options —
 *                 оставляем; если только short-answer/fill-blank — генерим 4 правдоподобных
 *                 варианта, помечая правильный первым; переименовываем заголовок.
 * - "cards"     — уплотняем: на 1 «карточку» — 1 задача (короткий вопрос + короткий ответ),
 *                 без нумерации и без развёрнутых пояснений в самом теле карточки.
 *                 На preview-странице это выглядит как сетка 2×N, а не нумерованный список.
 * - "control"   — как "worksheet", но в title добавляем пометку «Контрольная».
 *
 * Цель — дать визуально и контентно разный результат при переключении типа.
 */
function adaptTasksForType(tasks: WorksheetTask[], type: string | undefined): WorksheetTask[] {
  if (!type || type === "worksheet") return tasks;
  if (type === "control") return tasks;

  if (type === "test") {
    return tasks.map((t, i) => {
      // Если у задачи уже есть готовые options — оставляем, нормализуем длину до 4.
      if (t.options && t.options.length >= 2) {
        const opts = t.options.slice(0, 4);
        return { ...t, type: "multiple-choice" as const, options: opts };
      }
      // Иначе конвертируем short-answer → multiple-choice с 4 вариантами,
      // правильный ответ идёт под A, дистракторы — B/C/D.
      const correct = String(t.answer ?? "—");
      const distractors = makeDistractors(correct, i);
      return {
        ...t,
        type: "multiple-choice" as const,
        options: [correct, ...distractors],
      };
    });
  }

  if (type === "cards") {
    // Для карточек оставляем задачу, но помечаем первую букву ответа как «подсказку»
    // (по CARD_FRONT = вопрос, CARD_BACK = ответ). В preview рендерим как сетку.
    // Сам preview-компонент решает, как это визуализировать.
    return tasks.map((t) => {
      const answer = String(t.answer ?? "—");
      const hint = answer.length > 24 ? answer.slice(0, 22) + "…" : answer;
      return {
        ...t,
        // Не обрезаем текст задания — карточка должна читаться.
        // Подсказка к ответу уезжает в verifiedExplanation для краткости превью.
        verifiedExplanation: t.explanation ?? hint,
        explanation: undefined,
      };
    });
  }

  return tasks;
}

/** Сгенерировать 3 правдоподобных дистрактора для multiple-choice. */
function makeDistractors(correct: string, seed: number): string[] {
  const trimmed = correct.trim();
  const isNumber = /^-?\d+([.,]\d+)?(°|%)?$/.test(trimmed);
  const numericBase = isNumber ? Number(trimmed.replace(/[^\d.,-]/g, "").replace(",", ".")) : NaN;

  if (Number.isFinite(numericBase)) {
    const a = Number((numericBase + 1 + (seed % 3)).toFixed(2));
    const b = Number((numericBase - 1 - (seed % 2)).toFixed(2));
    const c = Number((numericBase * 2 + (seed % 4)).toFixed(2));
    return [String(a), String(b), String(c)];
  }

  // Текстовый дистрактор: лёгкие вариации без логики, но без явной копии правильного.
  const suffix = ["(возможный вариант)", "(ответ выше)", "(проверь ещё раз)"];
  return suffix.map((s) => `${trimmed.split(" ").slice(0, 2).join(" ")} ${s}`);
}

/**
 * TZ-13: язык формулировок задаётся предметом.
 *   - "english" / "german" → формулировки на целевом языке.
 *   - всё остальное → строго на русском.
 *
 * Здесь — короткие задания Часть 1 №1 и №2. Для каждого предмета — своё
 * содержание. Если предмет неизвестен мапе — универсальная русская формулировка
 * с явной отсылкой к названию предмета (getSubject(...).title).
 */
const EXAM_P1_T1: Record<
  string,
  { text: string; answer: string; explanation: string }
> = {
  math: {
    text: "Найдите значение выражения: 2,5 · 0,4 + 1,2.",
    answer: "2,2",
    explanation: "2,5 · 0,4 = 1,0; 1,0 + 1,2 = 2,2.",
  },
  russian: {
    text: "В каком слове допущена ошибка: приехать, преграда, презирать, приоритет?",
    answer: "приехать (правильно: при-ехать; смысл «приближение»)",
    explanation: "ПРИ-/ПРЕ- по значению: «приехать» = приблизиться (ПРИ-); остальные — ПРЕ- = очень/пере-.",
  },
  physics: {
    text: "Тело движется прямолинейно со скоростью 5 м/с в течение 4 с. Какой путь оно пройдёт?",
    answer: "20 м",
    explanation: "S = v · t = 5 · 4 = 20 м.",
  },
  chemistry: {
    text: "Определите число протонов в атоме натрия (Na).",
    answer: "11",
    explanation: "Атомный номер натрия — 11, значит протонов тоже 11.",
  },
  biology: {
    text: "Какой органоид клетки отвечает за синтез белка?",
    answer: "рибосома",
    explanation: "Рибосомы осуществляют трансляцию — сборку белка из аминокислот на матричной РНК.",
  },
  informatics: {
    text: "Переведите число 1010₂ в десятичную систему счисления.",
    answer: "10",
    explanation: "1010₂ = 1·8 + 0·4 + 1·2 + 0·1 = 10.",
  },
  history: {
    text: "В каком году произошло Крещение Руси?",
    answer: "988",
    explanation: "Крещение Руси состоялось в 988 году при князе Владимире Святославиче.",
  },
  social: {
    text: "Как называется высший орган законодательной власти в Российской Федерации?",
    answer: "Федеральное Собрание",
    explanation: "Согласно ст. 94 Конституции РФ, Федеральное Собрание — парламент РФ.",
  },
  literature: {
    text: "Кто является автором романа «Война и мир»?",
    answer: "Л. Н. Толстой",
    explanation: "Роман-эпопея «Война и мир» написан Львом Николаевичем Толстым, опубликован в 1869 г.",
  },
  english: {
    text: "Open the brackets: She (read) a book now.",
    answer: "is reading",
    explanation: "Present Continuous для действия, происходящего сейчас.",
  },
  german: {
    text: "Setze die richtige Form ein: Ich ___ (gehen) in die Schule.",
    answer: "gehe",
    explanation: "Präsens, 1. Person Singular: ich gehe.",
  },
};

/** Задание №2 Часть 1: для math/russian и для языков — свои формулировки,
 *  для физики/информатики/истории — на русском, для языков — на целевом. */
const EXAM_P1_T2: Record<
  string,
  { text: string; options?: string[]; answer: string; explanation: string }
> = {
  math: {
    text: "Решите уравнение: 2x + 6 = 14.",
    answer: "x = 4",
    explanation: "Базовый навык по теме.",
  },
  russian: {
    text: "Укажите предложение с деепричастным оборотом.",
    answer: "Прочитав книгу, я понял главное.",
    explanation: "Деепричастный оборот отвечает на вопрос «что делая?».",
  },
  physics: {
    text: "Какой формулой выражается второй закон Ньютона?",
    options: ["F = m·a", "F = m·v", "F = m·g", "F = p·t"],
    answer: "F = m·a",
    explanation: "Второй закон Ньютона: F = m·a, где m — масса, a — ускорение.",
  },
  chemistry: {
    text: "Какой газ выделяется при взаимодействии кислоты с металлами?",
    options: ["кислород", "водород", "углекислый газ", "азот"],
    answer: "водород",
    explanation: "Кислота + металл → соль + H₂↑.",
  },
  biology: {
    text: "Какое из перечисленных царств относится к ядерным организмам (эукариотам)?",
    options: ["бактерии", "вирусы", "животные", "археи"],
    answer: "животные",
    explanation: "Животные — эукариоты; бактерии и археи — прокариоты; вирусы — неклеточная форма.",
  },
  informatics: {
    text: "Чему равно значение выражения: 5 AND 3 в побитовой операции (битwise AND)?",
    options: ["1", "3", "5", "8"],
    answer: "1",
    explanation: "5 = 0101₂, 3 = 0011₂, AND = 0001₂ = 1.",
  },
  history: {
    text: "В какой битве произошёл перелом в Великой Отечественной войне?",
    options: ["битва за Москву", "Сталинградская битва", "битва за Берлин", "Курская битва"],
    answer: "Сталинградская битва",
    explanation: "Сталинградская битва (17.07.1942 – 02.02.1943) — коренной перелом в ВОВ.",
  },
  social: {
    text: "Какой тип государства характеризуется наличием единоличной власти?",
    options: ["демократия", "монархия", "федерация", "республика"],
    answer: "монархия",
    explanation: "Монархия — форма правления, при которой верховная власть принадлежит одному лицу — монарху.",
  },
  literature: {
    text: "Как называется художественный приём, при котором описание природы отражает переживания героя?",
    options: ["аллегория", "психологизм", "пейзаж", "олицетворение"],
    answer: "психологизм",
    explanation: "Пейзаж как средство психологизма — приём Толстого, Тургенева, Чехова.",
  },
  english: {
    text: "Choose the right form: If I ___ you, I would go.",
    options: ["was", "were", "am", "be"],
    answer: "were",
    explanation: "Conditional II (нереальное условие): If + Past Simple, would + infinitive. Were для всех лиц.",
  },
  german: {
    text: "Wähle die richtige Form: Ich ___ Deutsch.",
    options: ["lerne", "lernst", "lernt", "lernen"],
    answer: "lerne",
    explanation: "Präsens, 1. Person Singular: ich lerne.",
  },
};

/** Резервный универсальный русский текст для неизвестных мапе предметов.
 *  TZ-13: даже для неожиданных slug'ов язык остаётся русским. */
function genericRuTask1(subjectTitle: string): {
  text: string;
  answer: string;
  explanation: string;
} {
  return {
    text: `Кратко ответьте на вопрос по предмету «${subjectTitle}»: какой базовый факт изучается в начале курса?`,
    answer: "индивидуальный ответ",
    explanation: `Базовый факт определяется программой по предмету «${subjectTitle}».`,
  };
}

function genericRuTask2(subjectTitle: string): {
  text: string;
  options?: string[];
  answer: string;
  explanation: string;
} {
  return {
    text: `Выберите один из вариантов, относящийся к предмету «${subjectTitle}».`,
    options: ["вариант A", "вариант B", "вариант C", "вариант D"],
    answer: "вариант B",
    explanation: `Обоснование выбора зависит от темы по предмету «${subjectTitle}».`,
  };
}

export function generateExamVariant(
  exam: "oge" | "ege",
  subjectSlug: string,
  variantNumber: number
): ExamVariant {
  const subject = getSubject(subjectSlug);
  const duration = exam === "oge" ? 235 : 235;
  const subjectTitle = subject?.shortTitle ?? subjectSlug;

  // TZ-13: формулировки строго по языку предмета.
  const t1 = EXAM_P1_T1[subjectSlug] ?? genericRuTask1(subjectTitle);
  const t2 = EXAM_P1_T2[subjectSlug] ?? genericRuTask2(subjectTitle);

  // Мок: 5 простых + 2 сложных задания
  const problems = [
    {
      number: 1,
      part: 1 as const,
      text: t1.text,
      type: "short-answer" as const,
      answer: t1.answer,
      explanation: t1.explanation,
      points: 1,
    },
    {
      number: 2,
      part: 1 as const,
      text: t2.text,
      type: t2.options ? ("choice" as const) : ("short-answer" as const),
      options: t2.options,
      answer: t2.answer,
      explanation: t2.explanation,
      points: 1,
    },
    {
      number: 3,
      part: 1 as const,
      text: "Текст задачи в 1-2 предложениях по теме экзамена.",
      type: "short-answer" as const,
      answer: "12",
      explanation: "Решение — в одно действие.",
      points: 1,
    },
    {
      number: 4,
      part: 1 as const,
      text: "Текст задачи на выбор ответа.",
      type: "choice" as const,
      options: ["вариант A", "вариант B", "вариант C", "вариант D"],
      answer: "вариант B",
      explanation: "Обоснование выбора.",
      points: 1,
    },
    {
      number: 5,
      part: 2 as const,
      text: "Развёрнутое задание повышенной сложности. Запишите полное решение.",
      type: "detailed" as const,
      answer: "См. разбор ниже.",
      explanation: "Решение разбирается по шагам: 1) выделяем условие; 2) применяем формулу; 3) записываем ответ.",
      points: 2,
    },
    {
      number: 6,
      part: 2 as const,
      text: "Текст сложной задачи (2 балла).",
      type: "detailed" as const,
      answer: "См. разбор.",
      explanation: "Подробный разбор.",
      points: 2,
    },
  ];

  return {
    id: shortId(),
    exam,
    subject: subjectSlug as ExamVariant["subject"],
    variantNumber,
    title: `${exam === "oge" ? "ОГЭ" : "ЕГЭ"} · ${subject?.shortTitle ?? subjectSlug} · Вариант ${variantNumber}`,
    duration,
    problems,
  };
}