/**
 * Общие типы слоя данных личного кабинета (ТЗ-21, блоки 1 и 3).
 *
 * Вынесены отдельно от `materials-api.ts` и `materials-source.ts`, потому что
 * их читает вёрстка кабинета, и карточкам нужно одно поле — сколько единиц
 * содержания в материале, — независимо от того, серверная это карточка или
 * локальная.
 */

/** Откуда пришли данные вкладки. */
export type HistorySource = "server" | "device";

/** Ровно четыре состояния вкладки. Белого экрана не бывает ни в одном. */
export type LoadState<T> =
  | { kind: "loading" }
  /** Сервер не ответил и показать нечего — зовём повторить. */
  | { kind: "unavailable" }
  /** Данных нет — зовём создать первое. */
  | { kind: "empty" }
  | { kind: "data"; items: T[]; degraded: boolean };

/**
 * Тип материала в терминах учителя.
 *
 * Раньше карточка различала материалы только эмодзи предмета, поэтому два
 * листа по математике выглядели одинаково. Теперь тип — текстом, и по нему
 * же работает фильтр.
 */
export type MaterialKind =
  | "worksheet"
  | "lesson-plan"
  | "presentation"
  | "ktp"
  | "cards"
  | "test"
  | "control"
  | "exam"
  | "materials"
  | "lesson-bundle"
  | "other";

/** Единая модель карточки истории для вёрстки, поиска и фильтров. */
export interface HistoryItem {
  id: string;
  title: string;
  subject: string;
  grade: number | null;
  createdAt: string;
  /** `type` как в истории: TaskType либо "exam". */
  type: string;
  /** Заданий / этапов / слайдов / недель. null = размер неизвестен. */
  count: number | null;
  /** Тема — по ней работает поиск. Заполняется, когда артефакт под рукой. */
  topic: string | null;
  isFavorite: boolean;
  source: HistorySource;
}

/** Человеческие названия типов материалов — для карточки и фильтра. */
export const MATERIAL_KIND_LABEL: Record<MaterialKind, string> = {
  worksheet: "Рабочий лист",
  test: "Тест",
  control: "Контрольная",
  cards: "Карточки",
  "lesson-plan": "План урока",
  presentation: "Презентация",
  ktp: "КТП",
  exam: "Вариант экзамена",
  materials: "Материалы",
  "lesson-bundle": "Урок целиком",
  other: "Материал",
};

/** Порядок типов в фильтре — от самого частого к самому редкому. */
export const MATERIAL_KIND_ORDER: MaterialKind[] = [
  "worksheet",
  "lesson-plan",
  "presentation",
  "ktp",
  "test",
  "control",
  "cards",
  "exam",
  "materials",
  "lesson-bundle",
];

/** Приводит `type` из истории к типу материала для фильтра. */
export function materialKindOf(type: string): MaterialKind {
  switch (type) {
    case "worksheet":
      return "worksheet";
    case "lesson-plan":
      return "lesson-plan";
    case "presentation":
      return "presentation";
    case "ktp":
      return "ktp";
    case "cards":
      return "cards";
    case "test":
      return "test";
    case "control":
      return "control";
    case "exam":
    case "oge":
    case "ege":
      return "exam";
    case "materials":
      return "materials";
    case "lesson-bundle":
      return "lesson-bundle";
    default:
      return "other";
  }
}

/** Заголовок группы дат: Сегодня / Вчера / Эта неделя / Октябрь / Раньше. */
export interface DateGroup {
  label: string;
  items: HistoryItem[];
}
