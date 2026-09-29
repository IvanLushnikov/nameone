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