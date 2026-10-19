import type { Worksheet, WorksheetTask, GenerationRequest, ExamVariant } from "@/lib/types";
import { getTopic, getSubject } from "@/lib/content/subjects";
import { getUMKById } from "@/lib/content/umk";
import { shortId } from "@/lib/utils/cn";
import { pickChartForTopic } from "./chart-fixtures";

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

/**
 * Задания, привязанные к ТЕМЕ, для случаев, когда у темы не хватает примеров.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЗАЧЕМ ЭТОТ СПИСОК (аудит 18.10.2026, раздел 8, BUG-014)
 * ─────────────────────────────────────────────────────────────────────────────
 * Раньше хвост листа добивался четырьмя шаблонами, и на листе в 10 заданий
 * они повторялись два с половиной раза. В замере по пяти предметам это дало:
 * химия и история — 7 из 10 непригодных заданий, русский — 5, физика — 4.
 * Учитель видел один и тот же вопрос трижды, а «ответ» к нему был не
 * ответом, а описанием того, как ответ должен выглядеть.
 *
 * Теперь:
 *   1) формулировки РАЗНЫЕ — каждое задание про свой аспект, дословных
 *      повторов в листе нет (проверяется тестом);
 *   2) в «ответе» стоит критерий, и он назван критерием — учитель видит, что
 *      это не готовый ответ, а то, по чему оценивать свободный ответ.
 *
 * Порядок — от простого к сложному, как в настоящем листе.
 *
 * Сколько заготовок: 30 — по максимальному размеру листа (слайдер «Количество»
 * даёт от 5 до 30). Меньше нельзя: на листе из 30 заданий последние 14
 * повторили бы первые 14, а это ровно тот дефект, который чиним.
 */
const TOPIC_FALLBACKS: ReadonlyArray<{
  /** Формулировка задания; тема подставляется в неё. */
  text: (topicTitle: string) => string;
  /** Критерий проверки — то, по чему учитель сверяет свободный ответ. */
  criterion: string;
}> = [
  {
    text: (t) => `Дайте определение понятия «${t}» и приведите пример.`,
    criterion: "Формулирует определение и приводит пример",
  },
  {
    text: (t) => `Назовите два основных понятия темы «${t}» и объясните различие между ними.`,
    criterion: "Называет два понятия и объясняет различие по существу",
  },
  {
    text: (t) => `Приведите пример из жизни, где используются знания по теме «${t}».`,
    criterion: "Называет конкретный пример применения",
  },
  {
    text: (t) => `Составьте короткий план из двух пунктов по теме «${t}».`,
    criterion: "Два пункта по теме в логическом порядке",
  },
  {
    text: (t) => `Объясните своими словами, о чём тема «${t}» и зачем её изучают.`,
    criterion: "Объясняет тему своими словами и называет её цель",
  },
  {
    text: (t) => `Составьте мини-сообщение по теме «${t}» из трёх предложений.`,
    criterion: "Три связных предложения по теме",
  },
  {
    text: (t) => `Ответьте на вопрос: что нужно уметь делать по теме «${t}»?`,
    criterion: "Называет конкретное умение по теме",
  },
  {
    text: (t) => `Составьте таблицу из двух столбцов: термин — его признак, по теме «${t}».`,
    criterion: "Два термина с признаками в виде таблицы",
  },
  {
    text: (t) => `Сформулируйте один вопрос по теме «${t}» и ответьте на него.`,
    criterion: "Вопрос по теме и ответ на него",
  },
  {
    text: (t) => `Подведите итог по теме «${t}» в трёх пунктах.`,
    criterion: "Три пункта итога по теме",
  },
  {
    text: (t) => `Запишите три термина по теме «${t}» и дайте к каждому определение.`,
    criterion: "Три термина с определениями",
  },
  {
    text: (t) => `Составьте памятку по теме «${t}» из трёх пунктов — что нужно помнить.`,
    criterion: "Три пункта, которые действительно нужно запомнить",
  },
  {
    text: (t) => `Объясните, чем тема «${t}» отличается от похожей темы, и назовите её.`,
    criterion: "Называет смежную тему и объясняет различие",
  },
  {
    text: (t) => `Опишите связь понятий темы «${t}»: что из чего следует.`,
    criterion: "Показывает связь понятий, а не перечисление",
  },
  {
    text: (t) => `Составьте мини-тест из двух вопросов по теме «${t}» и ответы к нему.`,
    criterion: "Два вопроса и ответы к ним",
  },
  {
    text: (t) => `Сформулируйте правило по теме «${t}» в виде «если…, то…».`,
    criterion: "Правило с условием и следствием",
  },
  {
    text: (t) => `Выпишите из учебника два утверждения по теме «${t}» и объясните их своими словами.`,
    criterion: "Два утверждения и своё объяснение к каждому",
  },
  {
    text: (t) => `Найдите в учебнике одно задание по теме «${t}» и объясните его решение.`,
    criterion: "Находит задание и объясняет ход решения",
  },
  {
    text: (t) => `Задайте вопрос по теме «${t}», на который ответ можно дать одним предложением.`,
    criterion: "Вопрос по теме с коротким ответом",
  },
  {
    text: (t) => `Составьте словарик из трёх терминов по теме «${t}» — так, как объяснили бы первокласснику.`,
    criterion: "Три термина с простыми пояснениями",
  },
  {
    text: (t) => `Перечислите три признака, по которым тему «${t}» узнают среди других.`,
    criterion: "Три признака, по которым тема узнаётся",
  },
  {
    text: (t) => `Объясните тему «${t}» в одном предложении — так, чтобы было понятно сразу.`,
    criterion: "Одно связное предложение без лишних слов",
  },
  {
    text: (t) => `Составьте разбор одного понятия темы «${t}»: что это, зачем и пример.`,
    criterion: "Разбор из трёх частей: суть, назначение, пример",
  },
  {
    text: (t) => `Объясните, что будет, если не выполнить задание по теме «${t}».`,
    criterion: "Называет последствие и связывает его с темой",
  },
  {
    text: (t) => `Составьте короткий словарик из трёх терминов по теме «${t}».`,
    criterion: "Три термина с пояснениями",
  },
  {
    text: (t) => `Опишите по шагам, как выполнить типовое задание по теме «${t}».`,
    criterion: "Описывает шаги выполнения по теме",
  },
  {
    text: (t) => `Объясните разницу между «${t}» и тем, что вы изучали раньше.`,
    criterion: "Называет различие с ранее изученным",
  },
  {
    text: (t) => `Составьте план подготовки к контрольной по теме «${t}» из трёх пунктов.`,
    criterion: "Три пункта подготовки по теме",
  },
  {
    text: (t) => `Ответьте, где ещё пригождаются знания по теме «${t}», и приведите пример.`,
    criterion: "Называет область применения и пример",
  },
];

/**
 * Нейтральная заготовка для предмета без своих шаблонов (08.10.2026).
 *
 * Содержит НИ ОДНОГО задания по математике: предмет в формулировке
 * подставляется как есть, поэтому лист по биологии или технологии не может
 * внезапно оказаться листом с дробями. Порядок вопросов — от простого к
 * сложному, как в настоящем листе.
 *
 * С 18.10.2026 используется только когда у темы НЕТ своих примеров: если
 * примеры есть, хвост листа добивается тематическими заданиями
 * (`TOPIC_FALLBACKS`), а не общими для предмета.
 */
const SUBJECT_AGNOSTIC_TEMPLATES: ReadonlyArray<{
  text: (topicTitle: string) => string;
  answer: string;
}> = [
  {
    text: (t) => `Назовите основные понятия темы «${t}» и объясните каждое своими словами.`,
    answer: "Перечисляет ключевые понятия и поясняет каждое",
  },
  {
    text: (t) => `Приведите пример из жизни, где используются знания по теме «${t}».`,
    answer: "Называет конкретный пример применения",
  },
  {
    text: (t) => `Объясните разницу между двумя понятиями темы «${t}».`,
    answer: "Формулирует различие по существу, а не по названию",
  },
  {
    text: (t) => `Составьте короткий план из двух пунктов по теме «${t}».`,
    answer: "Два пункта по теме в логическом порядке",
  },
];

export async function generateWorksheet(req: GenerationRequest): Promise<Worksheet> {
  const topic = getTopic(req.subject, req.grade, req.topic);
  const subject = getSubject(req.subject);
  // НЕЗАМЕНЯЕМ ШАБЛОНЫ МАТЕМАТИКИ ДЛЯ ЧУЖИХ ПРЕДМЕТОВ (08.10.2026).
  //
  // Раньше здесь стояло `TASK_TEMPLATES[req.subject] ?? TASK_TEMPLATES.math` —
  // то есть для биологии, окружающего мира, технологии, географии и ещё
  // примерно двадцати предметов ПОДСТАВЛЯЛИСЬ ЗАДАНИЯ ПО ДРОБЯМ.
  //
  // Это не косметика: `templates` — единственный источник заданий, когда у
  // темы нет готовых примеров в таксономии, то есть на большинстве тем. Любой
  // сбой бэкенда, таймаут или незаданный `NEXT_PUBLIC_API_URL` отправляли
  // учителя в демо-режим — и он получал «биология, 9 класс» с дробями. Это
  // самое правдоподобное объяснение жалоб «опять математика в заданиях».
  //
  // Теперь для предмета без шаблонов используется НЕЙТРАЛЬНАЯ заготовка по
  // теме, а не математика. Заготовка честно помечена как демо и не выдаёт себя
  // за настоящий материал.
  const ownTemplates: ReadonlyArray<{ text: string; answer?: string }> | undefined =
    TASK_TEMPLATES[req.subject as keyof typeof TASK_TEMPLATES];
  const templates: ReadonlyArray<{ text: string | ((t: string) => string); answer?: string }> =
    ownTemplates ?? SUBJECT_AGNOSTIC_TEMPLATES;
  /**
   * У ШАБЛОНОВ БЕЗ СВОИХ ОТВЕТОВ «ответ» — это критерий, и он назван критерием.
   * У своих шаблонов предмета (математика, русский, английский) ответ настоящий.
   */
  const templatesAreCriteria = !ownTemplates;

  const tasks: WorksheetTask[] = [];
  const pool = [...templates];

  /**
   * Есть ли у темы свои примеры.
   *
   * От этого зависит, чем добивается хвост листа. Если примеры есть — тематическими
   * заданиями (`TOPIC_FALLBACKS`), потому что ОБЩИЕ шаблоны предмета к теме
   * отношения не имеют: в замере по математике 5 класса лист по теме «Обыкновенные
   * дроби» получал задание про треугольник с углами 50° и 60° (аудит 18.10.2026,
   * раздел 8.1, задания 5–7).
   */
  const hasTopicExamples = Boolean(topic && topic.examples.length > 0);
  /**
   * Название темы для формулировок.
   *
   * Раньше здесь стояло `topic?.title ?? "предмет"` — и в режиме ОГЭ/ЕГЭ, где темы
   * в каталоге нет, на листе у ученика было написано «Расскажите по теме
   /// „предмет“» (BUG-035). Теперь подставляется то, что реально запросили.
   */
  const topicTitle = topic?.title ?? (req.topic.includes(" ") ? req.topic : (subject?.title ?? req.topic));

  // Добиваем до нужного count, используя examples из таксономии и простые шаблоны
  while (tasks.length < req.count) {
    if (hasTopicExamples && tasks.length < topic!.examples.length) {
      const ex = topic!.examples[tasks.length];
      tasks.push({
        number: tasks.length + 1,
        text: ex.text,
        type: ex.text.includes("(") ? "fill-blank" : "short-answer",
        answer: ex.answer,
        explanation: ex.hint,
        points: 1,
      });
    } else if (!hasTopicExamples && pool.length > 0) {
      const t = pool.shift()!;
      const tText = typeof t.text === "function" ? t.text(topicTitle) : t.text;
      tasks.push({
        ...t,
        text: tText,
        type: "short-answer",
        answer: templatesAreCriteria ? `Критерий ответа: ${t.answer ?? ""}` : t.answer,
        number: tasks.length + 1,
        points: req.difficulty === "easy" ? 1 : req.difficulty === "medium" ? 2 : 3,
      });
    } else if (!hasTopicExamples && req.difficulty === "easy") {
      // Как и выше: подставлять математику любому предмету нельзя — это и есть
      // жалобы «в биологии вдруг дроби». Для неизвестного предмета идёт
      // нейтральная заготовка.
      const ownEasy: ReadonlyArray<{ text: string; answer?: string }> | undefined =
        EASY_TEMPLATES[req.subject as keyof typeof EASY_TEMPLATES];
      const easy: ReadonlyArray<{ text: string | ((t: string) => string); answer?: string }> =
        ownEasy ?? SUBJECT_AGNOSTIC_TEMPLATES;
      const e = easy[tasks.length % easy.length];
      const eText = typeof e.text === "function" ? e.text(topicTitle) : e.text;
      tasks.push({
        number: tasks.length + 1,
        text: eText,
        type: "short-answer",
        answer: ownEasy ? e.answer : `Критерий ответа: ${e.answer ?? ""}`,
        points: 1,
      });
    } else {
      // Тематическое задание (аудит 18.10.2026, раздел 8, BUG-014).
      //
      // Раньше здесь стояло:
      //   text:  `Задание #N по теме «…» — выполните по образцу.`
      //   answer: "индивидуальный ответ"
      //
      // Это ровно то, на что жаловалась учительница: «задания „выполните по
      // образцу“ — нет никакого образца» и «ответы странные». И это шло не
      // из модели — это был НАШ собственный демо-шаблон, то есть продукт
      // показывал заведомый мусор и подписывал его как материал.
      //
      // Потом хвост листа состоял из четырёх ШАБЛОНОВ, и на листе в 10 заданий
      // они повторялись два с половиной раза («три дословных повтора» в
      // замере). Теперь формулировка у каждого задания своя, а «ответ» —
      // честно названный критерий, а не вид ответа.
      const fb = TOPIC_FALLBACKS[tasks.length % TOPIC_FALLBACKS.length];
      tasks.push({
        number: tasks.length + 1,
        text: fb.text(topicTitle),
        type: "short-answer",
        // Критерий назван критерием: учитель должен видеть, что это не
        // готовый ответ, а то, по чему оценивать свободный ответ.
        answer: `Критерий ответа: ${fb.criterion}`,
        points: 2,
      });
    }
  }

  const baseTasks = tasks.slice(0, req.count);

  // F-05: заготовка НЕ проверяется — и это исправление, а не потеря (06.10.2026).
  //
  // Раньше здесь стоял вызов selfVerifyTask по каждому заданию заготовки, то
  // есть бейдж «проверено» получал ПОДСТАВНОЙ контент, а настоящий лист с
  // сервера не проверялся никогда. Проверять типовой шаблон бессмысленно (его
  // ответы заведомо верны) и притом это 10–20 платных вызовов на демо-лист.
  // Настоящий лист проверяет учитель кнопкой «Проверить ответы» —
  // см. src/lib/llm/verify-sheet.ts.
  const verifiedTasks: WorksheetTask[] = baseTasks;

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
    // Название темы — из запроса, если в каталоге её нет (режим ОГЭ/ЕГЭ):
    // раньше лист назывался просто «Рабочий лист», и было не видно, по какой
    // теме он собран (BUG-035).
    title: topicTitle ? `${titlePrefix} · ${topicTitle}${umkSuffix}` : `${titlePrefix}${umkSuffix}`,
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
    // Раньше здесь стояло `answer: "индивидуальный ответ"` — та же фраза-заглушка,
    // на которую жаловалась учительница («ответы странные», в каждом задании).
    // Ключ должен содержать то, с чем учитель сверяет работу.
    answer: "Называет базовое понятие курса и объясняет его на примере",
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