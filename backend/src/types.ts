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

export interface GenerationRequest {
  subject: SubjectSlug;
  grade: number;
  topic: string;
  difficulty: Difficulty;
  count: number;
  type: TaskType;
  withAnswers: boolean;
  withExplanations: boolean;
}

export interface WorksheetTask {
  number: number;
  text: string;
  type: "computation" | "multiple-choice" | "short-answer" | "essay" | "fill-blank";
  options?: string[];
  answer?: string;
  explanation?: string;
  points: number;
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
  latencyMs: number;
  cached: boolean;
  generation: GenerationMode;
}

export interface GenerateWorksheetResponse {
  ok: true;
  worksheet: Worksheet;
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
  plan: "free" | "base" | "plus";
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
  plan: "base" | "plus";
  status: string;
  period: "monthly" | "yearly";
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
  plan: "free" | "base" | "plus";
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
  plan: "base" | "plus";
  period: "monthly" | "yearly";
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
