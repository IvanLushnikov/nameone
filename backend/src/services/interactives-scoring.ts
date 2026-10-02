/**
 * Серверный скоринг интерактивов (TZ-13 §2, §4.7).
 *
 * ═══ ЗАЧЕМ ЭТОТ ФАЙЛ ═══
 * Главная угроза фиче — подмена баллов. Ученик играет в браузере, значит у него
 * есть консоль, DevTools и все ответы в памяти. Поэтому клиентские `score`,
 * `percent` и `stars` из тела `submit` НИКОГДА не попадают в D1: их значения
 * пересчитываются здесь, из `config_json`, который лежит на сервере.
 *
 * Единственный «недоверенный» вход — ответы ученика (что он выбрал). Всё
 * остальное — эталон.
 *
 * ═══ ЧИСТОТА МОДУЛЯ ═══
 * Ни D1, ни HTTP, ни даты, ни Math.random. Только чистые функции:
 *   - один и тот же вход → один и тот же выход (важно для тестов и кэша);
 *   - входные данные НЕ мутируются (объекты и массивы читаются, копии не
 *     разрушаются) — иначе скоринг во время ручки развалил бы конфиг,
 *     который потом уходит ученику.
 *
 * Формулы взяты из ТЗ §2 дословно. Где ТЗ не задаёт формулу (звёзды для
 * quiz-race / jump-truth / jeopardy / sort-sequence), это помечено в коде
 * «ТЗ не задаёт» и выбрано правило по проценту.
 */

import type {
  AttemptAnswer,
  InteractiveConfig,
  InteractiveFormat,
  InteractiveItem,
  InteractiveOptions,
  InteractiveScore,
  ItemResult,
} from "../lib/interactives/types";

// ─────────────────────────────────────────────────────────────────────────────
// Константы механики
// ─────────────────────────────────────────────────────────────────────────────

/** Базовая стоимость правильного ответа в quiz-race (ТЗ §2.2). */
const QUIZ_BASE_POINTS = 100;
/** Максимальный бонус за скорость в quiz-race: `round(50 * remaining/total)` (ТЗ §2.2). */
const QUIZ_SPEED_BONUS = 50;

/** Пороги звёзд по проценту — там, где ТЗ не задал своих (см. комментарии ниже). */
const STAR3_PERCENT = 80;
const STAR2_PERCENT = 50;

// ─────────────────────────────────────────────────────────────────────────────
// Внутренние утилиты
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Округление как в ТЗ (`round(...)`) с защитой от NaN.
 * `Math.round(-0)` даёт -0, поэтому нормализуем и ноль, и не-числа.
 */
function pct(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }
  const v = Math.round((100 * numerator) / denominator);
  return v < 0 ? 0 : v;
}

/** Целое число ≥ 0, иначе 0. Режет NaN/Infinity/дробные/отрицательные значения. */
function nonNegInt(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

/** Валидный ли индекс варианта для этого задания. */
function isValidChoice(item: InteractiveItem, chosen: unknown): chosen is number {
  if (typeof chosen !== "number" || !Number.isInteger(chosen)) return false;
  const n = item.options?.length ?? 0;
  return chosen >= 0 && chosen < n;
}

/** Правильность ответа с вариантами: индекс совпал с эталоном. */
function isChoiceCorrect(item: InteractiveItem, chosen: unknown): boolean {
  return isValidChoice(item, chosen) && chosen === item.correctIndex;
}

/** Индекс задания в конфиге. Строим Map один раз на попытку. */
function indexItems(config: InteractiveConfig): Map<string, InteractiveItem> {
  const map = new Map<string, InteractiveItem>();
  for (const item of config.items) {
    // Дубли id от LLM: оставляем ПЕРВЫЙ — иначе порядок ответа решил бы результат.
    if (!map.has(item.id)) map.set(item.id, item);
  }
  return map;
}

/** Пометить id проваленного задания (для «топ проваленных вопросов» учителя). */
function markWrong(wrong: string[], itemId: string): void {
  if (!wrong.includes(itemId)) wrong.push(itemId);
}

/**
 * Записать вердикт по одному заданию.
 *
 * Вызывается из тех же циклов, что и начисление очков, поэтому `itemResults`
 * физически не может разойтись с `score`/`percent` — отдельного «второго
 * мнения» по конфигу нет.
 */
function judge(results: ItemResult[], itemId: string, correct: boolean): void {
  results.push({ itemId, correct });
}

/**
 * Звёзды по проценту — запасное правило для форматов, где ТЗ §2 свои звёзды
 * не задал (quiz-race, jump-truth, jeopardy, sort-sequence).
 * 0 ответов → 0 звёзд (не «одна звезда за пустой лист»).
 */
function starsByPercent(percent: number, answered: number): number {
  if (answered <= 0) return 0;
  if (percent >= STAR3_PERCENT) return 3;
  if (percent >= STAR2_PERCENT) return 2;
  return 1;
}

/** Прочитать число из options формата с безопасным дефолтом. */
function optNumber(options: InteractiveOptions, key: string, fallback: number): number {
  const raw = options[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
}

// ─────────────────────────────────────────────────────────────────────────────
// Формат 1. Викторина-гонка (quiz-race) — ТЗ §2.2
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ```
 * score      = Σ очков за правильные ответы (base 100 + бонус за скорость)
 * percent    = round(100 * correct / answered)
 * ```
 *
 * Бонус за скорость: `round(50 * remaining / total)`, где `remaining` — остаток
 * таймера. Таймер берётся из `options.secondsPerItem`; 0 или отсутствие =
 * без таймера, бонус всегда 0.
 *
 * `maxScore` = total × (100 + 50) при таймере, total × 100 без него: это
 * потолок, который ученик получит, ответив всё верно мгновенно.
 */
export function scoreQuizRace(
  config: InteractiveConfig,
  answers: AttemptAnswer[],
): InteractiveScore {
  const items = indexItems(config);
  const perItemSeconds = optNumber(config.options, "secondsPerItem", 0);
  const timerMs = perItemSeconds > 0 ? perItemSeconds * 1000 : 0;

  let score = 0;
  let correct = 0;
  let wrong = 0;
  let answered = 0;
  const wrongItemIds: string[] = [];
  const itemResults: ItemResult[] = [];

  for (const answer of answers) {
    const item = items.get(answer.itemId);
    if (!item) continue; // id не из нашего конфига — выкидываем, не считаем
    if (!isValidChoice(item, answer.chosenIndex)) continue; // ответа нет / мусор

    answered++;
    if (!isChoiceCorrect(item, answer.chosenIndex)) {
      wrong++;
      markWrong(wrongItemIds, item.id);
      judge(itemResults, item.id, false);
      continue;
    }

    correct++;
    judge(itemResults, item.id, true);
    const base = typeof item.points === "number" && item.points > 0 ? item.points : QUIZ_BASE_POINTS;
    let points = base;
    if (timerMs > 0) {
      // ms клиент присылает сам, но бонус ограничен сверху, поэтому «украсть»
      // им очки нельзя: максимум — base + 50 за мгновенный ответ.
      const spent = Math.min(Math.max(nonNegInt(answer.ms), 0), timerMs);
      const remaining = timerMs - spent;
      points += Math.round((QUIZ_SPEED_BONUS * remaining) / timerMs);
    }
    // Второй вариант по ТЗ §2.2 режет очки вдвое. Подсказка клиента может
    // только уменьшить балл, поэтому даже обман тут невыгоден.
    if (answer.secondTry === true) {
      points = Math.floor(points / 2);
    }
    score += points;
  }

  const total = config.items.length;
  const maxScore = total * (timerMs > 0 ? QUIZ_BASE_POINTS + QUIZ_SPEED_BONUS : QUIZ_BASE_POINTS);
  const percent = pct(correct, answered);

  return {
    score,
    maxScore,
    percent,
    // ТЗ §2.2 звёзды для quiz-race не задаёт — считаем по проценту.
    stars: starsByPercent(percent, answered),
    detail: { correct, wrong, total, ratio: answered > 0 ? correct / answered : 0 },
    wrongItemIds,
    itemResults,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Формат 2. Группировка по корзинам (sort-baskets) — ТЗ §2.3
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ```
 * correct = число карточек, попавших в свою корзину
 * errors  = число неверных попыток
 * percent = round(100 * correct / total)
 * stars   = errors <= 2 ? 3 : errors <= 5 ? 2 : 1
 * ```
 *
 * `total` — число карточек, у которых вообще есть куда класть (есть
 * `correctBucket` и это не ловушка). Ловушка (`isTrap`) правильной корзины не
 * имеет: положив её куда угодно, ученик получает ошибку, а не очко.
 * Незаполненная карточка ошибкой НЕ считается — ошибка это именно попытка
 * положить не туда (ТЗ §2.3: «карточка не исчезает, можно перетащить ещё раз»).
 */
export function scoreSortBaskets(
  config: InteractiveConfig,
  answers: AttemptAnswer[],
): InteractiveScore {
  const items = indexItems(config);
  const placeable = config.items.filter((i) => !i.isTrap && typeof i.correctBucket === "string");

  let correct = 0;
  let errors = 0;
  let wrong = 0;
  const wrongItemIds: string[] = [];
  const itemResults: ItemResult[] = [];

  for (const answer of answers) {
    const item = items.get(answer.itemId);
    if (!item) continue;
    if (typeof answer.chosenBucket !== "string" || answer.chosenBucket === "") continue;

    if (item.correctBucket !== undefined && item.correctBucket === answer.chosenBucket) {
      correct++;
      judge(itemResults, item.id, true);
    } else {
      errors++;
      wrong++;
      markWrong(wrongItemIds, item.id);
      judge(itemResults, item.id, false);
    }
  }

  const total = placeable.length;
  const percent = pct(correct, total);
  // Звёзды ТЗ §2.3 считаются от числа ошибок, а не от процента.
  const stars = total === 0 ? 0 : errors <= 2 ? 3 : errors <= 5 ? 2 : 1;

  return {
    score: correct,
    maxScore: total,
    percent,
    stars,
    detail: { correct, wrong, total, errors },
    wrongItemIds,
    itemResults,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Формат 3. Прыг по правде (jump-truth) — ТЗ §2.4
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ```
 * claims_correct = число верных ответов
 * claims_wrong   = число неверных
 * moves          = число бросков
 * percent        = round(100 * claims_correct / (claims_correct + claims_wrong))
 * ```
 *
 * Делитель — именно сумма верных и неверных, а не число заданий: неполный
 * лист не должен штрафоваться. Если не отвечено ни разу — 0%, а не NaN.
 *
 * `moves` = число зарегистрированных ходов (ответов). Время финиша
 * (`finish_time_s`) приходит от клиента и сервером не проверяется: длительность
 * попытки хранится как `duration_s` и в расчёт баллов не входит.
 */
export function scoreJumpTruth(
  config: InteractiveConfig,
  answers: AttemptAnswer[],
): InteractiveScore {
  const items = indexItems(config);

  let correct = 0;
  let wrong = 0;
  let moves = 0;
  const wrongItemIds: string[] = [];
  const itemResults: ItemResult[] = [];

  for (const answer of answers) {
    const item = items.get(answer.itemId);
    if (!item) continue;
    if (typeof item.isTrue !== "boolean") continue; // не утверждение — не ход
    if (typeof answer.chosenTrue !== "boolean") continue; // хода не было

    moves++;
    if (answer.chosenTrue === item.isTrue) {
      correct++;
      judge(itemResults, item.id, true);
    } else {
      wrong++;
      markWrong(wrongItemIds, item.id);
      judge(itemResults, item.id, false);
    }
  }

  const total = config.items.length;
  const judged = correct + wrong;
  const percent = pct(correct, judged);

  return {
    score: correct,
    maxScore: total,
    percent,
    // ТЗ §2.4 звёзды не задаёт — по проценту.
    stars: starsByPercent(percent, judged),
    detail: { correct, wrong, total, moves },
    wrongItemIds,
    itemResults,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Формат 4. Колесо фортуны (fortune-wheel) — ТЗ §2.5
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ```
 * sector_progress = { "Сложение": 3/5, ... }
 * score           = число правильных ответов
 * percent         = round(100 * score / total_questions)
 * stars           = все секторы пройдены ? 3 : score/total > 0.6 ? 2 : 1
 * ```
 *
 * «Сектор пройден» = все его вопросы закрыты (на любой ответ: правильный
 * засчитывается, неправильный тоже закрывает вопрос — ТЗ §2.5 «вопрос
 * засчитывается как пройденный, но без очка»).
 *
 * Важно: `total_questions` в формуле — это ВСЕ вопросы конфига, а не
 * отвеченные. Иначе «ответил на один вопрос из двадцати и угадал» дало бы
 * 100%. Проваленный незакрытый вопрос — это и есть «доля 0».
 */
export function scoreFortuneWheel(
  config: InteractiveConfig,
  answers: AttemptAnswer[],
): InteractiveScore {
  const items = indexItems(config);
  const total = config.items.length;

  // Секторы: сколько всего вопросов в каждом (из конфига, не из ответов).
  const sectorTotals = new Map<string, number>();
  for (const item of config.items) {
    if (typeof item.bucket !== "string" || item.bucket === "") continue;
    sectorTotals.set(item.bucket, (sectorTotals.get(item.bucket) ?? 0) + 1);
  }

  let correct = 0;
  let wrong = 0;
  const closedBySector = new Map<string, number>();
  const wrongItemIds: string[] = [];
  const itemResults: ItemResult[] = [];

  for (const answer of answers) {
    const item = items.get(answer.itemId);
    if (!item) continue;
    if (!isValidChoice(item, answer.chosenIndex)) continue;

    if (typeof item.bucket === "string" && item.bucket !== "") {
      closedBySector.set(item.bucket, (closedBySector.get(item.bucket) ?? 0) + 1);
    }
    if (isChoiceCorrect(item, answer.chosenIndex)) {
      correct++;
      judge(itemResults, item.id, true);
    } else {
      wrong++;
      markWrong(wrongItemIds, item.id);
      judge(itemResults, item.id, false);
    }
  }

  const percent = pct(correct, total);
  const allSectorsClosed =
    sectorTotals.size > 0 &&
    [...sectorTotals.entries()].every(([sector, count]) => (closedBySector.get(sector) ?? 0) >= count);

  // Звёзды ТЗ §2.5. ratio — score/total, сравнение строгое «> 0.6».
  const ratio = total > 0 ? correct / total : 0;
  const stars = total === 0 ? 0 : allSectorsClosed ? 3 : ratio > 0.6 ? 2 : 1;

  const sectorProgress: Record<string, { done: number; total: number }> = {};
  for (const [sector, count] of sectorTotals) {
    sectorProgress[sector] = { done: closedBySector.get(sector) ?? 0, total: count };
  }

  return {
    score: correct,
    maxScore: total,
    percent,
    stars,
    detail: { correct, wrong, total, sectorProgress, ratio },
    wrongItemIds,
    itemResults,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Формат 5. Своя игра (jeopardy) — ТЗ §2.6
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ```
 * player_scores = { "Иван": 700, "Маша": 500 }
 * winner        = argmax(player_scores)
 * percent       = round(100 * правильных / всего клеток)
 * ```
 *
 * Очки НЕ присылаются клиентом. Засчитываются только за правильный ответ и
 * берутся из `item.points` клетки (по ТЗ это 100/200/300/400 по столбцу), так
 * что «вбить себе 4000» невозможно даже при полном доступе к DevTools.
 *
 * `maxScore` = сумма очков всех клеток доски. `winner` = argmax; при ничьей
 * берётся первый по алфавиту (результат детерминирован), при пустых очках — null.
 */
export function scoreJeopardy(
  config: InteractiveConfig,
  answers: AttemptAnswer[],
): InteractiveScore {
  const items = indexItems(config);

  let correct = 0;
  let wrong = 0;
  let answered = 0;
  let boardMax = 0;
  const wrongItemIds: string[] = [];
  const itemResults: ItemResult[] = [];

  for (const item of config.items) {
    boardMax += typeof item.points === "number" && item.points > 0 ? item.points : 0;
  }

  // playerScores — НОВЫЙ объект (вход не мутируем).
  const playerScores: Record<string, number> = {};
  const touchPlayer = (name: string): void => {
    if (playerScores[name] === undefined) playerScores[name] = 0;
  };

  for (const answer of answers) {
    const item = items.get(answer.itemId);
    if (!item) continue;
    if (!isValidChoice(item, answer.chosenIndex)) continue;

    answered++;
    const rawName = typeof answer.player === "string" ? answer.player.trim() : "";
    const player = rawName.slice(0, 60) || "player";
    if (!isChoiceCorrect(item, answer.chosenIndex)) {
      wrong++;
      markWrong(wrongItemIds, item.id);
      judge(itemResults, item.id, false);
      // В режиме «очередь» неправильный ответ уводит очки сопернику
      // (ТЗ §2.6), но ЗДЕСЬ мы не знаем, кто соперник, поэтому не уводим:
      // вычитание догадками дало бы отрицательные и нестабильные суммы.
      touchPlayer(player);
      continue;
    }
    correct++;
    touchPlayer(player);
    judge(itemResults, item.id, true);
    playerScores[player] =
      playerScores[player]! + (typeof item.points === "number" && item.points > 0 ? item.points : 0);
  }

  const total = config.items.length;
  const percent = pct(correct, total);

  let winner: string | null = null;
  let best = -1;
  for (const name of Object.keys(playerScores).sort()) {
    const value = playerScores[name] ?? 0;
    if (value > best) {
      best = value;
      winner = name;
    }
  }

  return {
    score: correct,
    maxScore: boardMax,
    percent,
    // ТЗ §2.6 звёзды не задаёт — по проценту.
    stars: starsByPercent(percent, answered),
    detail: { correct, wrong, total, playerScores, winner: winner ?? null },
    wrongItemIds,
    itemResults,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Формат 6. Сортировка / Классификация (sort-sequence) — ТЗ §2.7
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ```
 * positions_correct = |{i : order[i] == correct_order[i]}|
 * percent           = round(100 * positions_correct / n)
 * ```
 *
 * Эталонный порядок восстанавливается из `item.orderIndex` (позиция в
 * правильном порядке). Задание без `orderIndex` в эталон не входит: иначе
 * порядок был бы неоднозначен и результат зависел бы от того, как отсортирует
 * LLM.
 *
 * Ответ — массив id в порядке ученика. Сверяются только те позиции, где у
 * ученика реально есть id, и это id есть в эталоне: недостающий хвост не
 * «сдвигает» всё вперёд, но и не портит уже совпавшие позиции.
 */
export function scoreSortSequence(
  config: InteractiveConfig,
  answers: AttemptAnswer[],
): InteractiveScore {
  // Эталонный порядок: позиция → id. Дубли позиций: первая побеждает.
  const byPosition = new Map<number, string>();
  for (const item of config.items) {
    if (typeof item.orderIndex !== "number" || !Number.isInteger(item.orderIndex)) continue;
    if (item.orderIndex < 0) continue;
    if (!byPosition.has(item.orderIndex)) byPosition.set(item.orderIndex, item.id);
  }
  const expected = [...byPosition.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, id]) => id);

  // Ученик в режиме «очередь» мог прислать порядок одним массивом в любом
  // ответе — берём первый непустой.
  let chosen: string[] = [];
  for (const answer of answers) {
    if (Array.isArray(answer.chosenOrder) && answer.chosenOrder.length > 0) {
      chosen = answer.chosenOrder;
      break;
    }
  }

  const expectedSet = new Set(expected);
  const seen = new Set<string>();
  const itemResults: ItemResult[] = [];
  let positionsCorrect = 0;
  for (let i = 0; i < expected.length; i++) {
    const picked = chosen[i];
    if (typeof picked !== "string") continue;
    // Повторный id не должен засчитываться как «угадал» дважды.
    if (seen.has(picked)) continue;
    seen.add(picked);
    const expectedId = expected[i]!;
    const hit = expectedSet.has(picked) && expectedId === picked;
    if (hit) positionsCorrect++;
    // Вердикт пишем по ЭТАЛОННОМУ объекту на этой позиции: так «сложные
    // задания» у учителя считаются по тем же объектам, что и в конфиге.
    judge(itemResults, expectedId, hit);
  }

  const n = expected.length;
  const percent = pct(positionsCorrect, n);
  const wrongItemIds: string[] = [];
  for (let i = 0; i < expected.length; i++) {
    const picked = chosen[i];
    const expectedId = expected[i];
    if (expectedId !== undefined && (typeof picked !== "string" || expectedId !== picked)) {
      markWrong(wrongItemIds, expectedId);
    }
  }

  return {
    score: positionsCorrect,
    maxScore: n,
    percent,
    // ТЗ §2.7 звёзды не задаёт — по проценту.
    stars: starsByPercent(percent, chosen.length > 0 ? n : 0),
    detail: { correct: positionsCorrect, wrong: n - positionsCorrect, total: n, positionsCorrect },
    wrongItemIds,
    itemResults,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Диспетчер
// ─────────────────────────────────────────────────────────────────────────────

/** Скоринг по формату. Каждая ветка — чистая функция выше. */
const SCORERS: Record<
  InteractiveFormat,
  (config: InteractiveConfig, answers: AttemptAnswer[]) => InteractiveScore
> = {
  "quiz-race": scoreQuizRace,
  "sort-baskets": scoreSortBaskets,
  "jump-truth": scoreJumpTruth,
  "fortune-wheel": scoreFortuneWheel,
  jeopardy: scoreJeopardy,
  "sort-sequence": scoreSortSequence,
};

/**
 * Точка входа: пересчитать результат попытки из конфига.
 *
 * Неизвестный формат → нулевой результат, а не исключение: конфиг мог прийти
 * от более новой версии движка (config_schema), и падать на этом нельзя.
 */
export function scoreAttempt(
  config: InteractiveConfig,
  answers: AttemptAnswer[],
): InteractiveScore {
  const scorer = SCORERS[config.format];
  if (!scorer) {
    return {
      score: 0,
      maxScore: 0,
      percent: 0,
      stars: 0,
      detail: { correct: 0, wrong: 0, total: 0 },
      wrongItemIds: [],
      itemResults: [],
    };
  }
  return scorer(config, Array.isArray(answers) ? answers : []);
}

// ─────────────────────────────────────────────────────────────────────────────
// Детерминированная валидация конфига
// ─────────────────────────────────────────────────────────────────────────────

/** Проблема в конфиге: что не так и какой item виноват. */
export interface ConfigIssue {
  /** Короткий код для логов и телеметрии. */
  code:
    | "empty-items"
    | "duplicate-id"
    | "missing-options"
    | "no-correct"
    | "bad-correct-index"
    | "duplicate-options"
    | "missing-truth"
    | "missing-bucket"
    | "missing-order";
  /** id задания, если проблема привязана к нему. */
  itemId?: string;
  /** Человекочитаемое пояснение (ru) — показываем в логах, не ученику. */
  message: string;
}

/**
 * Детерминированная проверка конфига ПЕРЕД вызовом валидатора-LLM.
 *
 * Работает как «дешёвый фильтр»: если формат нельзя починить словами
 * (правильный вариант не существует, у утверждения нет `isTrue`), то LLM
 * тут не поможет — такие конфиги не отдаём ни ученику, ни учителю молча.
 *
 * Проверяет ровно то, что перечислил ТЗ §4.7 для валидатора:
 * правильный ответ ровно один, варианты не дублируются, утверждения
 * `jump-truth` проставлены.
 */
export function validateInteractiveConfig(config: InteractiveConfig): ConfigIssue[] {
  const issues: ConfigIssue[] = [];

  if (!Array.isArray(config.items) || config.items.length === 0) {
    issues.push({ code: "empty-items", message: "В конфиге нет ни одного задания" });
    return issues;
  }

  const seen = new Set<string>();

  for (const item of config.items) {
    if (!item.id || seen.has(item.id)) {
      issues.push({
        code: "duplicate-id",
        itemId: item.id,
        message: `Пустой или повторяющийся id задания: "${item.id ?? ""}"`,
      });
      continue;
    }
    seen.add(item.id);

    if (config.format === "jump-truth") {
      if (typeof item.isTrue !== "boolean") {
        issues.push({
          code: "missing-truth",
          itemId: item.id,
          message: "У утверждения не проставлено, правда это или ложь",
        });
      }
      continue;
    }

    if (config.format === "sort-sequence") {
      if (typeof item.orderIndex !== "number") {
        issues.push({
          code: "missing-order",
          itemId: item.id,
          message: "У объекта не задан orderIndex — эталонный порядок неоднозначен",
        });
      }
      continue;
    }

    if (config.format === "sort-baskets") {
      if (!item.isTrap && typeof item.correctBucket !== "string") {
        issues.push({
          code: "missing-bucket",
          itemId: item.id,
          message: "У карточки не указано, в какую корзину её класть",
        });
      }
      continue;
    }

    // quiz-race / fortune-wheel / jeopardy — форматы с вариантами.
    const options = item.options;
    if (!Array.isArray(options) || options.length < 2) {
      issues.push({
        code: "missing-options",
        itemId: item.id,
        message: "Нужно минимум два варианта ответа",
      });
      continue;
    }
    if (
      typeof item.correctIndex !== "number" ||
      !Number.isInteger(item.correctIndex) ||
      item.correctIndex < 0 ||
      item.correctIndex >= options.length
    ) {
      issues.push({
        code: "no-correct",
        itemId: item.id,
        message: "Не указан корректный индекс правильного варианта",
      });
    }

    const normalized = options.map((o) => String(o).trim().toLowerCase());
    if (new Set(normalized).size !== normalized.length) {
      issues.push({
        code: "duplicate-options",
        itemId: item.id,
        message: "Варианты ответа повторяются — ученику нельзя их различать",
      });
    }
  }

  return issues;
}

/** Блокирующие проблемы: такие конфиги нельзя отдавать ученику. */
export function isConfigUsable(issues: ConfigIssue[]): boolean {
  return issues.length === 0;
}
