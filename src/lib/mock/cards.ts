/**
 * TZ-16 §3.1: мок-генератор карточек (пары «лицевая / оборотная сторона»).
 *
 * Образец стиля — `src/lib/mock/lesson-plan.ts`: тот же способ доставать
 * предмет и тему из таксономии (`getSubject` / `getTopic`), тот же `shortId()`
 * и тот же замер `generationMs`.
 *
 * Правила сборки (по ТЗ):
 *   1. Первая треть карточек — из `topic.examples`:
 *      `front = example.text`, `back = example.answer` (fallback — `hint`).
 *   2. Остальные — по шаблонам предмета:
 *      russian — «корень слова X», history — «дата — событие»,
 *      english / german — «слово — перевод», остальные — нейтральный
 *      шаблон по теме.
 *   3. Жёсткие ограничения длины: `front.length ≤ 80`, `back.length ≤ 120`.
 *      Обрезаем строго по границе слова — карточка с длинным текстом
 *      не влезает в сетку 2×N и ломает экспорт (DOCX / печать).
 *   4. Тема не найдена — НЕ исключение: возвращаем `cards: []`,
 *      а `title` собираем со fallback'ом на слаг из запроса.
 */
import type {
  CardSet,
  FlashCard,
  GenerationRequest,
  SubjectSlug,
  Topic,
  TopicExample,
} from "@/lib/types";
import { getTopic } from "@/lib/content/subjects";
import { shortId } from "@/lib/utils/cn";

/** Лимит лицевой стороны (символов). Жёсткий — от него зависит вёрстка. */
export const MAX_FRONT_LEN = 80;
/** Лимит оборотной стороны (символов). */
export const MAX_BACK_LEN = 120;
/** Диапазон количества карточек по ТЗ. */
export const MIN_CARDS = 8;
export const MAX_CARDS = 40;

// ─────────────────────────── Банки шаблонов ───────────────────────────

/** Русский язык: слово → корень (+ родственные слова). */
const RUSSIAN_ROOTS: Array<{ word: string; root: string; family: string }> = [
  { word: "вода", root: "вод", family: "вода, водяной, наводнение" },
  { word: "земля", root: "земл", family: "земля, землемер, подземелье" },
  { word: "лёт", root: "лет", family: "лёт, летать, полёт, летающий" },
  { word: "сад", root: "сад", family: "сад, садовый, посадка, разсадник" },
  { word: "город", root: "гор", family: "город, горец, пригород, горевать" },
  { word: "свет", root: "свет", family: "свет, светлый, осветить, светильник" },
  { word: "нос", root: "нос", family: "нос, носатый, носилка, занос" },
  { word: "друг", root: "друж", family: "друг, дружба, дружить, дружок" },
  { word: "хлеб", root: "хлеб", family: "хлеб, хлебница, хлебопёк" },
  { word: "ветер", root: "ветр", family: "ветер, ветреный, ветроволк, ветка" },
  { word: "зима", root: "зим", family: "зима, зимний, назима, зимовье" },
  { word: "сила", root: "сил", family: "сила, сильный, усилие, силовой" },
  { word: "дом", root: "дом", family: "дом, домашний, домовой, домострой" },
  { word: "море", root: "мор", family: "море, морской, поморок, приморье" },
  { word: "гора", root: "гор", family: "гора, горный, горевать, пригорок" },
  { word: "правда", root: "правд", family: "правда, правдивый, оправдать" },
];

/** История: дата → событие. */
const HISTORY_DATES: Array<{ year: string; event: string }> = [
  { year: "862", event: "Призвание варягов, начало Древнерусского государства" },
  { year: "988", event: "Крещение Руси князем Владимиром" },
  { year: "1223", event: "Ледовое побоище на Чудском озере" },
  { year: "1325", event: "Иван I Калита — первый великий князь" },
  { year: "1480", event: "Стояние на реке Угре, конец ордынского ига" },
  { year: "1612", event: "Освобождение Москвы, Соборное согласие" },
  { year: "1703", event: "Основание Санкт-Петербурга" },
  { year: "1812", event: "Отечественная война, Бородинское сражение" },
  { year: "1861", event: "Отмена крепостного права" },
  { year: "1917", event: "Революция, отречение Николая II" },
  { year: "1922", event: "Образование СССР" },
  { year: "1945", event: "Капитуляция Германии, День Победы" },
];

/** Иностранные языки: слово → перевод. */
const FOREIGN_WORDS: Array<{ word: string; translate: string }> = [
  { word: "the apple", translate: "яблоко" },
  { word: "school", translate: "школа" },
  { word: "friend", translate: "друг, подруга" },
  { word: "to read", translate: "читать" },
  { word: "to write", translate: "писать" },
  { word: "the question", translate: "вопрос" },
  { word: "the answer", translate: "ответ" },
  { word: "the city", translate: "город" },
  { word: "water", translate: "вода" },
  { word: "the book", translate: "книга" },
  { word: "morning", translate: "утро" },
  { word: "the family", translate: "семья" },
  { word: "beautiful", translate: "красивый" },
  { word: "quickly", translate: "быстро" },
  { word: "together", translate: "вместе" },
  { word: "the lesson", translate: "урок" },
];

/** Нейтральный банк для предметов без спецшаблона — вопросы по теме. */
const NEUTRAL_TEMPLATES: Array<{ front: string; back: string }> = [
  {
    front: "Ключевое понятие темы",
    back: "Выпишите 3 ключевых слова темы и дайте каждому короткое определение",
  },
  {
    front: "Определение своими словами",
    back: "Объясните тему без опоры на учебник — так проверится, что вы её поняли",
  },
  {
    front: "Признак, по которому различают",
    back: "Назовите 2–3 признака, по которым понятия темы отличаются друг от друга",
  },
  {
    front: "Свой пример по теме",
    back: "Приведите пример, которого нет в учебнике, и объясните его решение",
  },
  {
    front: "Типичная ошибка",
    back: "Какую ошибку чаще всего допускают в этой теме — и как её избежать",
  },
  {
    front: "Где это применяется",
    back: "Назовите задачу или жизненную ситуацию, где нужны знания темы",
  },
  {
    front: "Связь с прошлой темой",
    back: "Что из нового повторяет прошлую тему, а что добавляет принципиально нового",
  },
  {
    front: "Порядок действий",
    back: "В какой последовательности выполняются действия в этой теме и почему",
  },
  {
    front: "Мини-словарик",
    back: "Составьте словарик: термин → определение, минимум 5 терминов",
  },
  {
    front: "Вопрос для самопроверки",
    back: "Придумайте один вопрос по теме и запишите к нему ответ",
  },
  {
    front: "Правило или формула",
    back: "Запишите правило темы своими словами и приведите пример применения",
  },
  {
    front: "Что вызывает затруднение",
    back: "Отметьте, что осталось непонятным — с этим идём к учителю на следующем уроке",
  },
];

/** Варианты формулировки ответа для русских корней — чтобы карточки не были копиями. */
const ROOT_BACK_VARIANTS: string[] = [
  "Найдите в учебнике ещё 2 слова с этим корнем",
  "Какие ещё слова с этим корнем вы знаете?",
  "Подберите проверочное слово и вставьте пропущенную букву",
];

// ─────────────────────────── Утилиты ───────────────────────────

/** Количество карточек: `req.count` зажат в диапазон ТЗ 8–40. */
function clampCount(count: number): number {
  if (!Number.isFinite(count)) return 10;
  return Math.min(MAX_CARDS, Math.max(MIN_CARDS, Math.round(count)));
}

/**
 * Обрезка по границе слова. Длинный текст не режем — ставим многоточие.
 * Результат гарантированно ≤ `max` символов.
 */
export function clipCardText(text: string, max: number): string {
  const value = text.replace(/\s+/g, " ").trim();
  if (value.length <= max) return value;

  // Один символ резервируем под «…», дальше режем по последнему пробелу.
  const hardCut = value.slice(0, max - 1);
  const lastSpace = hardCut.lastIndexOf(" ");
  const raw = lastSpace > 0 ? hardCut.slice(0, lastSpace) : hardCut;
  const base = raw.replace(/[\s.,;:!?—–-]+$/, "");
  return `${base || hardCut}…`;
}

/** Приводит карточку к лимитам длины и заполняет пустую оборотную сторону. */
function normalizeCard(card: FlashCard): FlashCard {
  const back = card.back?.trim();
  return {
    front: clipCardText(card.front ?? "", MAX_FRONT_LEN),
    back: clipCardText(
      back && back.length > 0 ? back : "Ответ — по учебнику / конспекту учителя",
      MAX_BACK_LEN
    ),
    ...(card.category ? { category: card.category } : {}),
    ...(card.hint ? { hint: clipCardText(card.hint, MAX_FRONT_LEN) } : {}),
  };
}

/** Категория для группировки на листе — по семейству предмета. */
function categoryFor(subject: SubjectSlug): string {
  if (subject === "russian" || subject === "literature") return "Словарь";
  if (subject === "history" || subject === "social" || subject === "obzh") return "Даты";
  if (subject === "english" || subject === "german") return "Лексика";
  if (subject === "math" || subject === "algebra" || subject === "geometry") return "Формулы";
  if (subject === "physics" || subject === "chemistry" || subject === "biology") return "Термины";
  return "Термины";
}

/** Первая треть карточек — из примеров темы. */
function cardsFromExamples(
  examples: TopicExample[],
  take: number,
  category: string
): FlashCard[] {
  if (examples.length === 0) return [];
  const out: FlashCard[] = [];
  for (let i = 0; i < take; i++) {
    const ex = examples[i % examples.length];
    out.push({
      front: ex.text,
      back: ex.answer ?? ex.hint ?? "",
      category,
    });
  }
  return out;
}

/** Карточки по шаблону предмета. */
function cardsFromTemplates(
  subject: SubjectSlug,
  topicTitle: string,
  take: number
): FlashCard[] {
  if (take <= 0) return [];

  if (subject === "russian" || subject === "literature") {
    const category = categoryFor(subject);
    return Array.from({ length: take }, (_, i) => {
      const item = RUSSIAN_ROOTS[i % RUSSIAN_ROOTS.length];
      return {
        front: `Корень слова «${item.word}»`,
        back: `Корень «-${item.root}-». ${ROOT_BACK_VARIANTS[i % ROOT_BACK_VARIANTS.length]}. Родственные: ${item.family}.`,
        category,
      };
    });
  }

  if (subject === "history" || subject === "social" || subject === "obzh") {
    const category = categoryFor(subject);
    return Array.from({ length: take }, (_, i) => {
      const item = HISTORY_DATES[i % HISTORY_DATES.length];
      return {
        front: `${item.year} год — ?`,
        back: item.event,
        category,
      };
    });
  }

  if (subject === "english" || subject === "german") {
    const category = categoryFor(subject);
    return Array.from({ length: take }, (_, i) => {
      const item = FOREIGN_WORDS[i % FOREIGN_WORDS.length];
      return {
        front: item.word,
        back: `Перевод: ${item.translate}`,
        category,
      };
    });
  }

  // Остальные предметы — нейтральный шаблон по теме.
  const category = categoryFor(subject);
  return Array.from({ length: take }, (_, i) => {
    const tpl = NEUTRAL_TEMPLATES[i % NEUTRAL_TEMPLATES.length];
    return {
      front: `${tpl.front} — «${topicTitle}»`,
      back: tpl.back,
      category,
    };
  });
}

/**
 * Полный набор карточек по теме.
 * Возвращает `[]`, если тема не найдена в таксономии — падать нельзя (ТЗ §3.1 п.5).
 */
export function buildCards(
  topic: Topic | undefined,
  subject: SubjectSlug,
  topicTitle: string,
  count: number
): FlashCard[] {
  if (!topic) return [];

  const total = clampCount(count);
  const fromExamples = Math.max(1, Math.round(total / 3));
  const examples = topic.examples ?? [];

  const exampleCards = cardsFromExamples(
    examples,
    Math.min(fromExamples, total),
    categoryFor(subject)
  );

  const raw: FlashCard[] = [
    ...exampleCards,
    ...cardsFromTemplates(subject, topicTitle, total - exampleCards.length),
  ];

  // Обрезаем до ровно `total` карточек и прогоняем через нормализацию длины.
  return raw.slice(0, total).map(normalizeCard);
}

export async function mockCards(req: GenerationRequest): Promise<CardSet> {
  const start = Date.now();
  const topic = getTopic(req.subject, req.grade, req.topic);
  const topicTitle = topic?.title ?? req.topic;
  const topicSlug = topic?.slug ?? req.topic;

  const cards = buildCards(topic, req.subject, topicTitle, req.count);

  return {
    id: shortId(),
    title: `Карточки · ${topicTitle}`,
    subject: req.subject,
    grade: req.grade,
    topic: topicSlug,
    difficulty: req.difficulty,
    cards,
    createdAt: new Date().toISOString(),
    generationMs: Date.now() - start,
  };
}
