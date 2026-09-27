/**
 * Q1-2027: мок-генератор плана урока (ФГОС-конспект на 45 мин).
 *
 * Worker A — реализация для интеграционного манифеста TZ-01.
 * Тип возврата и сигнатура зафиксированы контрактом `client/llm.ts`,
 * поэтому изменения здесь не должны ломать downstream-вызовы.
 *
 * Генерирует:
 *   • 6 шагов урока в порядке ФГОС-конспекта (3+5+15+15+5+2 = 45 мин ± 2).
 *   • Цели (обучающие / развивающие / воспитательные) — по семейству предмета.
 *   • Оборудование (1–3 строки) — по семейству предмета.
 *   • Текст ДЗ + 1–2 альтернативы.
 *
 * Edge case: если тема не нашлась в таксономии — план всё равно собирается
 * (на основе семейства предмета и slug'а из запроса), UX не падает.
 */
import type {
  GenerationRequest,
  LessonPlan,
  LessonStage,
  LessonStageKind,
  SubjectSlug,
} from "@/lib/types";
import { getSubject, getTopic } from "@/lib/content/subjects";
import { shortId } from "@/lib/utils/cn";

type Family =
  | "math"
  | "language"
  | "science"
  | "society"
  | "arts"
  | "default";

interface Ctx {
  shortTitle: string;
  grade: number;
  topicTitle: string;
  topicSlug: string;
  /** Пример задачи из таксономии (если нашёлся), для упоминания в объяснении. */
  exampleHint?: string;
}

/** Группируем 21 предмет в 5 семейств, чтобы один набор шаблонов покрывал близкие дисциплины. */
function familyOf(slug: SubjectSlug): Family {
  if (slug === "math" || slug === "algebra" || slug === "geometry" || slug === "informatics") return "math";
  if (slug === "russian" || slug === "literature" || slug === "english" || slug === "german") return "language";
  if (slug === "physics" || slug === "chemistry" || slug === "biology" || slug === "geography") return "science";
  if (slug === "history" || slug === "social" || slug === "obzh" || slug === "okruzhaet") return "society";
  if (slug === "art" || slug === "music" || slug === "technology" || slug === "pe" || slug === "finance") return "arts";
  return "default";
}

function buildCtx(req: GenerationRequest): Ctx {
  const subject = getSubject(req.subject);
  const topic = getTopic(req.subject, req.grade, req.topic);
  const example = topic?.examples[0];
  return {
    shortTitle: subject?.shortTitle ?? req.subject,
    grade: req.grade,
    topicTitle: topic?.title ?? req.topic,
    topicSlug: topic?.slug ?? req.topic,
    exampleHint: example?.text,
  };
}

/**
 * Цели по семейству. 2–3 обучающие / 1–2 развивающие / 1 воспитательная.
 * Все строки подставляют {topic} — единый шаблон для рендера.
 */
function goalsFor(family: Family, topicTitle: string): LessonPlan["goals"] {
  const goals: Record<Family, LessonPlan["goals"]> = {
    math: {
      educational: [
        `Сформировать представление о теме «${topicTitle}» и её месте в курсе математики.`,
        `Научить применять основные понятия, алгоритмы и обозначения при решении задач.`,
        `Обеспечить усвоение терминологии и базовых формул.`,
      ],
      developmental: [
        `Развивать логическое мышление и умение анализировать условие задачи.`,
        `Развивать вычислительные навыки и математическую речь.`,
      ],
      nurturing: [`Воспитывать аккуратность, внимательность и культуру оформления записей.`],
    },
    language: {
      educational: [
        `Сформировать представление о теме «${topicTitle}» как о системе правил / литературном явлении.`,
        `Научить применять полученные знания в устной и письменной речи.`,
        `Обеспечить усвоение терминологии и базовых конструкций.`,
      ],
      developmental: [
        `Развивать речевые навыки и умение работать с текстом.`,
        `Развивать критическое мышление при анализе языковых явлений.`,
      ],
      nurturing: [`Воспитывать интерес к родному / иностранному языку и культуре.`],
    },
    science: {
      educational: [
        `Сформировать представление о теме «${topicTitle}» как части естественнонаучной картины мира.`,
        `Научить применять базовые понятия и методы при решении задач и проведении наблюдений.`,
        `Обеспечить усвоение терминологии, формул и единиц измерения.`,
      ],
      developmental: [
        `Развивать умение наблюдать, сравнивать и формулировать выводы.`,
        `Развивать навыки работы с приборами, картами или схемами.`,
      ],
      nurturing: [`Воспитывать бережное отношение к природе и ответственность за экологию.`],
    },
    society: {
      educational: [
        `Сформировать представление о теме «${topicTitle}» в контексте исторического или общественного процесса.`,
        `Научить работать с историческими источниками и нормативными документами.`,
        `Обеспечить усвоение ключевых дат, понятий и причинно-следственных связей.`,
      ],
      developmental: [
        `Развивать умение анализировать источники и формулировать аргументированные суждения.`,
        `Развивать навыки публичного выступления и участия в дискуссии.`,
      ],
      nurturing: [`Воспитывать гражданскую позицию и уважение к многообразию культур.`],
    },
    arts: {
      educational: [
        `Сформировать представление о теме «${topicTitle}» как практическом навыке.`,
        `Научить применять полученные знания в творческой или практической деятельности.`,
      ],
      developmental: [
        `Развивать творческие способности и мелкую / крупную моторику.`,
        `Развивать эстетический вкус и физические качества.`,
      ],
      nurturing: [`Воспитывать трудолюбие, дисциплину и умение работать в команде.`],
    },
    default: {
      educational: [
        `Сформировать представление о теме «${topicTitle}».`,
        `Научить применять полученные знания на практике.`,
      ],
      developmental: [`Развивать внимание, память и логическое мышление.`],
      nurturing: [`Воспитывать интерес к предмету и стремление к самостоятельному познанию.`],
    },
  };
  return goals[family];
}

/**
 * Оборудование (1–3 строки) по семейству. Подстроено под реальные условия школы:
 * для языков — без ПК по умолчанию, для естественных наук — с раздаткой и картами.
 */
function equipmentFor(family: Family): string[] {
  const eq: Record<Family, string[]> = {
    math: ["Учебник (тетрадь теории)", "Тетрадь для решения", "Доска / маркер"],
    language: ["Учебник", "Тетрадь", "Раздаточный материал (карточки с заданиями)"],
    science: ["Учебник", "Тетрадь для лабораторных / опытов", "Карты, схемы или раздаточный материал"],
    society: ["Учебник", "Контурные карты / таблицы", "Тетрадь для записей"],
    arts: ["Учебник / ноты / инвентарь", "Тетрадь / альбом", "Доска или экран"],
    default: ["Учебник", "Тетрадь", "Доска"],
  };
  return eq[family];
}

/**
 * Шаги урока по ФГОС-конспекту: 6 стадий, в сумме ровно 45 мин.
 * Учитываем семейство предмета: в языках акцент на чтение/говорение,
 * в естественных науках — на наблюдение и опыт, в общественных — на источники.
 */
function stagesFor(family: Family, ctx: Ctx): LessonStage[] {
  const topic = ctx.topicTitle;
  const ex = ctx.exampleHint ? ` Разобрать у доски: «${ctx.exampleHint}».` : "";
  const eqShort = equipmentFor(family).slice(0, 2).join(", ");

  // Тексты «учитель / ученик» пишем по-деловому, без воды.
  // Каждая стадия имеет 1–2 предложения в каждой колонке — этого достаточно
  // для teacherActions/studentActions (Markdown-like).
  const stageData: LessonStage[] = [
    {
      kind: "org-moment",
      title: "Организационный момент",
      durationMin: 3,
      teacherActions:
        `Приветствует класс, проверяет готовность к уроку, отмечает отсутствующих. ` +
        `Кратко объявляет тему «${topic}» и план работы на урок.`,
      studentActions:
        "Приветствуют учителя, готовят рабочие места, записывают дату и тему урока в тетрадь.",
      materials: eqShort ? [eqShort] : undefined,
    },
    {
      kind: "motivation",
      title: "Мотивация и актуализация знаний",
      durationMin: 5,
      teacherActions:
        family === "science"
          ? `Задаёт 2–3 вопроса по предыдущей теме, приводит бытовой пример из жизни.${ex} Подводит учеников к теме «${topic}».`
          : family === "language"
            ? `Читает короткий отрывок / показывает мини-диалог, задаёт вопрос «Что объединяет эти примеры?».${ex} Подводит к теме «${topic}».`
            : family === "society"
              ? `Показывает иллюстрацию или документ эпохи, задаёт вопрос «Что мы можем о нём узнать?». Подводит к теме «${topic}».`
              : `Задаёт 2–3 вопроса по предыдущей теме, приводит краткий пример из практики.${ex} Подводит к теме «${topic}».`,
      studentActions:
        "Отвечают на вопросы, вспоминают ранее изученный материал, формулируют свои ожидания от урока.",
    },
    {
      kind: "new-topic",
      title: "Изучение нового материала",
      durationMin: 15,
      teacherActions:
        family === "language"
          ? `Объясняет правило / явление на примере 2–3 предложений из учебника. Делает записи на доске, проговаривает термины.${ex}`
          : family === "science"
            ? `Объясняет тему «${topic}» с опорой на схему / опыт. Демонстрирует ${ctx.exampleHint ?? "учебный пример"}, задаёт вопросы для проверки понимания.`
            : `Объясняет тему «${topic}» с опорой на схемы и примеры из учебника. Выделяет ключевые понятия, формулы (если есть).${ex}`,
      studentActions:
        "Слушают учителя, записывают определения и формулы в тетрадь, задают уточняющие вопросы, приводят собственные примеры.",
      materials: eqShort ? [eqShort] : undefined,
    },
    {
      kind: "practice",
      title: "Закрепление. Отработка умений",
      durationMin: 15,
      teacherActions:
        `Организует работу: 3–5 минут — совместное решение у доски, ` +
        `остальное время — самостоятельная работа по вариантам / парам. ` +
        `Проходит по классу, помогает, корректирует ошибки.`,
      studentActions:
        "Решают задания у доски и в тетради, работают в парах, сверяют ответы, задают вопросы при затруднениях.",
    },
    {
      kind: "reflex",
      title: "Рефлексия. Подведение итогов",
      durationMin: 5,
      teacherActions:
        `Задаёт классу вопросы: «Что нового узнали? Что было самым сложным? Где пригодится?». ` +
        `Оценивает работу класса, выставляет отметки за активность.`,
      studentActions:
        "Формулируют выводы одним-двумя предложениями, оценивают свою работу на уроке, задают оставшиеся вопросы.",
    },
    {
      kind: "homework",
      title: "Домашнее задание",
      durationMin: 2,
      teacherActions: `Объясняет содержание и объём домашнего задания, проверяет записи в дневниках, отвечает на вопросы.`,
      studentActions: "Записывают задание в дневник, задают уточняющие вопросы.",
    },
  ];

  // Контроль длительности: сумма должна быть ≈ 45 мин (± 2 мин).
  // Шаблон гарантирует 45 мин, но защитимся от изменений в будущем.
  const totalMin = stageData.reduce((s, st) => s + st.durationMin, 0);
  if (Math.abs(totalMin - 45) > 2) {
    const newTopic = stageData.find((s) => s.kind === "new-topic");
    const practice = stageData.find((s) => s.kind === "practice");
    if (newTopic && practice) {
      const delta = 45 - totalMin;
      newTopic.durationMin += Math.round(delta / 2);
      practice.durationMin += delta - Math.round(delta / 2);
    }
  }

  return stageData;
}

/**
 * ДЗ: основной текст + 1–2 альтернативы (для дифференциации по уровню).
 * Формулировки общие для школы — конкретные номера из учебника LLM-слой добавит позже.
 */
function homeworkFor(family: Family, topicTitle: string): LessonPlan["homework"] {
  const text =
    family === "language"
      ? `Прочитать теоретический материал по теме «${topicTitle}», выполнить письменное задание из учебника (базовый уровень).`
      : family === "math"
        ? `Прочитать теоретический материал по теме «${topicTitle}», выполнить 3–5 заданий из учебника (базовый уровень). Разобрать решение по образцу учителя.`
        : family === "science"
          ? `Прочитать § по теме «${topicTitle}», выписать ключевые термины и формулы, выполнить 2–3 тренировочных задания.`
          : `Прочитать материал по теме «${topicTitle}» в учебнике, выполнить письменное задание (базовый уровень).`;

  const alternatives: string[] =
    family === "math"
      ? [
          `Составить 3 собственных примера по теме «${topicTitle}» с полным решением.`,
          `Подобрать 1 задачу из открытого банка ОГЭ / ЕГЭ по теме (по желанию).`,
        ]
      : family === "language"
        ? [
            `Подготовить устное высказывание (5–7 предложений) на тему «${topicTitle}».`,
            `Найти и выписать 3 примера из художественного текста.`,
          ]
        : [
            `Составить краткий конспект-таблицу по теме «${topicTitle}».`,
            `Подготовить короткое сообщение (2–3 минуты) на урок.`,
          ];

  return { text, alternatives };
}

export async function generateLessonPlan(req: GenerationRequest): Promise<LessonPlan> {
  const start = Date.now();
  const topic = getTopic(req.subject, req.grade, req.topic);
  const family = familyOf(req.subject);
  const ctx: Ctx = buildCtx(req);

  const stages = stagesFor(family, ctx);

  return {
    id: shortId(),
    title: `План урока · ${topic?.title ?? req.topic}`,
    subject: req.subject,
    grade: req.grade,
    topic: topic?.slug ?? req.topic,
    fgosRef: topic?.fgosRef,
    goals: goalsFor(family, ctx.topicTitle),
    equipment: equipmentFor(family),
    stages,
    homework: homeworkFor(family, ctx.topicTitle),
    createdAt: new Date().toISOString(),
    generationMs: Date.now() - start,
  };
}