/**
 * Доменные типы продукта.
 */

export type SubjectSlug =
  | "math"
  | "algebra"
  | "geometry"
  | "russian"
  | "literature"
  | "english"
  | "german"
  | "informatics"
  | "physics"
  | "chemistry"
  | "biology"
  | "geography"
  | "history"
  | "social"
  | "okruzhaet"
  | "obzh"
  | "technology"
  | "finance"
  | "music"
  | "art"
  | "pe";

export type Difficulty = "easy" | "medium" | "hard";

export type TaskType =
  | "worksheet"   // рабочий лист
  | "test"        // тест с автопроверкой
  | "cards"       // карточки для запоминания (лицевая/оборотная сторона)
  | "control"     // контрольная (2 варианта)
  | "lesson-plan" // план урока (ФГОС-конспект на 45 мин)
  | "presentation"// презентация (PPTX, N слайдов)
  | "ktp"         // календарно-тематическое планирование (год)
  | "oge"         // вариант ОГЭ
  | "ege"         // вариант ЕГЭ
  // TZ-16: 4 новых типа. Объявлены в Этапе 1 (фундамент: типы + конструктор +
  // группировка в пикере), сами артефакты реализуются в Этапах 2–7.
  // ВАЖНО: "cards" НЕ дублируется — карточки переиспользуют существующее
  // значение TaskType, отдельного "cards-real" не вводим (TZ-16 §4.1).
  | "materials"     // комплект доп. файлов к теме (ZIP: словарь/справочник/раздатка)
  | "lesson-bundle" // урок целиком: 4 артефакта из одной темы одним нажатием
  | "interactive"   // форма для учеников (ссылка / standalone HTML)
  | "image";        // иллюстрация к заданию: плакат, схема, наглядное пособие

export interface TopicExample {
  text: string;
  answer?: string;
  hint?: string;
}

export interface Topic {
  slug: string;
  title: string;
  fgosRef?: string;
  examples: TopicExample[];
  /**
   * Список UMK-ID (из `umk.ts`), в которые входит эта тема.
   * - Не задан / пустой → тема общая для всех УМК этого предмета.
   * - Задан → показываем тему, только если выбранный УМК совпадает с одним из ID.
   *
   * F-09: раньше сегментер УМК не фильтровал — список тянул все темы
   * предмета независимо от учебника. Этим полем закрываем.
   */
  umk?: string[];
}

export interface Grade {
  num: number;
  title: string;
  topics: Topic[];
}

export interface Subject {
  slug: SubjectSlug;
  title: string;
  shortTitle: string;
  emoji: string;
  color: "brand" | "accent" | "warm" | "info";
  description: string;
  grades: Grade[];
}

export interface GenerationRequest {
  subject: SubjectSlug;
  grade: number;
  topic: string;
  difficulty: Difficulty;
  count: number;
  type: TaskType;
  withAnswers: boolean;
  withExplanations: boolean;
  /** Q1-2027: только для presentation — количество слайдов. */
  slideCount?: 5 | 10 | 15 | 20;
  /** Q1-2027: только для ktp — учебный год ("2026/2027"). */
  schoolYear?: string;
  /** Свободный контекст под будущие поля, не влияет на core-flow. */
  meta?: Record<string, unknown>;
}

export interface WorksheetTask {
  number: number;
  text: string;
  /**
   * LaTeX-версия задания для ОТРИСОВКИ, формулы в `$...$`.
   *
   * КЛЮЧЕВОЕ ПРАВИЛО: `text` остаётся источником правды для сверки ответов
   * (`self-verify.ts`) и для разбора формул — переписывать его в LaTeX
   * нельзя. `text_latex` нужен только чтобы показать дробь вертикально,
   * как её пишут в тетради. Поле опциональное: у старых ответов модели и у
   * таксономии его нет, тогда работает legacy-разбор `a/b`.
   */
  text_latex?: string | null;
  type: "computation" | "multiple-choice" | "short-answer" | "essay" | "fill-blank";
  options?: string[];
  answer?: string;
  explanation?: string;
  points: number;
  /**
   * F-05-B: результат self-verification от Worker-а.
   *   true  — AI подтвердил правильность ответа
   *   false — AI нашёл ошибку / не сошёлся с эталоном
   *   null  — не удалось проверить (Worker недоступен / таймаут)
   * Поле опционально: в существующем коде и типах остаётся совместимым.
   */
  verified?: boolean | null;
  /** F-05-B: объяснение проверки (от Worker-а). Отдельное от `explanation` (решение). */
  verifiedExplanation?: string;
}

export interface Worksheet {
  id: string;
  title: string;
  subject: string;
  grade: number;
  topic: string;
  difficulty: Difficulty;
  tasks: WorksheetTask[];
  createdAt: string;
  variant?: "A" | "B";
  /**
   * Optional SVG-chart specification (Phase 1 roadmap: docs/04-product-features-svg-graphs.md).
   * Тип приходит из `@/lib/llm/svg-renderer` после подключения LLM.
   * В мок-генераторе заполняется из `chart-fixtures.ts`.
   */
  chartSpec?: import("@/lib/llm/svg-renderer").ChartSpec;

  /**
   * Помечает артефакт как заготовку: сервис был недоступен, задания типовые.
   * Ставится в момент генерации и едет вместе с артефактом в избранное,
   * предпросмотр и ЛК. Нужна для водяного знака на печатном листе —
   * экранная плашка помечена `no-print` и на бумаге исчезает.
   * См. docs/tz/18-money-and-trust.md, блок Б.
   */
  isDemo?: boolean;
}

export interface ExamProblem {
  number: number;
  part: 1 | 2; // часть ОГЭ/ЕГЭ
  text: string;
  type: "short-answer" | "detailed" | "choice";
  options?: string[];
  answer: string;
  explanation: string;
  points: number;
}

export interface ExamVariant {
  id: string;
  exam: "oge" | "ege";
  subject: SubjectSlug;
  variantNumber: number;
  title: string;
  duration: number; // минуты
  problems: ExamProblem[];
}

export interface UserHistoryItem {
  id: string;
  type: TaskType | "exam";
  title: string;
  subject: SubjectSlug;
  grade?: number;
  createdAt: string;
  isFavorite: boolean;
  thumbnail?: string;
  /**
   * Полный артефакт (задания/этапы/слайды/недели) — чтобы лист не терялся
   * при перезагрузке страницы.
   *
   * Раньше история хранила только метаданные, поэтому refresh / pull-to-refresh
   * на iPad стирали результат генерации. Теперь 5 последних записей кладут
   * сюда весь артефакт (см. `addToHistory` в `utils/storage.ts`), остальные —
   * только метаданные, чтобы localStorage не раздувался.
   *
   * Поле опциональное: записи, сделанные до этого изменения, читаются как
   * есть, миграция не нужна.
   *
   * TZ-16 §3.1–3.4: сюда добавлены `CardSet`, `MaterialBundle` и `LessonBundle` —
   * иначе восстановление артефакта из истории (`artifactKindOf` в конструкторе)
   * не сможет отличить карточки/материалы/пакет от листа и тихо поставит `undefined`.
   */
  artifact?: Worksheet | LessonPlan | Presentation | Ktp | CardSet | MaterialBundle | LessonBundle;
}

export interface UserTemplate {
  id: string;
  name: string;
  subject: SubjectSlug;
  grade: number;
  topic: string;
  difficulty: Difficulty;
  count: number;
}

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  plan: "free" | "base" | "standard" | "plus";
  generationsTotal: number;
  generationsToday: number;
  generationsLimit: number;
  createdAt: string;
}

// =========================================================================
//  Q1-2027: 3 новых типа артефактов (worker A/B/C scope)
// =========================================================================

/** Шаг урока по ФГОС-конспекту. */
export type LessonStageKind =
  | "org-moment"     // организационный момент
  | "motivation"     // мотивация + актуализация
  | "new-topic"      // объяснение нового материала
  | "practice"       // отработка / закрепление
  | "reflex"         // рефлексия / подведение итогов
  | "homework";      // домашнее задание

export interface LessonStage {
  kind: LessonStageKind;
  title: string;
  /** Хронометраж в минутах (сумма всех стадий должна быть ~45 мин). */
  durationMin: number;
  /** Что делает учитель (Markdown-like, простой текст с переносами строк). */
  teacherActions: string;
  /** Что делают ученики. */
  studentActions: string;
  /** Используемые материалы / оборудование. */
  materials?: string[];
}

export interface LessonPlan {
  id: string;
  title: string;
  subject: SubjectSlug;
  grade: number;
  topic: string;
  /** Ссылка на раздел ФГОС, если есть (например «§ 27, п. 3»). */
  fgosRef?: string;
  /** Цели урока: обучающие / развивающие / воспитательные. */
  goals: { educational: string[]; developmental: string[]; nurturing: string[] };
  /** Оборудование / материалы к уроку. */
  equipment: string[];
  /** Шаги урока по 45 минут (в сумме ≈ 45 ± 2). */
  stages: LessonStage[];
  /** Текст домашнего задания с возможными вариантами. */
  homework: { text: string; alternatives?: string[] };
  createdAt: string;
  /** Время генерации в мс (для UI/аналитики). */
  generationMs?: number;
  /** Помечает артефакт как заготовку — см. `Worksheet.isDemo`. */
  isDemo?: boolean;
}

export type SlideKind = "title" | "bullets" | "definition" | "example" | "summary";

export interface Slide {
  kind: SlideKind;
  title: string;
  /** Пункты списка / содержимое (простой текст, без markdown). */
  bullets?: string[];
  /** Заметки спикера для режима докладчика (опционально). */
  notes?: string;
}

export interface Presentation {
  id: string;
  title: string;
  subject: SubjectSlug;
  grade: number;
  topic: string;
  /** Количество слайдов (5/10/15/20). */
  slideCount: 5 | 10 | 15 | 20;
  slides: Slide[];
  /** Тема оформления (одна из встроенных в pptxgenjs). */
  theme: "default" | "modern" | "school" | "minimal";
  createdAt: string;
  generationMs?: number;
  /** Помечает артефакт как заготовку — см. `Worksheet.isDemo`. */
  isDemo?: boolean;
}

/** Тип урока в КТП — урок / контрольная / повторение / резерв. */
export type KtpLessonKind = "lesson" | "control" | "test" | "review" | "reserve" | "project";

export interface KtpEntry {
  /** Порядковый номер урока в году (1..N). */
  num: number;
  /** Даты проведения (одна или две недели: «08.09–13.09»). */
  dates: string;
  /** Тема урока. */
  topic: string;
  /** Тип: урок / контрольная и т.д. */
  kind: KtpLessonKind;
  /** Количество часов (обычно 1, иногда 2 для повторения/проекта). */
  hours: 1 | 2;
  /** Ссылка на раздел ФГОС / параграф учебника. */
  fgosRef?: string;
  /** Планируемые результаты / УУД (опционально). */
  uud?: string[];
}

export interface Ktp {
  id: string;
  title: string;
  subject: SubjectSlug;
  grade: number;
  /** Учебный год, например «2026/2027». */
  schoolYear: string;
  /** Общее количество часов в году (обычно 68 или 102 для математики). */
  totalHours: number;
  weeks: Array<{ weekNum: number; entries: KtpEntry[] }>;
  createdAt: string;
  generationMs?: number;
  /** Помечает артефакт как заготовку — см. `Worksheet.isDemo`. */
  isDemo?: boolean;
}

// =========================================================================
//  TZ-16: типы для 5 новых артефактов (Этап 1 — только объявление типов).
//  Моки / превью / экспорт приходят в Этапах 2–7 (docs/tz/16-new-artifact-types.md).
// =========================================================================

/**
 * Карточка для запоминания: лицевая и оборотная стороны.
 * Ограничения длины (`front.length ≤ 80`, `back.length ≤ 120`) задаёт мок —
 * карточка с длинным текстом не влезает в сетку 2×N и ломает экспорт.
 */
export interface FlashCard {
  /** Лицевая сторона: вопрос / термин / дата. */
  front: string;
  /** Оборотная: ответ / определение / расшифровка. */
  back: string;
  /** Категория — для группировки на листе («Словарь», «Даты», «Формулы»). */
  category?: string;
  /** Картинка-подсказка на лицевой стороне (не генерируется в первом заходе). */
  hint?: string;
}

/** Набор карточек по одной теме. Артефакт типа `TaskType = "cards"`. */
export interface CardSet {
  id: string;
  title: string;
  subject: SubjectSlug;
  grade: number;
  topic: string;
  difficulty: Difficulty;
  cards: FlashCard[];
  createdAt: string;
  generationMs?: number;
  /** Помечает артефакт как заготовку — см. `Worksheet.isDemo`. */
  isDemo?: boolean;
}

/** Тип файла внутри комплекта материалов. */
export type MaterialFileKind =
  | "glossary"    // словарь терминов
  | "reference"   // справочные данные: таблицы, формулы, даты
  | "handout"     // раздатка для учеников (памятка, инструкция)
  | "checklist";  // чек-лист: что взять на урок / что повторить

export interface MaterialFile {
  id: string;
  kind: MaterialFileKind;
  title: string;
  /** Содержимое — простой текст с переносами строк, без markdown. */
  content: string;
  /** Формат файла внутри ZIP. */
  format: "txt" | "docx" | "csv";
}

/** Комплект доп. файлов к теме. Артефакт типа `TaskType = "materials"`. */
export interface MaterialBundle {
  id: string;
  title: string;
  subject: SubjectSlug;
  grade: number;
  topic: string;
  files: MaterialFile[];
  createdAt: string;
  generationMs?: number;
  /** Помечает артефакт как заготовку — см. `Worksheet.isDemo`. */
  isDemo?: boolean;
}

/** Слот в пакете «урок целиком» — 4 слота, заполняются частично. */
export type BundleSlot = "lesson-plan" | "presentation" | "worksheet" | "test";

/**
 * «Урок целиком» — 4 артефакта из одной темы одним нажатием.
 * Генерируются параллельно через `Promise.allSettled`, поэтому слоты
 * заполняются частично, а неудачные попадают в `failed` с причиной.
 */
export interface LessonBundle {
  id: string;
  /** Например «Урок целиком: Дроби, 5 класс». */
  title: string;
  subject: SubjectSlug;
  grade: number;
  topic: string;
  /** Что реально удалось сгенерировать — 4 слота, заполняются частично. */
  lessonPlan: LessonPlan | null;
  presentation: Presentation | null;
  worksheet: Worksheet | null;
  test: Worksheet | null;
  /** Слоты, которые не удалось — с причиной, для показа в UI. */
  failed: Array<{ slot: BundleSlot; reason: string }>;
  /** Итоговое время генерации в мс. */
  totalMs: number;
  createdAt: string;
  /** Помечает артефакт как заготовку — см. `Worksheet.isDemo`. */
  isDemo?: boolean;
}