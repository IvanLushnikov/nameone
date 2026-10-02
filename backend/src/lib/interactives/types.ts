/**
 * Общие типы интерактивов — БЭКЕНД-зеркало `src/lib/interactives/types.ts` (TZ-13 §4.3).
 *
 * Почему дублируем, а не импортируем: фронт статически экспортируется (TZ §4.1),
 * бэкенд — отдельный npm-проект со своим `tsconfig.json`
 * (`include: ["src\/**\/*"]`, только backend/src). Общего package нет, поэтому
 * единственный способ не разъехаться — держать структуры IDENTиЧНЫМИ ТЗ §4.3
 * и править обе копии синхронно.
 *
 * ЧТО НЕ ДУБЛИРУЕМ: `data-interactive-*` селекторы, хуки движка
 * (`useInteractiveState`, `useDragSort`) и React-типы — это фронт-область.
 *
 * ПРАВИЛО СИНХРОНИЗАЦИИ: любое изменение полей здесь требует такого же
 * изменения во фронтовом файле. Это единственная точка, где бэк и фронт
 * обязаны совпадать структурно.
 */

/** Поддерживаемые форматы интерактива (6 штук, TZ §2.1). */
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
 * на этом и держится «один движок + 6 конфигов» (TZ §4.3).
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
  /** Картинка — SVG-строка (отрендерена на бэкенде, TZ §4.8). */
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
   * TZ §2.3). Учитель помечает заранее, ученик не должен её никуда тащить.
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
 * присваиваемым `Record<string, unknown>` и обратно, поэтому фронт может
 * объявить свой тип как угодно — структурно типы останутся совместимы.
 *
 * Известные ключи (описаны здесь, чтобы роуты не гадали по форме JSON):
 *   quiz-race:      itemCount, secondsPerItem (10 | 20 | 30 | 0 = без таймера), shuffleOptions
 *   sort-baskets:   itemCount, baskets (string[]), maxErrors
 *   jump-truth:     itemCount, boardSize (6 | 8), mines (3..5)
 *   fortune-wheel:  sectors (string[]), questionsPerSector
 *   jeopardy:       categories (string[]), rows, pointLadder (number[])
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
 * (`services/interactives-scoring.ts`) НИКОГДА не берёт баллы из присланного
 * клиентом `score` — он пересчитывает их из этого же конфига.
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
   * Для quiz-race: ученик уже пробовал другой вариант и очки режутся вдвое.
   *
   * Это подсказка клиента, которая может только УМЕНЬШИТЬ балл (никак не
   * увеличивает), поэтому недоверенной её считать неопасно.
   */
  secondTry?: boolean;
  /**
   * Для jeopardy (режим «очередь»): имя игрока, которому принадлежит ход.
   *
   * Очки НЕ присылаются — сервер сам берёт их из `item.points` клетки.
   * Если поле не прислано, ответ засчитывается игроку `"player"`.
   */
  player?: string;
  /** Сколько миллисекунд ученик думал (для античита/разбора). */
  ms?: number;
}

/**
 * Результат по ОДНОМУ заданию в конкретной попытке.
 *
 * Нужен учителю для «какой вопрос все провалили» (ТЗ §4.5): из этих записей
 * агрегируются `answered` / `correct` / `ratio` по каждому заданию. Поэтому
 * это единственный разбор, который попадает в `answers_json`.
 */
export interface ItemResult {
  itemId: string;
  /** true = ответ верный, false = неверный. Сами ответы ученика не храним. */
  correct: boolean;
}

/**
 * Результат серверного скоринга — считается ИСКЛЮЧИТЕЛЬНО из `config_json`
 * и присланных ответов. Это единственный источник истины для D1.
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
   * Разбор по КАЖДОМУ ответанному заданию: id + верно/неверно.
   *
   * Считается теми же проверками, что и баллы (одним и тем же кодом в том же
   * цикле), поэтому разойтись с `score`/`percent` не может — а именно из
   * расхождения сейчас строятся «сложные задания» у учителя.
   *
   * В `answers_json` сохраняется именно это, а НЕ сырые `answers[]` клиента:
   * клиентские флаги `correct` в базу не попадают.
   */
  itemResults: ItemResult[];
}
