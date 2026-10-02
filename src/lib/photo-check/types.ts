/**
 * DTO проверки работ по фото (TZ-11 §4.5).
 *
 * Зеркалят ответ бэка `backend/src/routes/f06.ts`. Отдельный файл, а не append
 * в `src/lib/types.ts`: тот файл — общий конструкторский контракт, и его
 * владелец (ТЗ-16) прямо запретил туда лезть. Здесь только фото-фича.
 */

/** Что сделала модель с заданием. `unclear` ≠ `incorrect` — это ключевое. */
export type PhotoVerdict = "correct" | "incorrect" | "unclear";

/** Эталонное задание — уходит в запрос и приходит обратно в результате. */
export interface PhotoCheckTask {
  number: number;
  taskText: string;
  correctAnswer: string;
  maxPoints: number;
}

/** Вердикт по одному заданию в результате проверки. */
export interface PhotoCheckItem {
  number: number;
  taskText: string;
  expected: string;
  studentAnswer: string | null;
  /** Дублирует verdict как boolean — фронт рисует галочку/крестик по нему. */
  correct: boolean;
  verdict: PhotoVerdict;
  pointsAwarded: number;
  maxPoints: number;
  confidence: number | null;
  needsReview: boolean;
  comment: string | null;
}

export interface Quota {
  used: number;
  limit: number;
  resetAt: number;
}

export interface PhotoCheckResult {
  ok: true;
  checkId: string;
  status: "ok" | "partial" | "failed";
  totalPoints: number;
  earnedPoints: number;
  percentage: number | null;
  gradeMark: "5" | "4" | "3" | "2" | null;
  needsReview: boolean;
  items: PhotoCheckItem[];
  model: string;
  quota: Quota;
  /** Unix seconds — когда фото будет удалено автоматически (создание + 7 дней). */
  photoDeleteAt: number;
}

/** Одна строка истории проверок. */
export interface PhotoCheckHistoryItem {
  checkId: string;
  worksheetId: string | null;
  subject: string | null;
  grade: number | null;
  status: "pending" | "ok" | "partial" | "failed";
  totalPoints: number;
  earnedPoints: number;
  percentage: number | null;
  gradeMark: string | null;
  needsReview: boolean;
  model: string | null;
  photoDeleted: boolean;
  photoDeleteAt: number | null;
  createdAt: number;
}

/** Версия текста согласия, фиксируемая вместе с загрузкой (В-2.2). */
export const CONSENT_VERSION = 1;
