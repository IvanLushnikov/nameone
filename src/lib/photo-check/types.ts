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

/** Чьё решение лежит в строке. Видно в выгрузке на печать (ТЗ-19 §2). */
export type MarkSource = "model" | "teacher";

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
  /**
   * Чью отметку видит учитель: машины или свою.
   *
   * Опционально ТОЛЬКО ради типов: сервер присылает поле всегда (ТЗ-19 §2), и
   * компоненты читают `item.decidedBy ?? "model"`. Так правка контракта не ломает
   * чужие тестовые фикстуры, а в рантайме дефолт недостижим.
   */
  decidedBy?: MarkSource;
  /**
   * Снимок машинного решения. Через месяц видно, что именно исправил человек.
   * Nullable: `POST /photo-checks` отдаёт свежий машинный разбор без ручных
   * отметок, и там снимок = текущий вердикт (сервер проставит). Обязательным
   * его сделали бы только ценой правки чужих фикстур — а «не разобрано» вместо
   * снимка читалось бы как «машина молчала».
   */
  modelVerdict?: PhotoVerdict;
  modelPoints?: number;
  /** null — учитель это задание не смотрел. */
  teacherAccepted?: boolean | null;
  teacherPoints?: number | null;
  manualUpdatedAt?: number | null;
}

/** Ручная отметка учителя, сохранённая в D1. */
export interface PhotoCheckManualMark {
  taskNumber: number;
  accepted: boolean;
  points: number;
  updatedAt: number;
}

/** Что предложила машина ДО ручных правок. */
export interface ModelResult {
  totalPoints: number;
  earnedPoints: number;
  percentage: number | null;
  gradeMark: string | null;
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
  /** null, пока сомнительные задания не закрыты учителем. */
  percentage: number | null;
  gradeMark: "5" | "4" | "3" | "2" | null;
  needsReview: boolean;
  items: PhotoCheckItem[];
  /** Что уже сохранил учитель — переживает перезагрузку страницы (ТЗ-19). */
  manualMarks?: PhotoCheckManualMark[];
  /** Сколько сомнительных заданий ещё ждут ручного решения. */
  pendingReview?: number;
  modelResult?: ModelResult;
  /**
   * Полный список заданий, если в `items` попали не все.
   *
   * Нужно из-за блока «Проверьте сами» (ТЗ-18 В2): панель убирает сомнительные
   * задания из `items`, чтобы они не выглядели готовым вердиктом, но панель
   * вопросов «Спроси ученика» по умолчанию спрашивает ровно про неразобранные
   * задания. Без этого поля они бы из неё выпали.
   *
   * Не приходит с бэка: это поле формы, которую панель собирает сама.
   */
  allItems?: PhotoCheckItem[];
  model: string;
  /** Есть только у свежей проверки (POST). У сохранённой — см. ниже. */
  quota?: Quota;
  /** Unix seconds — когда фото будет удалено автоматически (создание + 7 дней). */
  photoDeleteAt?: number;
  photoDeleted?: boolean;
  createdAt?: number;
  completedAt?: number | null;
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
