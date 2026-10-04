/**
 * Доверие к распознаванию: единственное место, где живёт порог уверенности
 * (TZ-18 «Деньги и доверие» §7, решение владельца №5 от 03.10.2026).
 *
 * Зачем этот файл существует. Бэкенд уже отдаёт `confidence` по каждому
 * заданию (`backend/src/routes/f06.ts:378`), но интерфейс его не смотрел:
 * неуверенное чтение выдавалось учителю за уверенное — ровно то расхождение
 * между обещанием и результатом, из-за которого теряется доверие.
 *
 * Все решения принимаются ЧИСТЫМИ функциями от `confidence`, без React и без
 * сети: их можно вызвать из панели, из теста и (позже) из отчёта по
 * распределению, и они не разойдутся между собой.
 *
 * ── Кто решает, что учителю смотреть (решение владельца, 04.10.2026) ──────
 * РЕШАЕТ СЕРВЕР. Модель распознавания отдаёт по каждому заданию признак
 * `needsReview` — «это я не уверен, нужен человек». Клиентский порог
 * `CONFIDENCE_THRESHOLD` НЕ решает, что попадёт в перепроверку: он остаётся
 * для показа (гистограмма, бейдж «ИИ уверен на 92%») и для ответа на старые
 * данные, где флага ещё нет.
 *
 * Почему так. Иначе интерфейс и база решают одно и то же по-разному, и
 * худший случай — не «лишняя строка на экране», а такой: учитель поставил
 * ручную отметку по заданию, которого сервер в разбор не отдавал, и отметка
 * молча улетела бы в никуда, а учитель так и думал, что сохранил.
 * `tests/integration/confidence-threshold-sources.test.ts` продолжает
 * сверять число на бэке и на фронте — иначе разъедутся они.
 */

import type { PhotoCheckItem, PhotoCheckManualMark } from "./types";

/** Что достаточно для показа, чтобы не уводить задание учителю. */
export type ConfidenceItem = Pick<
  PhotoCheckItem,
  "studentAnswer" | "confidence" | "verdict"
> &
  /**
   * Признак «сервер просит учителя посмотреть». Необязательный: в ответе
   * сервера он есть, в тестовых фикстурах и в очень старых сохранённых
   * результатах — может отсутствовать, тогда работает клиентский фолбэк.
   */
  Partial<Pick<PhotoCheckItem, "needsReview">>;

/**
 * Порог доверия к чтению почерка — 0.85 (решение владельца №5).
 *
 * ПОЧЕМУ ОТДЕЛЬНАЯ НАСТРОЙКА, А НЕ ЧИСЛО В КОМПОНЕНТЕ:
 *  - владелец заранее предупредил, что порог строгий и в перепроверку может
 *    попадать заметная часть работ. Значит, цифру почти наверняка придётся
 *    двигать после замера на живых фото. Менять её должно быть можно в одном
 *    месте, не залезая в вёрстку панели;
 *  - бэкенд держит такой же порог (`CONFIDENCE_THRESHOLD` в
 *    `backend/src/services/photoCheckGrading.ts`). Числа обязаны совпадать, и
 *    их сверяет `tests/integration/confidence-threshold-sources.test.ts`:
 *    проекты собираются раздельно, ни один компилятор их не сравнивает, а
 *    расхождение выглядит как «в базе одно, на экране другое».
 *  - порог НЕ решает, что попадёт в перепроверку: это делает серверный
 *    признак `needsReview`. Порог — про доверие к показам.
 */
export const CONFIDENCE_THRESHOLD = 0.85;

/** Три состояния задания с точки зрения доверия к чтению. */
export type ConfidenceState =
  /** прочитано уверенно — вердикту можно верить */
  | "confident"
  /** прочитано, но неуверенно (или модель сама сказала «не разобрал») */
  | "unsure"
  /** ответа на фото нет вообще — сравнивать не с чем */
  | "unrecognized";

/**
 * Состояние одного задания по его `confidence`.
 *
 * ПЕРВЫМ идёт сервер: если `needsReview` пришёл, вопрос закрыт, порог не
 * спрашивается. Ниже — только фолбэк для данных без флага.
 *
 * Порядок проверок важен и не переставляется:
 *  1. Нет распознанного ответа — это не «неуверенно», это «нечего проверять»:
 *     даже при confidence 1.0 модель не показала, что именно она прочитала,
 *     а значит вердикт опирается на воздух.
 *  2. Числа нет (`null` или мусор) — доверять нечему, и это НЕ «уверенность».
 *     Считать `null` за «всё хорошо» нельзя: это тихо превратит «неизвестно»
 *     в зелёную галочку, ради устранения которой эта фича и затевалась.
 *  3. Модель ответила «не разобрал» — вердикта нет, даже если confidence
 *     высокий. Показывать отсутствие вердикта как уверенный ответ нельзя.
 *  4. Дальше — простое сравнение с порогом.
 */
export function confidenceState(
  item: ConfidenceItem,
  threshold: number = CONFIDENCE_THRESHOLD,
): ConfidenceState {
  // 1) Нет распознанного ответа — это не «неуверенно», это «нечего проверять».
  //    Проверка идёт ПЕРВОЙ, до серверного признака: даже если сервер уверен,
  //    зелёная галочка на пустом месте — это ровно тот молчаливый «всё хорошо»,
  //    ради устранения которого фича и затевалась.
  if (item.studentAnswer === null) return "unrecognized";

  // ── Решение сервера ──────────────────────────────────────────────────────
  // `needsReview === true` → учитель смотрит. `false` → модель уверена.
  // Никакого сравнения с порогом: иначе интерфейс решил бы иначе, чем база, и
  // ручная отметка по «лишней» строке улетела бы в никуда.
  if (item.needsReview === true) return "unsure";
  if (item.needsReview === false) return "confident";

  // ── Фолбэк: флага нет (старые сохранённые результаты, тестовые фикстуры) ──
  if (item.confidence === null || !Number.isFinite(item.confidence)) return "unsure";
  if (item.verdict === "unclear") return "unsure";
  return item.confidence >= threshold ? "confident" : "unsure";
}

/** Короткая форма «можно ли верить этому чтению» — для условий и тестов. */
export function isConfident(
  item: ConfidenceItem,
  threshold: number = CONFIDENCE_THRESHOLD,
): boolean {
  return confidenceState(item, threshold) === "confident";
}

export interface ConfidencePartition {
  /** Прочитано уверенно — их вердиктам можно верить. */
  confident: PhotoCheckItem[];
  /** Прочитано неуверенно — учитель смотрит сам. */
  unsure: PhotoCheckItem[];
  /** Ответа на фото нет — учитель смотрит сам. */
  unrecognized: PhotoCheckItem[];
  /**
   * Всё, что уходит в блок «Проверьте сами», в исходном порядке номеров.
   * Порядок исходный, а не «сначала неуверенные»: учитель сверяет работу
   * сверху вниз, как на бумаге.
   */
  review: PhotoCheckItem[];
  /** Сколько всего заданий. */
  total: number;
  /** Какой порог применился — попадает в аналитику вместе с числами. */
  threshold: number;
}

/**
 * Разложить результат проверки на три состояния ДЛЯ ПОКАЗА.
 *
 * Что попадёт в перепроверку, решает `confidenceState`, а в ней — серверный
 * `needsReview`; `threshold` используется только там, где флага нет.
 *
 * Сомнительные и нераспознанные собираются отдельно от уверенных: показывать
 * их в общем потоке нельзя — там они выглядят как обычные строки с цифрами,
 * и учитель принимает чужую отметку за свою.
 */
export function partitionByConfidence(
  items: readonly PhotoCheckItem[],
  threshold: number = CONFIDENCE_THRESHOLD,
): ConfidencePartition {
  const confident: PhotoCheckItem[] = [];
  const unsure: PhotoCheckItem[] = [];
  const unrecognized: PhotoCheckItem[] = [];
  const review: PhotoCheckItem[] = [];

  for (const item of items) {
    const state = confidenceState(item, threshold);
    if (state === "confident") confident.push(item);
    else if (state === "unrecognized") {
      unrecognized.push(item);
      review.push(item);
    } else {
      unsure.push(item);
      review.push(item);
    }
  }

  return { confident, unsure, unrecognized, review, total: items.length, threshold };
}

/**
 * «92%» или «нет данных» — для показа учителю.
 * Отдельно от состояния: уверенность в процентах полезна и в блоке
 * перепроверки, и в будущем отчёте по порогу.
 */
export function confidencePercent(confidence: number | null): string {
  if (confidence === null || !Number.isFinite(confidence)) return "нет данных";
  return `${Math.round(confidence * 100)}%`;
}

/**
 * Распределение `confidence` по диапазонам — то самое, ради чего порог и
 * вынесен в настройку (ТЗ-18 §7, п.5: «логируем распределение по реальным
 * фото, через месяц цифры скажут, правильно ли выбран порог»).
 *
 * Считаем по ВСЕМ заданиям работы, а не только по сомнительным: иначе по
 * выборке «плохих» работ нельзя понять, много их или единицы.
 */
export function confidenceHistogram(
  items: readonly PhotoCheckItem[],
): { low: number; mid: number; high: number; top: number; unknown: number } {
  const buckets = { low: 0, mid: 0, high: 0, top: 0, unknown: 0 };
  for (const item of items) {
    const c = item.confidence;
    if (c === null || !Number.isFinite(c)) {
      buckets.unknown += 1;
    } else if (c < 0.5) {
      buckets.low += 1;
    } else if (c < 0.7) {
      buckets.mid += 1;
    } else if (c < CONFIDENCE_THRESHOLD) {
      buckets.high += 1;
    } else {
      buckets.top += 1;
    }
  }
  return buckets;
}

// ─────────────────────────────────────────────────────────────────────────────
// Разбор по ручным отметкам учителя (ТЗ-19)
// ─────────────────────────────────────────────────────────────────────────────

/** Задания, разложенные по тому, чьё это решение и что с ним делать. */
export interface ReviewPartition {
  /** Модель уверенно разобрала и учитель не смотрел — показывать можно. */
  settled: PhotoCheckItem[];
  /** Модель не уверена, и ручной отметки ещё нет. */
  needsDecision: PhotoCheckItem[];
  /** Учитель уже сохранил отметку. */
  decided: PhotoCheckItem[];
}

/** Номера заданий, по которым учитель уже сохранил отметку. */
export function decidedTaskNumbers(marks: PhotoCheckManualMark[]): Set<number> {
  return new Set(marks.map((m) => m.taskNumber));
}

/**
 * Разложить задания по трём корзинам для блока «Проверьте сами».
 *
 * `needsReview` здесь — ИТОГОВОЕ поле с сервера: после сохранения ручных
 * отметок оно уже `false` у закрытых заданий. Поэтому «модель не уверена» и
 * «учитель ещё не смотрел» — не одно и то же, и разделять их по-разному
 * нельзя: иначе в блок попадёт строка, для которой сервер отметку не ждёт,
 * и учительская отметка по ней улетит в никуда.
 */
export function partitionByDecision(
  items: PhotoCheckItem[],
  marks: PhotoCheckManualMark[],
): ReviewPartition {
  const decided = decidedTaskNumbers(marks);
  return {
    settled: items.filter((i) => !i.needsReview && !decided.has(i.number)),
    needsDecision: items.filter((i) => i.needsReview && !decided.has(i.number)),
    decided: items.filter((i) => decided.has(i.number)),
  };
}

/** Русская плюрализация: 1 задание / 2 задания / 5 заданий. */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}
