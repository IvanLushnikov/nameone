/**
 * Подсчёт результата интерактива (TZ-13 §2) — по одному чистому набору
 * функций на формат.
 *
 * ⚠️ ГЛАВНОЕ ПРАВИЛО ФАЙЛА: формулы здесь — ЗЕРКАЛО серверного скоринга
 * (`backend/src/services/interactives-scoring.ts`). Клиент считает по ним же
 * только для того, чтобы показать ученику экран итога; **истина — на сервере**,
 * который пересчитывает баллы из `config_json` и присланных ответов
 * (ТЗ §4.7). Любая правка формулы обязана быть продублирована на бэке.
 *
 * Каждая функция:
 *   - чистая (никаких fetch, Date.now, window) — поэтому тестируется тривиально;
 *   - терпима к мусору в ответах (неизвестные itemId, пропущенные поля);
 *   - детерминирована: одни и те же ответы → один и тот же счёт.
 *
 * Все округления — через `Math.round`, как в ТЗ («percent = round(...)»).
 * Проценты всегда целые 0..100.
 */

import { normalizeOptions } from "./formats";
import type {
  ClientAttemptAnswer,
  FortuneWheelOptions,
  InteractiveConfig,
  InteractiveFormat,
  InteractiveItem,
  InteractiveScore,
  QuizRaceOptions,
} from "./types";

/* ─── Константы формул (ТЗ §2) ──────────────────────────────────────────── */

/** ТЗ §2.2: базовые очки за правильный ответ. */
export const QUIZ_BASE_POINTS = 100;
/** ТЗ §2.2: максимальный бонус за скорость. */
export const QUIZ_SPEED_BONUS_MAX = 50;
/** ТЗ §2.2: «очки режутся вдвое» при второй попытке. */
export const QUIZ_SECOND_ATTEMPT_DIVISOR = 2;
/** Максимум за один вопрос в викторине: 100 базы + 50 бонуса. */
export const QUIZ_ITEM_MAX_POINTS = QUIZ_BASE_POINTS + QUIZ_SPEED_BONUS_MAX;

/** ТЗ §2.3: пороги звёзд «Группировки» по числу ошибок. */
export const BASKETS_STARS_ERRORS = { three: 2, two: 5 };

/** ТЗ §2.5: доля правильных выше которой — 2 звезды. */
export const WHEEL_STARS_RATIO = 0.6;

/**
 * РАСШИРЕНИЕ к ТЗ (пороги заданы на сервере, здесь — зеркало): для форматов,
 * где ТЗ звёзды не задаёт (quiz-race, jump-truth, jeopardy, sort-sequence),
 * звёзды считаются от процента. Ноль ответов → ноль звёзд: «одна звезда за
 * пустой лист» — это награда за ничего.
 *
 * ⚠️ Значения 80/50 и правило «0 ответов → 0 звёзд» ОБЯЗАНЫ совпадать с
 * `backend/src/services/interactives-scoring.ts` (`STAR3_PERCENT`,
 * `STAR2_PERCENT`, `starsByPercent`).
 */
export const PERCENT_STARS = { three: 80, two: 50 };

/** Звёзды от процента — для форматов, где ТЗ порогов не задаёт. */
export function starsFromPercent(percent: number, answered: number): number {
  if (!Number.isFinite(answered) || answered <= 0) return 0;
  if (percent >= PERCENT_STARS.three) return 3;
  if (percent >= PERCENT_STARS.two) return 2;
  return 1;
}

/** Процент по формуле `round(100 * part / whole)`, с защитой от деления на ноль. */
function percentOf(part: number, whole: number): number {
  if (!Number.isFinite(whole) || whole <= 0) return 0;
  return Math.round((100 * part) / whole);
}

/* ─── Общий вход ─────────────────────────────────────────────────────────── */

/** Всё, что нужно скорингу: конфиг (эталон) + ответы ученика. */
export interface ScoringInput {
  config: InteractiveConfig;
  answers: ClientAttemptAnswer[];
  /** fortune-wheel / jeopardy: сумма очков игроков. */
  playerScores?: Record<string, number>;
  /** jump-truth: число бросков кубика. */
  moves?: number;
}

/**
 * Ответы, уникальные по `itemId`: при повторе (перезагрузка, восстановление
 * сессии) побеждает ПОСЛЕДНИЙ — он отражает, на чём ученик остановился.
 * Неизвестные `itemId` (их нет в `config_json`) отбрасываются: эталон мы
 * всё равно читаем из конфига, а не из ответа.
 */
function latestByItem(
  items: InteractiveItem[],
  answers: ClientAttemptAnswer[],
): Map<string, ClientAttemptAnswer> {
  const known = new Set(items.map((i) => i.id));
  const map = new Map<string, ClientAttemptAnswer>();
  for (const a of answers) {
    if (!a || typeof a.itemId !== "string" || !known.has(a.itemId)) continue;
    map.set(a.itemId, a);
  }
  return map;
}

/** Верно ли, что ученик выбрал правильный вариант (quiz/fortune/jeopardy). */
function isChoiceCorrect(item: InteractiveItem, answer: ClientAttemptAnswer | undefined): boolean {
  if (!answer || typeof answer.chosenIndex !== "number") return false;
  if (typeof item.correctIndex !== "number") return false;
  return answer.chosenIndex === item.correctIndex;
}

/* ─── 1. Викторина-гонка (ТЗ §2.2) ──────────────────────────────────────── */

/**
 * ```
 * очки за вопрос = base 100 + round(50 * remaining / total)
 *                 (вторая попытка → половина, ТЗ «очки режутся вдвое»)
 * score           = Σ очков за правильные ответы
 * percent         = round(100 * correct / answered)
 * duration_s      = факт − старт
 * ```
 *
 * `remaining / total` считаем из `ms` в ответе: сервер получает те же миллисекунды
 * и пересчитывает бонус сам. Если таймер выключен (`secondsPerItem = 0`), бонуса
 * нет: сравнивать не с чем, а платить 50 баллов за «отсутствие таймера» нечестно.
 */
export function scoreQuizRace(input: ScoringInput): InteractiveScore {
  const config = input.config;
  const options = normalizeOptions("quiz-race", config.options) as QuizRaceOptions;
  const byItem = latestByItem(config.items, input.answers);

  let score = 0;
  let correct = 0;
  let answered = 0;

  for (const item of config.items) {
    const answer = byItem.get(item.id);
    if (!answer || typeof answer.chosenIndex !== "number") continue;
    answered += 1;
    if (!isChoiceCorrect(item, answer)) continue;

    correct += 1;
    // Базовая стоимость — из конфига, если ранклер её задал (сервер так же).
    const base = typeof item.points === "number" && item.points > 0 ? item.points : QUIZ_BASE_POINTS;
    const totalMs = options.secondsPerItem * 1000;
    const spentMs = totalMs > 0 ? Math.min(Math.max(answer.ms ?? totalMs, 0), totalMs) : 0;
    const remainingRatio = totalMs > 0 ? (totalMs - spentMs) / totalMs : 0;
    const points = base + Math.round(QUIZ_SPEED_BONUS_MAX * remainingRatio);
    score +=
      answer.secondTry === true
        ? Math.floor(points / QUIZ_SECOND_ATTEMPT_DIVISOR)
        : points;
  }

  const percent = percentOf(correct, answered);

  return {
    score,
    // Без таймера бонус недостижим — максимум ниже. Так же считает сервер.
    maxScore:
      config.items.length *
      (options.secondsPerItem > 0 ? QUIZ_ITEM_MAX_POINTS : QUIZ_BASE_POINTS),
    percent,
    // РАСШИРЕНИЕ: ТЗ звёзды для викторины не задаёт.
    stars: starsFromPercent(percent, answered),
    detail: {
      correct,
      wrong: answered - correct,
      total: config.items.length,
      ratio: answered > 0 ? correct / answered : 0,
    },
    wrongItemIds: config.items
      .filter((item) => {
        const a = byItem.get(item.id);
        return !a || typeof a.chosenIndex !== "number" || !isChoiceCorrect(item, a);
      })
      .map((item) => item.id),
  };
}

/* ─── 2. Группировка по корзинам (ТЗ §2.3) ───────────────────────────────── */

/**
 * ```
 * correct = число карточек, попавших в свою корзину
 * errors  = число неверных попыток
 * percent = round(100 * correct / total)
 * stars   = errors <= 2 ? 3 : errors <= 5 ? 2 : 1
 * ```
 *
 * Про `total` (расходится с наивным «все карточки», но совпадает с сервером):
 * это карточки, у которых есть `correctBucket` и которые не ловушки. Ловушка
 * не имеет «своей корзины» — её задача не «положить», а «не тащить», и за
 * неё не ставится ни процент, ни штраф. Незакрытая карточка ошибкой НЕ
 * считается: ошибка — это попытка положить не туда (ТЗ §2.3).
 *
 * `correctBucket` может содержать несколько корзин через `|` («карточка
 * относится к двум», ТЗ §2.3) — верной считается любая из них.
 *
 * `maxScore` = числу карточек (балл за каждую на своём месте), чтобы процент
 * из формулы ТЗ и «балл из максимума» в ЛК не расходились.
 */
export function scoreSortBaskets(input: ScoringInput): InteractiveScore {
  const config = input.config;
  const byItem = latestByItem(config.items, input.answers);

  let correct = 0;
  let errors = 0;

  for (const item of config.items) {
    if (!isPlaceable(item)) continue;
    const answer = byItem.get(item.id);
    if (!answer) continue;
    if (acceptedBuckets(item).includes(answer.chosenBucket ?? "")) correct += 1;
    else errors += 1;
  }

  const total = config.items.filter(isPlaceable).length;
  const stars =
    total === 0
      ? 0
      : errors <= BASKETS_STARS_ERRORS.three
        ? 3
        : errors <= BASKETS_STARS_ERRORS.two
          ? 2
          : 1;

  return {
    score: correct,
    maxScore: total,
    percent: percentOf(correct, total),
    stars,
    detail: {
      correct,
      wrong: total - correct,
      total,
      errors,
    },
    wrongItemIds: config.items
      .filter((item) => {
        if (!isPlaceable(item)) return false;
        const a = byItem.get(item.id);
        return !a || !acceptedBuckets(item).includes(a.chosenBucket ?? "");
      })
      .map((item) => item.id),
  };
}

/** Карточка, у которой есть «своя» корзина (ловушки сюда не входят). */
function isPlaceable(item: InteractiveItem): boolean {
  return item.isTrap !== true && typeof item.correctBucket === "string" && item.correctBucket !== "";
}

/** Корзины, в которые карточку можно положить правильно (1 или несколько). */
function acceptedBuckets(item: InteractiveItem): string[] {
  if (typeof item.correctBucket !== "string" || !item.correctBucket) return [];
  return item.correctBucket
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
}

/* ─── 3. Прыг по правде (ТЗ §2.4) ───────────────────────────────────────── */

/**
 * ```
 * claims_correct = число верных ответов
 * claims_wrong   = число неверных
 * moves          = число бросков
 * percent        = round(100 * claims_correct / (claims_correct + claims_wrong))
 * finish_time_s  = финиш − старт (nullable, если не дошёл)
 * ```
 *
 * Знаменатель — ОТВЕТЫ, а не число утверждений: неотвеченные клетки не портят
 * процент ученику, который дошёл не до конца поля. `finish_time_s` сюда не
 * входит — это длительность попытки, её считает оболочка (`durationS`,
 * `null`, если ученик не дошёл).
 */
export function scoreJumpTruth(input: ScoringInput): InteractiveScore {
  const config = input.config;
  const byItem = latestByItem(config.items, input.answers);

  let claimsCorrect = 0;
  let claimsWrong = 0;

  for (const item of config.items) {
    const answer = byItem.get(item.id);
    if (!answer || typeof answer.chosenTrue !== "boolean") continue;
    if (typeof item.isTrue !== "boolean") continue;
    if (answer.chosenTrue === item.isTrue) claimsCorrect += 1;
    else claimsWrong += 1;
  }

  const percent = percentOf(claimsCorrect, claimsCorrect + claimsWrong);

  return {
    score: claimsCorrect,
    maxScore: config.items.length,
    percent,
    stars: starsFromPercent(percent, claimsCorrect + claimsWrong),
    detail: {
      correct: claimsCorrect,
      wrong: claimsWrong,
      total: config.items.length,
      moves: Math.max(0, Math.round(input.moves ?? 0)),
    },
    wrongItemIds: config.items
      .filter((item) => {
        const a = byItem.get(item.id);
        if (typeof item.isTrue !== "boolean") return true;
        return !a || typeof a.chosenTrue !== "boolean" || a.chosenTrue !== item.isTrue;
      })
      .map((item) => item.id),
  };
}

/* ─── 4. Колесо фортуны (ТЗ §2.5) ────────────────────────────────────────── */

/**
 * ```
 * sector_progress = { "Сложение": 3/5, ... }
 * score           = число правильных ответов
 * percent         = round(100 * score / total_questions)
 * stars           = все секторы пройдены ? 3 : score/total > 0.6 ? 2 : 1
 * ```
 *
 * «Сектор пройден» = из него отвечено столько, сколько в нём вопросов.
 * Вопрос, на который ученик ответил неверно, ТЗ §2.5 засчитывает как ПРОЙДЕННЫЙ
 * (без очка) — поэтому `done` считаем по факту ответа, а не по правильности.
 */
export function scoreFortuneWheel(input: ScoringInput): InteractiveScore {
  const config = input.config;
  const options = normalizeOptions("fortune-wheel", config.options) as FortuneWheelOptions;
  const byItem = latestByItem(config.items, input.answers);

  const total = config.items.length;
  let score = 0;
  const sectorProgress: Record<string, { done: number; total: number }> = {};
  for (const sector of options.sectors) sectorProgress[sector] = { done: 0, total: 0 };

  for (const item of config.items) {
    const sector = item.bucket ?? "";
    if (sector && !sectorProgress[sector]) sectorProgress[sector] = { done: 0, total: 0 };
    const bucket = sectorProgress[sector];
    if (!bucket) continue;
    bucket.total += 1;

    const answer = byItem.get(item.id);
    if (!answer || typeof answer.chosenIndex !== "number") continue;
    bucket.done += 1;
    if (isChoiceCorrect(item, answer)) score += 1;
  }

  const allSectorsDone =
    Object.values(sectorProgress).length > 0 &&
    Object.values(sectorProgress).every((s) => s.total > 0 && s.done >= s.total);
  const ratio = total > 0 ? score / total : 0;

  return {
    score,
    maxScore: total,
    percent: percentOf(score, total),
    stars:
      total === 0 ? 0 : allSectorsDone ? 3 : ratio > WHEEL_STARS_RATIO ? 2 : 1,
    detail: {
      correct: score,
      wrong: total - score,
      total,
      sectorProgress,
      playerScores: input.playerScores,
      ratio,
    },
    wrongItemIds: config.items
      .filter((item) => {
        const a = byItem.get(item.id);
        return !a || typeof a.chosenIndex !== "number" || !isChoiceCorrect(item, a);
      })
      .map((item) => item.id),
  };
}

/* ─── 5. Своя игра (ТЗ §2.6) ────────────────────────────────────────────── */

/**
 * ```
 * player_scores = { "Иван": 700, "Маша": 500 }
 * winner        = argmax(player_scores)
 * percent       = round(100 * правильных / всего клеток)
 * ```
 *
 * Про `score`: в колонку D1 пишем счёт ПОБЕДИТЕЛЯ — иначе в очереди из трёх
 * игроков строка попытки была бы бессмысленной. `maxScore` = сумма стоимостей
 * всех клеток доски.
 */
export function scoreJeopardy(input: ScoringInput): InteractiveScore {
  const config = input.config;
  const byItem = latestByItem(config.items, input.answers);

  let correct = 0;
  for (const item of config.items) {
    const a = byItem.get(item.id);
    if (a && isChoiceCorrect(item, a)) correct += 1;
  }

  const cells = config.items.length;
  const playerScores = { ...(input.playerScores ?? {}) };
  const answered = config.items.filter((i) => byItem.has(i.id)).length;
  const percent = percentOf(correct, cells);
  const maxScore = config.items.reduce((sum, item) => sum + (item.points ?? 0), 0);

  return {
    score: playerScoreOfWinner(playerScores),
    maxScore,
    percent,
    stars: starsFromPercent(percent, answered),
    detail: {
      correct,
      wrong: cells - correct,
      total: cells,
      playerScores,
      winner: winnerOf(playerScores),
    },
    wrongItemIds: config.items
      .filter((item) => {
        const a = byItem.get(item.id);
        return !a || !isChoiceCorrect(item, a);
      })
      .map((item) => item.id),
  };
}

/**
 * Победитель — argmax по сумме очков. При равенстве побеждает тот, кто встал
 * раньше в объекте: порядок ключей = порядок ввода имён на экране, это
 * предсказуемо для учителя, в отличие от «последнего в объекте».
 */
export function winnerOf(playerScores: Record<string, number>): string | null {
  let winner: string | null = null;
  let best = 0;
  for (const [name, raw] of Object.entries(playerScores)) {
    const value = Number.isFinite(raw) ? raw : 0;
    if (winner === null || value > best) {
      winner = name;
      best = value;
    }
  }
  return winner;
}

function playerScoreOfWinner(playerScores: Record<string, number>): number {
  const winner = winnerOf(playerScores);
  if (winner === null) return 0;
  const value = playerScores[winner];
  return Number.isFinite(value) ? value : 0;
}

/* ─── 6. Сортировка (ТЗ §2.7) ───────────────────────────────────────────── */

/**
 * ```
 * positions_correct = |{i : order[i] == correct_order[i]}|
 * percent           = round(100 * positions_correct / n)
 * ```
 *
 * Эталонный порядок собирается из `orderIndex` (0-based). Если ранклер
 * проставил индексы не подряд (0, 2, 5) — сортируем по значению, пропусков
 * не бывает: «позиция» здесь это место в ОТСОРТИРОВАННОМ списке, иначе ученику
 * невозможно попасть ни в одну позицию правильно.
 *
 * Ответ ученика приходит одним списком `chosenOrder` (id в его порядке) —
 * берём самый длинный, при равенстве последний: это финальная раскладка.
 */
export function scoreSortSequence(input: ScoringInput): InteractiveScore {
  const config = input.config;

  const correctOrder = config.items
    .slice()
    .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0))
    .map((item) => item.id);

  const chosenOrder = longestOrder(input.answers);
  const n = config.items.length;

  let positionsCorrect = 0;
  for (let i = 0; i < n; i += 1) {
    if (chosenOrder[i] === correctOrder[i]) positionsCorrect += 1;
  }

  const percent = percentOf(positionsCorrect, n);

  return {
    score: positionsCorrect,
    maxScore: n,
    percent,
    // Пустой порядок — «нечего оценивать», 0 звёзд (как на сервере).
    stars: starsFromPercent(percent, chosenOrder.length > 0 ? n : 0),
    detail: {
      correct: positionsCorrect,
      wrong: n - positionsCorrect,
      total: n,
      positionsCorrect,
    },
    wrongItemIds: [],
  };
}

function longestOrder(answers: ClientAttemptAnswer[]): string[] {
  let best: string[] = [];
  for (const a of answers) {
    if (!a || !Array.isArray(a.chosenOrder)) continue;
    if (a.chosenOrder.length >= best.length) best = a.chosenOrder;
  }
  return best;
}

/* ─── Диспетчер ──────────────────────────────────────────────────────────── */

/**
 * Подсчёт по формату. `switch` исчерпывающий: седьмой формат заставит TS
 * обновить и здесь, и в `InteractivePlayer.tsx` — нельзя забыть формат
 * в одном месте и не заметить в другом.
 */
export function scoreInteractive(
  format: InteractiveFormat,
  input: ScoringInput,
): InteractiveScore {
  switch (format) {
    case "quiz-race":
      return scoreQuizRace(input);
    case "sort-baskets":
      return scoreSortBaskets(input);
    case "jump-truth":
      return scoreJumpTruth(input);
    case "fortune-wheel":
      return scoreFortuneWheel(input);
    case "jeopardy":
      return scoreJeopardy(input);
    case "sort-sequence":
      return scoreSortSequence(input);
    default: {
      const _exhaustive: never = format;
      throw new Error(`Unknown interactive format: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Максимум баллов по конфигу — для показа учителю ДО выдачи ссылки
 * («максимум 1500 баллов») и для sanity-check на клиенте.
 */
export function maxScoreOf(config: InteractiveConfig): number {
  const input: ScoringInput = { config, answers: [] };
  switch (config.format) {
    case "quiz-race":
      return scoreQuizRace(input).maxScore;
    case "jeopardy":
      return config.items.reduce((sum, item) => sum + (item.points ?? 0), 0);
    case "sort-baskets":
      return config.items.filter(isPlaceable).length;
    case "sort-sequence":
      return config.items.length;
    default:
      return config.items.length;
  }
}

/* ─── Экран итога: тексты для ученика ────────────────────────────────────── */

/**
 * Сводка результата словами — по одному случаю на формат, тем же исчерпывающим
 * `switch`. Ученику не нужны счётчики скоринга, ему нужна фраза: «7 из 10
 * карточек на своих местах», а не «correct=7, total=10».
 */
export function scoreSummary(
  format: InteractiveFormat,
  score: InteractiveScore,
): { headline: string; details: string[] } {
  const { detail } = score;
  const percent = `${score.percent}%`;

  switch (format) {
    case "quiz-race":
      return {
        headline: `${score.score} баллов из ${score.maxScore}`,
        details: [
          `Правильных ответов: ${detail.correct} из ${detail.total}`,
          `Процент: ${percent}`,
        ],
      };

    case "sort-baskets":
      return {
        headline: `${detail.correct} из ${detail.total} карточек на своих местах`,
        details: [
          `Ошибок: ${detail.errors ?? 0}`,
          `Процент: ${percent}`,
        ],
      };

    case "jump-truth":
      return {
        headline: `${detail.correct} верных утверждений`,
        details: [
          `Ошибок: ${detail.wrong}`,
          `Ходов: ${detail.moves ?? 0}`,
          `Процент: ${percent}`,
        ],
      };

    case "fortune-wheel": {
      const sectors = Object.entries(detail.sectorProgress ?? {});
      return {
        headline: `${score.score} из ${detail.total} вопросов`,
        details: [
          ...sectors.map(([name, p]) => `${name}: ${p.done} из ${p.total}`),
          `Процент: ${percent}`,
        ],
      };
    }

    case "jeopardy": {
      const players = Object.entries(detail.playerScores ?? {});
      return {
        headline: detail.winner
          ? `Победил ${detail.winner} — ${score.score} очк.`
          : `${score.score} очков`,
        details: [
          ...players.map(([name, value]) => `${name}: ${value}`),
          `Верных клеток: ${detail.correct} из ${detail.total}`,
          `Процент: ${percent}`,
        ],
      };
    }

    case "sort-sequence":
      return {
        headline: `${detail.positionsCorrect ?? 0} из ${detail.total} на своих местах`,
        details: [`Процент: ${percent}`],
      };

    default: {
      const _exhaustive: never = format;
      throw new Error(`Unknown interactive format: ${String(_exhaustive)}`);
    }
  }
}
