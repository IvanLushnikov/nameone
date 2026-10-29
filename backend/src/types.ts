/**
 * API contract types.
 *
 * Здесь — типы, которые фронт получает через `fetch(NEXT_PUBLIC_API_URL + ...)`.
 * Базовые доменные типы продублированы (SubjectSlug/Difficulty/TaskType/etc.),
 * чтобы backend не зависел от фронтовой кодовой базы и жил автономно.
 *
 * Когда фронт перейдёт на единый shared-пакет — поменяем импорты здесь.
 */

import type { Env } from "./env";

/**
 * ТЗ-33: тип задания — из общего реестра.
 *
 * ИСКЛЮЧЕНИЕ из правила «бэк не зависит от фронтовой кодовой базы» (см. шапку
 * файла). Типы предметов и сложности продублированы, потому что это мелочь;
 * а перечень типов заданий — это реестр, который ОБЯЗАН быть один: по нему
 * и фронт печатает лист, и бэк проверяет ответ модели, и промпт собирается.
 * Две копии реестра разъехались бы за неделю — и учитель получил бы на
 * листе «расположите в порядке», который бэк считает мусором.
 *
 * Файл не тянет за собой фронтовый `types.ts`: в реестре `subjects` — это
 * `string[]`, а не `SubjectSlug[]`, чтобы воркер не тащил весь фронтовый
 * тип-файл (см. `src/lib/content/task-types.ts`, комментарий в шапке).
 */
import type { TaskTypeId } from "../../src/lib/content/task-types";

export type { TaskTypeId };

/**
 * ТЗ-34: критерии оценивания и шкала отметок.
 *
 * Тот же исключение, что и у реестра типов: отметку 5/4/3/2 и максимальный
 * балл за задание ОБЯЗАНЫ считать по одной формуле — и API, и печать, и
 * тесты. Две копии шкалы разъехались бы за неделю, и у одного учителя было бы
 * «5 за 80 %», а у другого «5 за 90 %».
 *
 * Импорт ТИПОВЫЙ (без `type` в рантайме) — воркер не должен тащить фронтовый
 * код: `grading.ts` тянет только реестр типов, который и так нужен бэку.
 */
import type { EvaluationPart } from "../../src/lib/content/grading";
import type { TypeDiversityViolation } from "./llm/validation/type-diversity";

export type { EvaluationPart, TypeDiversityViolation };

// ─────────────────────────────────────────────────────────────────────────────
// Базовые доменные типы (синхронизированы с front: src/lib/types.ts)
// ─────────────────────────────────────────────────────────────────────────────

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
  | "worksheet" // рабочий лист
  | "test" // тест с автопроверкой
  | "cards" // карточки для запоминания
  | "control" // контрольная (2 варианта)
  | "oge" // вариант ОГЭ
  | "ege"; // вариант ЕГЭ

/**
 * Что учитель выбрал в конструкторе СВЕРХ параметров темы.
 *
 * Отдельный объект, потому что учебник — не параметр материала: по нему не
 * строится заголовок листа и его нельзя отсортировать в истории. Это указание
 * «пиши по этому учебнику», и оно влияет только на текст заданий.
 *
 * ИМЯ ПОЛЯ НЕ МЕНЯТЬ: фронт шлёт именно `request.meta.umk` (см.
 * `src/app/constructor/page.tsx`, комментарий TZ-08). Если здесь назвать поле
 * иначе, выбор учителя продолжит молча теряться по дороге — бэкенд не обязан
 * знать про фронтовые соглашения, но обязан знать то, что реально приходит по
 * сети.
 */
export interface GenerationRequestMeta {
  /**
   * Идентификатор учебника из таксономии фронта (`src/lib/content/umk.ts`):
   * `vilenkin`, `merzlyak-alg`, `pleshakov`. Бэкенд таксономию не хранит и не
   * проверяет — значение уходит в инструкцию модели как есть. Пустое или
   * непохожее на идентификатор = обычный путь, работаем как без учебника.
   */
  umk?: string | null;
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
  /** Выбор учителя в конструкторе: учебник (УМК). Необязателен. */
  meta?: GenerationRequestMeta;
}

export interface WorksheetTask {
  number: number;
  text: string;
  /**
   * Тип задания. ТЗ-33: набор расширен с 5 до 17.
   *
   * Идентификаторы берутся из реестра `src/lib/content/task-types.ts` — файл
   * лежит во фронте, но это ЕДИНЫЙ источник истины: и бэк, и фронт читают
   * его, поэтому тип не может разъехаться между ними.
   *
   * Старые листы в базе читаются как раньше: пять прежних `id` не изменились,
   * миграция `payload_json` не нужна.
   */
  type: TaskTypeId;
  options?: string[];
  answer?: string;
  explanation?: string;
  points: number;
  /**
   * ТЗ-27: метка темы («Давление твёрдых тел»), по которой разбирают, где класс
   * просел. Живёт в ЛИСТЕ, а не в ответе: учитель правит метку в одном месте,
   * а история попыток хранит снимок (см. `db/schema.sql`, таблица
   * `skill_attempts`). Поле опциональное — у листов, созданных до ТЗ-27, его
   * нет, и они обязаны вести себя как раньше.
   */
  skill?: string | null;
  /**
   * ТЗ-33: разобранный образец для типа `pattern` («выполните по образцу»).
   * Обязателен для этого типа, проверяется кодом (см. `quality-filter.ts`).
   * Поле необязательное: у листов до ТЗ-33 его нет.
   */
  sample?: string | null;
  /** ТЗ-33: таблица или рисунок в задании (тип `table-task`). */
  table?: { headers: string[]; rows: string[][] } | null;
  /**
   * ТЗ-33: элементы задания — что упорядочить, распределить, сопоставить,
   * сравнить.
   */
  items?: string[] | null;
  /**
   * ТЗ-33: критерии приёмки для `essay`, `open-ended`, `practical`.
   * Отдельное поле, а не содержимое `answer` (ТЗ-32, AD-5).
   */
  criteria?: string[] | null;
  /** ТЗ-33: шаги алгоритма для `practical` — печатаются чек-листом. */
  steps?: string[] | null;
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
}

export interface ExamProblem {
  number: number;
  part: 1 | 2;
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
  duration: number;
  problems: ExamProblem[];
}

// ─────────────────────────────────────────────────────────────────────────────
// API DTO
// ─────────────────────────────────────────────────────────────────────────────

/** Тип генерации (какой моделью/режимом выполнено). */
export type GenerationMode = "primary" | "boost" | "premium" | "cached" | "fallback-mock";

export interface GenerateWorksheetRequest {
  request: GenerationRequest;
  /** Пробить семантический кэш и сгенерить заново. */
  bypassCache?: boolean;
}

export interface GenerateWorksheetMeta {
  model: string;
  provider: string;
  costUsd: number;
  /**
   * Фактическое списание в рублях от провайдера, если он его отдаёт
   * (`usage.cost_rub` у polza.ai). null у провайдеров без такого поля —
   * тогда единственный источник расхода остаётся `costUsd`.
   */
  costRub?: number | null;
  latencyMs: number;
  cached: boolean;
  generation: GenerationMode;
}

/**
 * Что потерялось по дороге от запроса учителя до материала (ТЗ-25, разрыв 5).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЗАЧЕМ ЭТО В ОТВЕТЕ, А НЕ ТОЛЬКО В ЛОГЕ
 * ─────────────────────────────────────────────────────────────────────────────
 * Фильтр качества чинит плохие задания, но выкинутые задания ПРОПАДАЛИ без
 * следа: `filterTasks` возвращает отчёт, и конвейер шёл по `.tasks`, отчёт
 * отбрасывая. Учитель просил 15 заданий, получал 11 и узнавал об этом, только
 * пересчитав дома.
 *
 * Поля замкнуты на «учитель должен видеть без догадок»:
 *   · `requested` — сколько просил;
 *   · `delivered` — сколько в итоге в материале;
 *   · `dropped` — сколько выкинул фильтр;
 *   · `topUpAdded` — сколько конвейер добрал дозапросом (AD-7);
 *   · `stillMissing` — что осталось недообранным ПОСЛЕ дозапроса.
 *
 * `stillMissing > 0` — единственное состояние, при котором интерфейс обязан
 * показать учителю предупреждение.
 */
export interface QualityLossInfo {
  /** Сколько заданий просил учитель. */
  requested: number;
  /** Сколько заданий в выданном материале. */
  delivered: number;
  /** Сколько заданий выкинул фильтр качества. */
  dropped: number;
  /** Чем именно выкинул — номера заданий и причина. */
  droppedPatternRef: number[];
  droppedForeignMath: number[];
  cleanedAnswer: number[];
  /** Сколько заданий добрал дозапросом (AD-7). */
  topUpAdded: number;
  /** Сколько не удалось добрать даже после дозапроса. */
  stillMissing: number;
  /** Фильтр сработал настолько агрессивно, что вернул исходный набор целиком. */
  filterBackedOff: boolean;
  /**
   * Сколько пар повторяющихся заданий осталось в выданном материале ПОСЛЕ
   * чистки (ТЗ-26).
   *
   * Пока этого поля не было, конвейер знал, что дубль починить не удалось, но
   * молчал: учитель получал лист полного размера, который выглядел целым, и
   * замечал повтор сам. На «Квадратном трёхчлене» это срабатывает регулярно —
   * модель возвращает «найдите корни квадратного трёхчлена» снова и снова.
   *
   * Теперь это правда, а не утечка: поле едет до интерфейса и превращается в
   * строку предупреждения.
   */
  repeatedSkills: number;
  /**
   * Сколько заданий в выданном материале осталось БЕЗ ключа (ТЗ-32, AD-4).
   *
   * Считается по финальному списку заданий, поэтому ловит оба пути, которые
   * оставляли пустой ответ в выдаче: фильтр обнуляет ответ-заглушку, оставляя
   * задание, и защита от пустого листа возвращает исходный неотфильтрованный
   * набор. Больше нуля — учитель обязан увидеть это ДО печати: иначе он раздаёт
   * классу лист и обнаруживает отсутствие ключа уже вечером при проверке.
   *
   * При `withAnswers = false` всегда 0: там отсутствие ответа — не дефект, а
   * то, что просил учитель.
   */
  tasksWithoutAnswer: number;
  /**
   * ТЗ-34: нарушения разнообразия ТИПОВ заданий, которые остались в выдаче.
   *
   * ТЗ-33 сделал правило разнообразия числами, но проверяла его только модель:
   * в живом ответе контрольной было три расчёта из четырёх при лимите «не
   * больше 2 одного типа», и в `quality` про это не было ни одного поля.
   *
   * Теперь нарушение либо починено (заданием другого типа), либо видно здесь.
   * Список пустой — значит, разнообразие соблюдено.
   */
  typeDiversityViolations: TypeDiversityViolation[];
  /**
   * ТЗ-34: критерии оценивания сформировать НЕ удалось.
   *
   * `true` — ни у одного задания работы нет критериев. Учитель обязан увидеть
   * это ДО печати: на странице тогда пишется честная строка «критерии не
   * удалось сформировать — оценивайте по ключу», а не пустая страница.
   */
  criteriaMissing: boolean;
}

/**
 * Состояние вариантов контрольной (ТЗ-25, разрывы 1–3 и 6).
 *
 * Для НЕ-контрольной работы `expected = 1`, и учитель не должен видеть
 * никакого сообщения про варианты.
 */
export interface VariantStatusInfo {
  /** Сколько вариантов обещано учителю (2 у контрольной, 1 иначе). */
  expected: number;
  /** Сколько вариантов реально пришло. */
  delivered: number;
  /**
   * `true` — второй вариант не удалось сделать нормальным: модель вернула
   * копию первого дважды, либо второго варианта не пришло вовсе.
   * Учитель ОБЯЗАН это видеть (AD-3): молчаливый второй лист хуже явного
   * сообщения.
   */
  degraded: boolean;
  /** Почему деградировали — показываем учителю и пишем в лог. */
  degradedReason?: string;
  /** Был ли выполнен ретрай с подсказкой модели (AD-3). */
  retried: boolean;
}

export interface GenerateWorksheetResponse {
  ok: true;
  worksheet: Worksheet;
  /** Второй вариант контрольной. Отсутствие поля ≠ «второй не нужен». */
  secondVariant?: Worksheet | null;
  /** Признаки потерь материала — учитель видит их без догадок. */
  quality: QualityLossInfo;
  /** Состояние вариантов. Для не-контрольной работы expected = 1. */
  variants: VariantStatusInfo;
  /**
   * ТЗ-34: критерии оценивания и шкала отметок — ОТДЕЛЬНЫМ КЛЮЧОМ.
   *
   * Не внутри текста задания и не внутри `answer`: отдельный ключ нужен
   * фронту, чтобы нарисовать страницу, не обходя задания. Разойтись с
   * заданиями он не может — он СОБРАН из них.
   *
   * Один элемент для листа и теста, два для контрольной (по вариантам).
   */
  evaluation?: EvaluationPart[];
  meta: GenerateWorksheetMeta;
}

export interface GenerateExamRequest {
  exam: "oge" | "ege";
  subject: SubjectSlug;
  variantNumber: number;
}

export interface GenerateExamResponse {
  ok: true;
  variant: ExamVariant;
  /** ТЗ-25: потери, которые фильтр нанёс варианту. */
  quality: QualityLossInfo;
  meta: GenerateWorksheetMeta;
}

export interface CheckExamRequest {
  problems: ExamProblem[];
  /** answers[number] = ответ пользователя (строкой). */
  answers: Record<number, string>;
}

export interface ExamProblemResult {
  number: number;
  correct: boolean;
  pointsEarned: number;
  feedback: string;
}

export interface CheckExamResponse {
  ok: true;
  score: number;
  maxScore: number;
  perProblem: ExamProblemResult[];
}

export interface MagicLinkRequest {
  email: string;
}

export interface MagicLinkResponse {
  ok: true;
  sent: boolean;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  plan: "free" | "base" | "standard" | "plus";
  generationsTotal: number;
  generationsToday: number;
  generationsLimit: number;
  createdAt: string;
}

export interface SessionResponse {
  user: SessionUser | null;
}

export interface CallbackRequest {
  token: string;
}

export interface CallbackResponse {
  ok: true;
  sessionToken: string;
  user: SessionUser;
}

export interface LogoutResponse {
  ok: true;
}

export interface AuthMeResponse {
  ok: true;
  user: SessionUser | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// User-domain resources
// ─────────────────────────────────────────────────────────────────────────────

/** Шаблон пользователя: name + параметры рабочего листа, без tasks. */
export interface UserTemplate {
  id?: string;
  name: string;
  subject: SubjectSlug;
  grade: number;
  topic: string;
  difficulty: Difficulty;
  count: number;
}

/** Запись в истории (worksheets, сгенерированные пользователем). */
export interface HistoryItem {
  id: string;
  subject: string;
  grade: number;
  topic: string;
  difficulty: Difficulty;
  type: TaskType;
  count: number;
  title: string | null;
  worksheet: Worksheet;
  createdAt: string;
}

/** Активная подписка (или null). */
export interface SubscriptionView {
  id: string;
  plan: "base" | "standard" | "plus";
  status: string;
  /** `academicYear` = 9 месяцев от даты оплаты, НЕ календарный год. */
  period: "monthly" | "academicYear";
  startsAt: string;
  endsAt: string;
  autoRenew: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared Hono context (для типизации c.get('user')/c.get('ip')/c.get('userAgent'))
// ─────────────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  plan: "free" | "base" | "standard" | "plus";
  isAdmin: boolean;
  /**
   * Роль. `student` генерировать контент не может — только решать выданное
   * (тариф «Школа», запуск Q1 2027). Пока строки в user_roles нет —
   * это `teacher`, и поведение прежнее.
   */
  role: "teacher" | "student";
}

export interface AppVariables {
  user: AuthUser | null;
  ip: string;
  userAgent: string;
}

export interface AppEnv {
  Bindings: Env;
  Variables: AppVariables;
}

// ─────────────────────────────────────────────────────────────────────────────
// Misc
// ─────────────────────────────────────────────────────────────────────────────

export interface CreatePaymentRequest {
  plan: "base" | "standard" | "plus";
  /** `academicYear` = 9 месяцев от даты оплаты, НЕ календарный год. */
  period: "monthly" | "academicYear";
}

export interface CreatePaymentResponse {
  ok: true;
  confirmationUrl: string;
  paymentId: string;
}

export interface ApiError {
  ok: false;
  error: string;
  code: string;
  details?: unknown;
}

/** Универсальный успешный ответ. */
export interface ApiOk<T> {
  ok: true;
  data: T;
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin DTO (/api/admin/*)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Этап LLM-генерации (task в `llm_logs`).
 *
 * ТЗ-30 AD-4: `image-gen` убран — провайдера генерации изображений нет, а в
 * боевой базе нет ни одного вызова. Тип остаётся НАМЕРЕННО НЕПОЛНЫМ: в
 * `llm_logs` попадают все служебные задачи, включая те, что перечислять здесь
 * бессмысленно (проверка короткого ответа, схема графика). Список — не
 * контракт, а подсказка для админ-экранов, поэтому он не разрастается от новых
 * служебных вызовов и не ломает разбор уже записанных строк.
 */
export type AdminGenerationTask = "worksheet-gen" | "exam-gen" | "validate" | "embed";

/** Текущая конфигурация раскладки моделей. Одна запись = (task, plan). */
export interface ModelRoutingEntry {
  task: AdminGenerationTask;
  plan: string; // "free" | "base" | "standard" | "plus" | "*"
  primaryProvider: string;
  primaryModel: string;
  fallback: Array<{ provider: string; model: string }>;
  enabled: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface AdminMeResponse {
  ok: true;
  user: {
    id: string;
    email: string;
    name: string | null;
    isAdmin: boolean;
  };
}

/** Базовый фильтр для всех /stats/* endpoints. */
export interface AdminPeriodQuery {
  /** Время начала периода (unix seconds). Если null — последние 7 дней. */
  fromSec?: number;
  /** Время конца периода (unix seconds). Если null — сейчас. */
  toSec?: number;
}

/** Общие цифры за период. */
export interface AdminStatsSummary {
  period: { fromSec: number; toSec: number };
  users: {
    total: number;
    newInPeriod: number;
    paidActive: number; // plan != "free" и subscription status = active
  };
  generations: {
    worksheetsTotal: number;
    worksheetsInPeriod: number;
    examsInPeriod: number;
  };
  llm: {
    callsTotal: number;
    callsInPeriod: number;
    successRate: number; // 0..1
    cacheHitRate: number; // 0..1
    fallbackRate: number; // 0..1
  };
  costs: {
    usdTotalAllTime: number;
    usdInPeriod: number;
    usdThisMonth: number;
    topModelUsd: { model: string; costUsd: number } | null;
  };
  events: {
    totalInPeriod: number;
    topNames: Array<{ name: string; count: number }>;
  };
}

export interface AdminTrafficPoint {
  /** YYYY-MM-DD (UTC). */
  date: string;
  count: number;
}

export interface AdminTrafficResponse {
  period: { fromSec: number; toSec: number };
  byDay: AdminTrafficPoint[];
  byName: Array<{ name: string; count: number }>;
  /** Конверсия воронки landing → constructor → generate → paywall. */
  funnel: {
    landings: number;
    constructorStarted: number;
    generated: number;
    paywallOpened: number;
    paid: number;
  };
}

export interface AdminContentStatsResponse {
  worksheets: {
    total: number;
    bySubject: Array<{ subject: string; count: number }>;
    byGrade: Array<{ grade: number; count: number }>;
    byType: Array<{ type: string; count: number }>;
    topTopics: Array<{ subject: string; grade: number; topic: string; count: number }>;
  };
  exams: {
    total: number;
    byExam: Array<{ exam: "oge" | "ege"; count: number }>;
    bySubject: Array<{ subject: string; count: number }>;
  };
}

export interface AdminLlmStatsResponse {
  period: { fromSec: number; toSec: number };
  byModel: Array<{
    model: string;
    provider: string;
    calls: number;
    costUsd: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
    successRate: number;
    cacheHitRate: number;
    fallbackRate: number;
  }>;
  byTask: Array<{
    task: AdminGenerationTask;
    calls: number;
    costUsd: number;
  }>;
  byPlan: Array<{
    plan: string;
    calls: number;
    costUsd: number;
  }>;
  totalCostUsd: number;
}

export interface AdminCostsResponse {
  period: { fromSec: number; toSec: number };
  byDay: Array<{ date: string; costUsd: number; calls: number }>;
  byModel: Array<{ model: string; costUsd: number; calls: number }>;
  byTask: Array<{ task: AdminGenerationTask; costUsd: number; calls: number }>;
  topUsers: Array<{ userId: string | null; email: string | null; costUsd: number; calls: number }>;
}

export interface AdminUserRow {
  id: string;
  email: string;
  name: string | null;
  plan: "free" | "base" | "standard" | "plus";
  generationsTotal: number;
  createdAt: string;
  isAdmin: boolean;
}

export interface AdminUsersResponse {
  total: number;
  users: AdminUserRow[];
}

export interface AdminEventsResponse {
  events: Array<{
    id: string;
    userId: string | null;
    name: string;
    data: unknown;
    createdAt: string;
  }>;
}

export interface UpdateModelRoutingRequest {
  entries: Array<{
    task: AdminGenerationTask;
    plan: string;
    primaryProvider: string;
    primaryModel: string;
    fallback: Array<{ provider: string; model: string }>;
    enabled: boolean;
  }>;
}

export interface UpdateModelRoutingResponse {
  ok: true;
  updated: number;
}

export interface TrackEventRequest {
  /** Имя события, например "landing_cta_click", "constructor_step", "paywall_open". */
  name: string;
  /** Опциональные данные — без персональных данных и secrets. */
  data?: Record<string, unknown>;
  /** Анонимный ID с device (если пользователь не залогинен). */
  anonId?: string;
}
