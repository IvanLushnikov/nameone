import type { Worksheet, WorksheetTask, GenerationRequest, ExamVariant } from "@/lib/types";
import { getTopic, getSubject } from "@/lib/content/subjects";
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

  return {
    id: shortId(),
    title: topic?.title ?? "Рабочий лист",
    subject: subject?.title ?? req.subject,
    grade: req.grade,
    topic: topic?.slug ?? req.topic,
    difficulty: req.difficulty,
    tasks: verifiedTasks,
    createdAt: new Date().toISOString(),
    // Phase 1: подбираем chart_spec из фикстур (Phase 2 заменим на LLM-выдачу).
    chartSpec: pickChartForTopic(req.subject, req.topic) ?? undefined,
  };
}

export function generateExamVariant(
  exam: "oge" | "ege",
  subjectSlug: string,
  variantNumber: number
): ExamVariant {
  const subject = getSubject(subjectSlug);
  const duration = exam === "oge" ? 235 : 235;

  // Мок: 5 простых + 2 сложных задания
  const problems = [
    {
      number: 1,
      part: 1 as const,
      text: subjectSlug === "math"
        ? "Найдите значение выражения: 2,5 · 0,4 + 1,2."
        : subjectSlug === "russian"
          ? "В каком слове допущена ошибка: приехать, преграда, презирать, приоритет?"
          : "Open the brackets: She (read) a book now.",
      type: "short-answer" as const,
      answer:
        subjectSlug === "math"
          ? "2,2"
          : subjectSlug === "russian"
            ? "приехать (правильно: при-ехать; смысл «приближение»)"
            : "is reading",
      explanation:
        subjectSlug === "math"
          ? "2,5 · 0,4 = 1,0; 1,0 + 1,2 = 2,2."
          : subjectSlug === "russian"
            ? "ПРИ-/ПРЕ- по значению: «приехать» = приблизиться (ПРИ-); остальные — ПРЕ- = очень/пере-."
            : "Present Continuous для действия, происходящего сейчас.",
      points: 1,
    },
    {
      number: 2,
      part: 1 as const,
      text: subjectSlug === "math"
        ? "Решите уравнение: 2x + 6 = 14."
        : subjectSlug === "russian"
          ? "Укажите предложение с деепричастным оборотом."
          : "Choose the right form: If I ___ you, I would go.",
      type: "short-answer" as const,
      options: subjectSlug === "english" ? ["was", "were", "am", "be"] : undefined,
      answer:
        subjectSlug === "math"
          ? "x = 4"
          : subjectSlug === "russian"
            ? "Прочитав книгу, я понял главное."
            : "were",
      explanation: "Базовый навык по теме.",
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