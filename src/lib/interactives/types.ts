/**
 * Типы движка интерактивов (TZ-13 §4.3) — ФРОНТОВАЯ копия.
 *
 * Зеркалит `backend/src/lib/interactives/types.ts`. Почему дублируем, а не
 * импортируем: фронт статически экспортируется (`next.config.mjs` →
 * `output: "export"`), бэкенд — отдельный npm-проект со своим `tsconfig.json`
 * (`include: ["src\/**\/*"]`, только backend/src). Общего пакета нет, поэтому
 * единственный способ не разъехаться — держать структуры ИДЕНТИЧНЫМИ ТЗ §4.3
 * и править обе копии синхронно.
 *
 * ПРАВИЛО СИНХРОНИЗАЦИИ: любое изменение полей ниже требует такого же
 * изменения в бэкендовом файле.
 *
 * ЧТО ДОБАВЛЕНО ТОЛЬКО ЗДЕСЬ ( фронт-область, в бэк не дублируется):
 *   - типизированные опции каждого формата и их нормализация;
 *   - `ClientAttemptAnswer` (поля, которые нужны клиенту для его же формулы);
 *   - контракты плееров (`PlayerBridge`) и API-типы учительской части.
 */

/** Поддерживаемые форматы интерактива (6 штук, ТЗ §2.1). */
export type InteractiveFormat =
  | "quiz-race"
  | "sort-baskets"
  | "jump-truth"
  | "fortune-wheel"
  | "jeopardy"
  | "sort-sequence";

/** Канонический список форматов — для валидации входных данных и тестов. */
export const INTERACTIVE_FORMATS: readonly InteractiveFormat[] = [
  "quiz-race",
  "sort-baskets",
  "jump-truth",
  "fortune-wheel",
  "jeopardy",
  "sort-sequence",
] as const;

/**
 * Одно задание интерактива.
 *
 * Сводит к единой форме задания из листа (multiple-choice, fill-blank, число)
 * плюс форматно-специфичные поля. Все шесть форматов читают этот же интерфейс —
 * на этом и держится «один движок + 6 конфигов» (ТЗ §4.3).
 */
export interface InteractiveItem {
  id: string;
  /** Текст задания. */
  prompt: string;
  /** Для quiz-race / fortune-wheel: варианты. Для jump-truth: не задан. */
  options?: string[];
  /** Индекс правильного варианта (0-based). */
  correctIndex?: number;
  /** Для jump-truth: утверждение истинно (true) или ложно (false). */
  isTrue?: boolean;
  /** Картинка — SVG-строка (отрендерена на бэкенде, ТЗ §4.8). */
  svg?: string;
  /** Сектор для fortune-wheel / категория для jeopardy / корзина для sort-baskets. */
  bucket?: string;
  /** Очки за задание (по умолчанию формат задаёт сам). */
  points?: number;
  /**
   * Для sort-sequence: позиция объекта в ЭТАЛОННОМ порядке.
   *
   * Отдельное поле (а не `points`), потому что предмет сортировки нельзя
   * превратить в «один правильный вариант из четырёх» — здесь правильных
   * вариантов ровно столько же, сколько объектов.
   */
  orderIndex?: number;
  /**
   * Для sort-baskets: карточка-ловушка (не принадлежит ни одной корзине,
   * ТЗ §2.3). Учитель помечает заранее, ученик не должен её никуда тащить.
   */
  isTrap?: boolean;
  /** Для sort-baskets: id корзины, в которую объект кладётся правильно. */
  correctBucket?: string;
  /** Сколько миллисекунд ученик думал над заданием — заполняется в попытке. */
  ms?: number;
}

/**
 * Параметры формата. У каждого формата свои, общий набор — пустой объект.
 *
 * Индексная сигнатура сохранена намеренно: она делает `InteractiveOptions`
 * присваиваемым `Record<string, unknown>` и обратно, поэтому бэк может
 * объявить свой тип как угодно — структурно типы останутся совместимы.
 *
 * Известные ключи:
 *   quiz-race:      itemCount, secondsPerItem (10 | 20 | 30 | 0 = без таймера), shuffleOptions
 *   sort-baskets:   itemCount, baskets (string[]), maxErrors
 *   jump-truth:     itemCount, boardSize (6 | 8), mines (3..5)
 *   fortune-wheel:  sectors (string[]), questionsPerSector
 *   jeopardy:       categories (string[]), rows, pointLadder (number[]), mode
 *   sort-sequence:  itemCount, mode ("order" | "classify"), principle
 */
export interface InteractiveOptions {
  [key: string]: unknown;
  itemCount?: number;
  secondsPerItem?: number;
  shuffleOptions?: boolean;
  baskets?: string[];
  maxErrors?: number;
  boardSize?: number;
  mines?: number;
  sectors?: string[];
  questionsPerSector?: number;
  categories?: string[];
  rows?: number;
  pointLadder?: number[];
  mode?: string;
  principle?: string;
}

/**
 * Конфигурация интерактива целиком. Именно она лежит в
 * `interactives.config_json` и едет ученику в `GET /api/public/interactives/:token`.
 *
 * ВАЖНО ДЛЯ БЕЗОПАСНОСТИ: `correctIndex` / `isTrue` / `orderIndex` /
 * `correctBucket` едут в браузер ученика (фронт их использует для локальной
 * отрисовки и мгновенной обратной связи). Поэтому серверный скоринг
 * НИКОГДА не берёт баллы из присланного клиентом `score` — он пересчитывает
 * их из этого же конфига (ТЗ §4.7).
 */
export interface InteractiveConfig {
  format: InteractiveFormat;
  title: string;
  /** Общий набор заданий, сводится к единой форме. */
  items: InteractiveItem[];
  /** Параметры формата — у каждого формата свои. */
  options: InteractiveOptions;
  /** Версия схемы конфига. Движок умеет 1..N; в БД дублируется в config_schema. */
  schemaVersion?: number;
}

/**
 * Один ответ в попытке, приезжающий от клиента.
 *
 * Клиент может прислать что угодно, поэтому все поля трактуются как
 * НЕДОВЕРЕННЫЕ: скоринг читает их только как «что выбрал ученик» и сверяет
 * с эталоном из config_json. Присланные клиентом `correct` / `score`
 * в расчёт не идут.
 */
export interface AttemptAnswer {
  /** id задания из config_json. Неизвестные id игнорируются. */
  itemId: string;
  /** Выбранный индекс варианта (quiz-race, fortune-wheel, jeopardy). */
  chosenIndex?: number;
  /** Выбранный вариант «правда/ложь» для jump-truth. */
  chosenTrue?: boolean;
  /** Выбранная корзина для sort-baskets. */
  chosenBucket?: string;
  /** Выбранный порядок для sort-sequence: массив id в порядке ученика. */
  chosenOrder?: string[];
  /**
   * quiz-race: ученик уже пробовал другой вариант, очки режутся вдвое.
   * Зеркалит серверное поле — истина считается на бэке, но клиент шлёт флаг,
   * чтобы его скоринг и серверный считали одинаково.
   */
  secondTry?: boolean;
  /** jeopardy («очередь»): имя игрока, которому принадлежит ход. */
  player?: string;
  /** Сколько миллисекунд ученик думал (для античита/разбора). */
  ms?: number;
}

/**
 * Ответ ученика в том виде, в каком его отправляет клиент.
 *
 * Структурно совпадает с бэкендовым `AttemptAnswer`, включая два поля, которые
 * нужны серверу, чтобы пересчитать тот же счёт, что показал клиент (ТЗ §4.7):
 *   - `secondTry` — quiz-race, по ТЗ §2.2 вторая попытка режет очки вдвое;
 *   - `player`    — jeopardy в режиме «очередь»: чей это ход. Очки сервер
 *     берёт сам из `item.points`, клиент их только показывает.
 *
 * Отдельного клиентского типа нет намеренно: одно поле, одно имя, один контракт
 * в обеих копиях. Всё, что недоверенно (client `score`/`percent`/`stars`),
 * сервер пересчитывает из `config_json` и в расчёт не берёт.
 */
export type ClientAttemptAnswer = AttemptAnswer;

/**
 * Результат подсчёта — единственный источник истины для D1.
 *
 * На клиенте считается по тем же формулам, что и на сервере, но значения
 * показываются ученику как «предварительный итог»: при отправке сервер
 * пересчитывает всё заново и может вернуть другие числа.
 */
export interface InteractiveScore {
  /** Баллы по формуле формата. */
  score: number;
  /** Максимум баллов, посчитанный сервером из конфига. */
  maxScore: number;
  /** Процент 0..100, округление как в ТЗ (`round`). */
  percent: number;
  /** Звёзды 0..3 по порогам формата (не у всех форматов считаются). */
  stars: number;
  /** Дополнительные счётчики формата — кладутся в `answers_json` для разбора. */
  detail: {
    correct: number;
    wrong: number;
    total: number;
    /** sort-baskets: число неверных попыток (по ним — звёзды). */
    errors?: number;
    /** jump-truth: число ходов. */
    moves?: number;
    /** fortune-wheel: сколько вопросов закрыто по каждому сектору. */
    sectorProgress?: Record<string, { done: number; total: number }>;
    /** fortune-wheel / jeopardy: сумма очков игроков. */
    playerScores?: Record<string, number>;
    /** jeopardy: победитель (argmax). */
    winner?: string | null;
    /** sort-sequence: сколько позиций совпало с эталоном. */
    positionsCorrect?: number;
    /** quiz-race: доля правильных 0..1. */
    ratio?: number;
  };
  /** id заданий, где ученик ошибся — для «топ проваленных вопросов» учителя. */
  wrongItemIds: string[];
  /**
   * Разбор по КАЖДОМУ ответу: id + верно/неверно. Считается теми же
   * проверками, что и баллы, поэтому не может разойтись со `score`.
   * На клиенте не заполняется — его считает сервер при ответе на `submit`.
   */
  itemResults?: ItemResult[];
}

/** Один разобранный ответ — по нему строится «топ проваленных вопросов». */
export interface ItemResult {
  itemId: string;
  correct: boolean;
}

/* ─── Типизированные опции форматов (фронт) ──────────────────────────────── */

export interface QuizRaceOptions {
  /** Сколько вопросов показываем (10–20 по ТЗ §2.2). */
  itemCount: number;
  /** Секунд на вопрос. 0 = без таймера. */
  secondsPerItem: number;
  /** Перемешать варианты ответов внутри вопроса. */
  shuffleOptions: boolean;
}

export interface SortBasketsOptions {
  itemCount: number;
  /** Названия корзин (2–4). */
  baskets: string[];
  /** Порог ошибок для звёзд, ТЗ §2.3: 2 и 5. */
  maxErrors: number;
}

export interface JumpTruthOptions {
  itemCount: number;
  /** 8 — полный размер поля, 6 — для телефона. */
  boardSize: number;
  /** Сколько мин на поле (3–5). */
  mines: number;
}

export interface FortuneWheelOptions {
  /** Подписи секторов (4–8). */
  sectors: string[];
  /** Сколько вопросов раскладываем в каждый сектор. */
  questionsPerSector: number;
}

export interface JeopardyOptions {
  /** Номинации (строки доски). */
  categories: string[];
  /** Сколько клеток в номинации (3–4). */
  rows: number;
  /** Стоимость клетки по столбцу, ТЗ §2.6: 100/200/300/400. */
  pointLadder: number[];
  /** Режим игры: один ученик или по очереди. */
  mode: "solo" | "queue";
}

export interface SortSequenceOptions {
  itemCount: number;
  /** `order` — упорядочить, `classify` — разложить в 2 корзины (ТЗ §2.7). */
  mode: "order" | "classify";
  /** Принцип сортировки из закрытого списка, ТЗ §2.7 «не пишет свой». */
  principle: string;
}

export type AnyFormatOptions =
  | QuizRaceOptions
  | SortBasketsOptions
  | JumpTruthOptions
  | FortuneWheelOptions
  | JeopardyOptions
  | SortSequenceOptions;

/**
 * Соответствие «формат → тип его опций».
 *
 * Существует ради `normalizeOptions<F>()`: без него функция отдаёт
 * `AnyFormatOptions` (union), и каждый из шести плееров вынужден кастовать
 * результат к своему типу — то есть ошибка в ключе опции проходила бы
 * незамеченной до падения в рантайме. С этой таблицей тип выводится из
 * аргумента: `normalizeOptions("quiz-race", …)` даёт `QuizRaceOptions`.
 */
export interface FormatOptionsMap {
  "quiz-race": QuizRaceOptions;
  "sort-baskets": SortBasketsOptions;
  "jump-truth": JumpTruthOptions;
  "fortune-wheel": FortuneWheelOptions;
  jeopardy: JeopardyOptions;
  "sort-sequence": SortSequenceOptions;
}

/* ─── Публичная сторона (ученик) ─────────────────────────────────────────── */

/**
 * GET /api/public/interactives/:token.
 *
 * Это ровно `InteractiveConfig` + пара полей для шапки. Бэк отдаёт whitelist'ом
 * только `config_json`, без `user_id` и email учителя (ТЗ §7) — клиент любые
 * лишние поля игнорирует.
 */
export interface PublicInteractive extends InteractiveConfig {
  subject?: string;
  grade?: number;
  teacherLabel?: string;
  /** unix seconds. */
  expiresAt?: number;
}

/** POST .../attempts — попытка создана, сервер выдал токен восстановления. */
export interface StartAttemptOk {
  ok: true;
  attemptToken: string;
  /** unix seconds — сервер уже видел эту попытку (восстановление). */
  resumed?: boolean;
}

/** POST .../submit — ответ сервера после пересчёта. */
export interface SubmitAttemptOk {
  ok: true;
  score: number;
  maxScore: number;
  percent: number;
  stars: number;
  /** Число завершённых попыток по этому интерактиву. */
  attemptsCount?: number;
}

export interface SubmitAttemptInput {
  studentName: string;
  studentClass?: string;
  score: number;
  maxScore: number;
  percent: number;
  stars: number;
  durationS: number;
  answers: ClientAttemptAnswer[];
}

/* ─── Учительская сторона ────────────────────────────────────────────────── */

/** Краткая карточка в списке «Интерактивы». */
export interface InteractiveListItem {
  id: string;
  title: string;
  format: InteractiveFormat;
  status: "active" | "archived";
  subject?: string;
  grade?: number;
  /** unix seconds. */
  createdAt: number;
  /** Сколько учеников выполнили. */
  attemptsCount: number;
  /** null, если попыток ещё нет. */
  percentAvg: number | null;
}

/** Один ученик в сводке. */
export interface AttemptRow {
  id: string;
  studentName: string;
  studentClass: string | null;
  score: number;
  maxScore: number;
  percent: number;
  stars: number;
  /** null, если ученик не дошёл до финиша. */
  durationS: number | null;
  /** true = попытка закрыта (result приехал). */
  completed: boolean;
  /** unix seconds. */
  createdAt: number;
  /** unix seconds. */
  completedAt: number | null;
}

/** Агрегат по одному заданию — для «топ-3 проваленных вопросов». */
export interface ItemStat {
  itemId: string;
  prompt: string;
  answered: number;
  correct: number;
  /** Доля правильных 0..1. */
  ratio: number;
}

/** GET /api/interactives/:id — конфиг + сводка по попыткам. */
export interface InteractiveRecord {
  id: string;
  title: string;
  format: InteractiveFormat;
  status: "active" | "archived";
  config: InteractiveConfig;
  /** Сколько всего учеников получили ссылку (учитель знает из класса). */
  /** null — «сколько всего» продукт не знает, покажи учителю вручную. */
  expectedStudents: number | null;
  attemptsCount: number;
  /** unix seconds. */
  createdAt: number;
  /** Публичная ссылка `/play/?t=<token>` — её кладём в QR. */
  shareUrl: string;
}

export interface InteractiveAttemptsSummary {
  record: InteractiveRecord;
  attempts: AttemptRow[];
  /** Топ-3 заданий с наименьшей долей правильных. */
  hardestItems: ItemStat[];
}

/* ─── Контракт плеера (движок) ───────────────────────────────────────────── */

/**
 * То, что оболочка даёт плееру и чего ждёт от него.
 *
 * Почему `unknown`, а не generic: диспетчер `InteractivePlayer` обязан быть
 * исчерпывающим `switch` по 6 форматам, а generics через него не проходят
 * без потери exhaustiveness. Каждый плеер поэтому сам валидирует присвоенный
 * снапшот (тип-гард) и никогда не доверяет ему — ТЗ Р-3.
 */
export interface PlayerBridge {
  /**
   * Снапшот состояния из `localStorage` (восстановление после закрытия
   * вкладки). Может быть `null` — тогда плеер создаёт начальное состояние.
   * Снапшот приходит из localStorage, поэтому он НЕДОВЕРЕН: плеер обязан
   * проверить форму и при несовпадении начать заново.
   */
  initial: unknown;
  /** Любое изменение состояния — оболочка пишет снапшот и обновляет счёт. */
  onChange: (snapshot: unknown) => void;
  /** Ученик дошёл до конца — отправить счёт наверх. */
  onFinish: (result: PlayerResult) => void;
}

/** Что плеер отдаёт оболочке в момент финиша. */
export interface PlayerResult {
  answers: ClientAttemptAnswer[];
  /** Счёт по формуле ТЗ §2 — клиентский, предварительный. */
  score: InteractiveScore;
  /** Сколько секунд заняла игра (для `durationS`). */
  durationS: number;
}

/** Общие пропсы всех шести плееров. */
export type PlayerProps = { config: PublicInteractive } & PlayerBridge;

/* ─── Ошибки ─────────────────────────────────────────────────────────────── */

/** Единый union ошибок клиента интерактивов (по образцу `src/lib/forms/types.ts`). */
export type InteractiveApiError =
  | { ok: false; error: "unauthorized" } // 401 — учитель не залогинен
  | { ok: false; error: "validation"; details?: unknown } // 400 — zod-валидация
  | { ok: false; error: "not_found" } // 404 INTERACTIVE_NOT_FOUND
  | { ok: false; error: "closed" } // 410 INTERACTIVE_CLOSED
  | { ok: false; error: "expired" } // 410 INTERACTIVE_EXPIRED
  | { ok: false; error: "rate_limited" } // 429 RATE_LIMITED
  | { ok: false; error: "network" } // fetch упал: оффлайн / CORS / нет API_URL
  | { ok: false; error: "internal" }; // 5xx и прочие неожиданные

/** Человекочитаемые тексты — чтобы фронт и бэк не разъехались в формулировках. */
export const INTERACTIVE_ERROR_MESSAGE: Record<InteractiveApiError["error"], string> = {
  unauthorized: "Войдите, чтобы увидеть выданные интерактивы",
  validation: "Не получилось сохранить интерактив. Проверьте настройки и попробуйте ещё раз",
  not_found: "Интерактив не найден или уже закрыт учителем",
  closed: "Учитель закрыл этот интерактив",
  expired: "Срок ссылки истёк",
  rate_limited: "Слишком много попыток. Подождите немного",
  network: "Не удалось загрузить интерактив. Проверьте интернет и попробуйте ещё раз",
  internal: "Что-то сломалось на нашей стороне. Попробуйте ещё раз чуть позже",
};

/** Максимальная длина имени ученика — ТЗ §7 (свободная строка, без ПДн). */
export const STUDENT_NAME_MAX = 60;

/**
 * Технический id корзины «не подходит ни к одной» для карточек-ловушек
 * (`isTrap`, ТЗ §2.3).
 *
 * Зачем он нужен: ловушка не принадлежит ни одной корзине, поэтому у неё нет
 * `correctBucket` и положить её «правильно» некуда. Без отдельной зоны карточка
 * навсегда осталась бы в списке и игра не могла бы закончиться. Ученик
 * выражает правильное решение явно: «эту — в сторону».
 *
 * Разделитель «|» в `correctBucket` означает «карточка подходит к нескольким
 * корзинам» (ТЗ §2.3, «относятся к двум»): верной считается любая из них.
 */
export const TRAP_BUCKET_ID = "__trap__";
export const TRAP_BUCKET_LABEL = "Не подходит ни к одной";
