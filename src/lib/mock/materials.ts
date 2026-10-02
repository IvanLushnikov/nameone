/**
 * TZ-16 §3.2: мок-генератор «Материалов» — комплект доп. файлов к теме.
 *
 * Контракт: GenerationRequest (type === "materials") → MaterialBundle.
 * Экспорт в ZIP собирает `src/lib/utils/materials-zip.ts`.
 *
 * Правила (жёсткие, из ТЗ):
 *   1. По умолчанию ровно 3 файла:
 *      glossary  (docx) — 8–15 терминов,
 *      reference (csv)  — таблица / формулы / даты,
 *      handout  (docx)  — памятка на 1 страницу.
 *   2. checklist (txt) НЕ генерируется: только при явном выборе учителя,
 *      в моке это всегда пусто (заглушка под будущую LLM-логику).
 *   3. Форматы жёсткие: glossary→docx, reference→csv, handout→docx,
 *      checklist→txt. Не меняются.
 *
 * Термины берутся из `topic.examples` и из семейства предмета — никакого
 * случайного текста: учитель должен получить осмысленный комплект к уроку.
 *
 * Edge case: тема не нашлась в таксономии → `files: []` и осмысленный title.
 * Не падаем (UX конструктора не должен ломаться на неизвестном slug'е).
 */
import type {
  GenerationRequest,
  MaterialBundle,
  MaterialFile,
  SubjectSlug,
  TopicExample,
} from "@/lib/types";
import { getSubject, getTopic } from "@/lib/content/subjects";
import { shortId } from "@/lib/utils/cn";

/** Семейство предмета — тот же разбор, что в mock/lesson-plan.ts. */
type Family = "math" | "language" | "science" | "society" | "arts" | "default";

function familyOf(slug: SubjectSlug): Family {
  if (slug === "math" || slug === "algebra" || slug === "geometry" || slug === "informatics") return "math";
  if (slug === "russian" || slug === "literature" || slug === "english" || slug === "german") return "language";
  if (slug === "physics" || slug === "chemistry" || slug === "biology" || slug === "geography") return "science";
  if (slug === "history" || slug === "social" || slug === "obzh" || slug === "okruzhaet") return "society";
  if (slug === "art" || slug === "music" || slug === "technology" || slug === "pe" || slug === "finance") return "arts";
  return "default";
}

/** Чистим ячейку таблицы: `;` — разделитель CSV, кавычки и переносы ломают строку. */
function cell(raw: string): string {
  return raw
    .replace(/&nbsp;/g, " ")
    .replace(/["\n\r]+/g, " ")
    .replace(/;/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}

/** Собирает CSV-подобный контент: первая строка — шапка, дальше строки-строки таблицы. */
function tableContent(rows: string[][]): string {
  return rows.map((r) => r.map(cell).join(";")).join("\n");
}

interface Ctx {
  shortTitle: string;
  grade: number;
  topicTitle: string;
  examples: TopicExample[];
}

/**
 * Термины-словарь по семейству предмета. Определения подставляют тему,
 * поэтому словарь остаётся осмысленным для любой темы внутри предмета.
 * 6 терминов + 2–4 примера из темы = 8–10 записей (ТЗ: 8–15).
 */
function glossaryTerms(family: Family, topicTitle: string): string[] {
  const base: Record<Family, string[]> = {
    math: [
      `Основное понятие темы «${topicTitle}» — ключевая идея, вокруг которой строятся все задания.`,
      "Условие задачи — то, что дано в условии; выделяем его до начала вычислений.",
      "Искомое — величина, которую нужно найти; её записываем последней строкой.",
      "Алгоритм решения — фиксированный порядок действий, который повторяется от задачи к задаче.",
      "Проверка результата — прикидка или подстановка ответа обратно в условие.",
      "Типичная ошибка — спешка на первом шаге; сначала читаем условие целиком.",
    ],
    language: [
      `Основное понятие темы «${topicTitle}» — то, что нужно знать и уметь применять.`,
      "Теория — правило или определение, которое применяем к тексту.",
      "Признак — часть правила, по которой мы узнаём явление в тексте.",
      "Разбор — шаг за шагом объясняем, почему признак сработал.",
      "Ошибка — несоответствие правилу; ищем место, где правило нарушено.",
      "Практика — 3–4 своих примера, чтобы правило закрепилось.",
    ],
    science: [
      `Основное понятие темы «${topicTitle}» — то, что описывает изучаемый объект или процесс.`,
      "Объект изучения — то, на что смотрим: вещество, организм, явление.",
      "Признак — измеримое свойство объекта, по нему мы его узнаём.",
      "Единица измерения — обозначение величины, обязательное в расчёте.",
      "Связь — как одно понятие связано с другими по теме.",
      "Наблюдение — описание того, что видно; вывод — что из этого следует.",
    ],
    society: [
      `Основное понятие темы «${topicTitle}» — главная идея, вокруг неё строится материал.`,
      "Дата и период — хронологическая рамка, без неё событие теряет смысл.",
      "Причина и следствие — связка, которая объясняет само событие.",
      "Источник — документ или свидетельство, на которое опираемся.",
      "Оценка — вывод о значении события, а не пересказ.",
      "Хронология — порядок событий, его полезно восстановить устно.",
    ],
    arts: [
      `Основное понятие темы «${topicTitle}» — то, что задаёт правило работы над материалом.`,
      "Этап работы — шаг, который выполняем по порядку.",
      "Инструмент и материал — чем работаем на этом этапе.",
      "Критерий — по чему оцениваем результат.",
      "Приём — повторяющийся способ выполнения задачи.",
      "Анализ работы — разбор по этапам, а не оценка «на глаз».",
    ],
    default: [
      `Основное понятие темы «${topicTitle}» — то, что ученик должен усвоить на уроке.`,
      "Понятие — термин, который объясняем на уроке.",
      "Признак — по чему понятие узнаётся в задании или тексте.",
      "Разбор — пошаговое объяснение на конкретном примере.",
      "Ошибка — типичное затруднение, на которое стоит обратить внимание.",
      "Проверка — признак того, что тема понята.",
    ],
  };
  return base[family];
}

/** Записи-словарь, собранные из примеров темы («задание → ответ»). */
function exampleEntries(examples: TopicExample[]): string[] {
  return examples
    .slice(0, 4)
    .map((ex) => {
      const text = ex.text.replace(/__/g, "…").replace(/\s+/g, " ").trim();
      const answer = ex.answer ? ` → ${ex.answer.replace(/\s+/g, " ").trim()}` : "";
      const hint = ex.hint ? ` (${ex.hint.replace(/\s+/g, " ").trim()})` : "";
      return `Пример из темы: ${text}${answer}${hint}`;
    });
}

/** Справочные данные (CSV): по семейству — своя шапка и свои строки. */
function referenceRows(family: Family, topicTitle: string, examples: TopicExample[]): string[][] {
  const sample = (i: number): string => {
    const ex = examples[i % Math.max(1, examples.length)];
    if (!ex) return "—";
    return `${ex.text.replace(/__/g, "…").replace(/\s+/g, " ").trim()}${ex.answer ? ` → ${ex.answer}` : ""}`;
  };

  const rows: Record<Family, string[][]> = {
    math: [
      ["Что делаем", "Правило / формула", "Пример по теме"],
      [`Решение задач по теме «${topicTitle}»`, "выделить данные → выполнить алгоритм → прикидка", sample(0)],
      ["Сокращение записи", "убрать лишние пробелы и сократить дробь, если можно", sample(1)],
      ["Проверка ответа", "подставить результат обратно в условие", sample(2)],
      ["Работа над ошибкой", "записать, на каком шаге возникла ошибка", sample(3)],
      ["Типовые обозначения", "записывать в тетради теми же знаками, что на доске", "—"],
    ],
    language: [
      ["Термин", "Правило", "Пример по теме"],
      [`Ключевое понятие темы «${topicTitle}»`, "прочитать правило и найти признак в тексте", sample(0)],
      ["Разбор предложения", "что известно → что требуется → как связаны части", sample(1)],
      ["Проверка", "найти в тексте все случаи по теме и выписать их", sample(2)],
      ["Типичная ошибка", "потерять признак при переносе в новое предложение", "—"],
      ["Домашняя заготовка", "3 своих примера по теме с пояснением", "—"],
    ],
    science: [
      ["Понятие", "Обозначение / единица", "Пример по теме"],
      [`Основное понятие темы «${topicTitle}»`, "указать обозначение и единицу измерения", sample(0)],
      ["Величина и признак", "что измеряем и в каких единицах", sample(1)],
      ["Связь понятий", "по схеме: исходное → промежуточное → итоговое", sample(2)],
      ["Наблюдение и вывод", "сначала описываем факты, потом делаем вывод", "—"],
      ["Запись в тетради", "таблица: понятие — признак — единица", "—"],
    ],
    society: [
      ["Дата / период", "Событие", "Значение"],
      [`Хронологическая рамка темы «${topicTitle}»`, "первое упоминание периода в курсе", "—"],
      [`Основные события темы «${topicTitle}»`, "что считать главным при пересказе", sample(0)],
      ["Причина и следствие", "назвать оба, иначе пересказ неполный", sample(1)],
      ["Работа с источником", "прочитать → выписать факт → сделать вывод", sample(2)],
      ["Итог периода", "что изменилось по сравнению с началом", "—"],
    ],
    arts: [
      ["Этап работы", "Что делать", "Критерий"],
      [`Работа по теме «${topicTitle}»`, "разобрать задачу и составить план из 3 шагов", sample(0)],
      ["Подготовка материала", "выбрать инструмент и подготовить основу", sample(1)],
      ["Выполнение", "идти по этапам, не перескакивая", sample(2)],
      ["Анализ работы", "разобрать по этапам: что получилось, что нет", "—"],
      ["Доработка", "исправить слабое место по критерию", "—"],
    ],
    default: [
      ["Пункт", "Значение", "Пример по теме"],
      [`Основное понятие темы «${topicTitle}»`, "определить и записать в тетрадь", sample(0)],
      ["Как применять", "разобрать один пример полностью", sample(1)],
      ["Типичная ошибка", "записать, где чаще всего ошибаются", sample(2)],
      ["Проверка себя", "проговорить правило своими словами", "—"],
      ["Домашняя заготовка", "3 своих примера по теме", "—"],
    ],
  };
  return rows[family];
}

/** Раздатка (docx) — памятка на одну страницу для ученика. */
function handoutContent(ctx: Ctx): string {
  const ex = ctx.examples;
  const q = (i: number, fallback: string): string => {
    const e = ex[i];
    if (!e) return fallback;
    return e.text.replace(/__/g, "…").replace(/\s+/g, " ").trim();
  };

  return [
    `Памятка к теме «${ctx.topicTitle}»`,
    `${ctx.shortTitle} · ${ctx.grade} класс · рабочий лист ученика`,
    "",
    "Как работать с темой",
    `— 1. Прочитай правило по теме «${ctx.topicTitle}» и выпиши его в тетрадь одной фразой.`,
    "— 2. Найди в правиле признак — по чему узнаёшь это явление или понятие.",
    "— 3. Разбери один пример вместе с учителем: данные → шаг → ответ.",
    "— 4. Сделай два таких же сам, сверь с образцом.",
    "— 5. Ошибку не зачёркивай — запиши, на каком шаге она возникла.",
    "",
    "Опорные примеры",
    `— ${q(0, "Разбери пример, разобранный на уроке.")}`,
    ...(ex[1] ? [`— ${q(1, "")}`] : []),
    "",
    "Проверь себя",
    `— ${q(ex.length - 1 || 0, "Сформулируй главное правило темы одним предложением.")}`,
    "— Объясни своими словами, зачем это правило нужно.",
    "— Назови признак, по которому тему узнают в задании.",
    "",
    "Если затрудняешься",
    "— Вернись к правилу и выпиши его ещё раз.",
    "— Сравни свой шаг с образцом — найди, где разошлись.",
    "— Спроси учителя на ближайшем уроке, а не перед контрольной.",
    "",
    `Тема: ${ctx.topicTitle} · предмет: ${ctx.shortTitle} · ${ctx.grade} класс`,
  ].join("\n");
}

/** Собираем один MaterialFile. */
function makeFile(kind: MaterialFile["kind"], title: string, content: string, format: MaterialFile["format"]): MaterialFile {
  return { id: shortId(), kind, title, content, format };
}

export async function mockMaterials(request: GenerationRequest): Promise<MaterialBundle> {
  const start = Date.now();

  const subject = getSubject(request.subject);
  const topic = getTopic(request.subject, request.grade, request.topic);

  const shortTitle = subject?.shortTitle ?? request.subject;
  const topicTitle = topic?.title ?? request.topic;

  // Тема не найдена — не падаем, но и выдумывать комплект не из чего:
  // возвращаем пустой список файлов с осмысленным заголовком.
  if (!topic) {
    return {
      id: shortId(),
      title: `Материалы · ${shortTitle}, ${request.grade} класс · ${topicTitle}`,
      subject: request.subject,
      grade: request.grade,
      topic: request.topic,
      files: [],
      createdAt: new Date().toISOString(),
      generationMs: Date.now() - start,
    };
  }

  const family = familyOf(request.subject);
  const ctx: Ctx = {
    shortTitle,
    grade: request.grade,
    topicTitle,
    examples: topic.examples,
  };

  const glossaryLines = [
    `Словарь терминов · ${topicTitle}`,
    `${shortTitle} · ${request.grade} класс · ${glossaryTerms(family, topicTitle).length + exampleEntries(topic.examples).length} записей`,
    "",
    ...glossaryTerms(family, topicTitle),
    "",
    "Примеры по теме",
    ...exampleEntries(topic.examples),
  ];

  const files: MaterialFile[] = [
    makeFile("glossary", `Словарь терминов · ${topicTitle}`, glossaryLines.join("\n"), "docx"),
    makeFile(
      "reference",
      `Справочные данные · ${topicTitle}`,
      tableContent(referenceRows(family, topicTitle, topic.examples)),
      "csv"
    ),
    makeFile("handout", `Раздатка · ${topicTitle}`, handoutContent(ctx), "docx"),
  ];

  // checklist намеренно не генерируется: только при явном выборе учителя,
  // а мок — заглушка под будущую LLM-логику (ТЗ-16 §3.2, п. 2).

  return {
    id: shortId(),
    title: `Материалы · ${shortTitle}, ${request.grade} класс · ${topicTitle}`,
    subject: request.subject,
    grade: request.grade,
    topic: topic.slug,
    files,
    createdAt: new Date().toISOString(),
    generationMs: Date.now() - start,
  };
}
