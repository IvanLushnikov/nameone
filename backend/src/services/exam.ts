/**
 * Сервисный слой для экзаменов (ОГЭ/ЕГЭ) — проверка ответов + сохранение попыток.
 *
 * `checkExamAnswers` — детерминированная локальная проверка (без LLM):
 *   * exact string match (после normalize)
 *   * numeric tolerance (для math)
 *   * choice: по индексу опции (A/B/C/D)
 *
 * `saveExamAttempt` — пишет событие в `events` для аналитики.
 */

import type { D1Database } from "@cloudflare/workers-types";
import type { ExamProblem, ExamProblemResult } from "../types";

export interface CheckExamArgs {
  problems: ExamProblem[];
  answers: Record<number, string>;
}

export interface CheckExamResult {
  score: number;
  maxScore: number;
  perProblem: ExamProblemResult[];
}

export function checkExamAnswers(args: CheckExamArgs): CheckExamResult {
  const perProblem: ExamProblemResult[] = [];
  let score = 0;
  let maxScore = 0;

  for (const p of args.problems) {
    maxScore += p.points;
    const userAnswer = String(args.answers[p.number] ?? "").trim();
    const correctAnswer = p.answer ?? "";

    const correct = matches(userAnswer, correctAnswer, p.type);
    const pointsEarned = correct ? p.points : 0;
    score += pointsEarned;

    perProblem.push({
      number: p.number,
      correct,
      pointsEarned,
      feedback: correct
        ? "Верно."
        : `Неверно. Правильный ответ: ${correctAnswer}.`,
    });
  }

  return { score, maxScore, perProblem };
}

function matches(userAnswer: string, correctAnswer: string, type: ExamProblem["type"]): boolean {
  if (!userAnswer || !correctAnswer) return false;

  const norm = (s: string): string =>
    s
      .toLowerCase()
      .replace(/[!?:;'"`()[\]—-]/g, "") // NB: сохраняем . , для чисел
      .replace(/\s+/g, " ")
      .trim();

  if (type === "choice") {
    // Сравниваем букву A/B/C/D или саму строку
    return norm(userAnswer) === norm(correctAnswer);
  }

  const u = norm(userAnswer);
  const c = norm(correctAnswer);

  if (u === c) return true;

  // Numeric tolerance: если обе строки можно распарсить как число — сравниваем с tolerance 1e-6
  const uNum = Number(u.replace(",", "."));
  const cNum = Number(c.replace(",", "."));
  if (Number.isFinite(uNum) && Number.isFinite(cNum)) {
    return Math.abs(uNum - cNum) < 1e-6;
  }

  // Partial match: correct answer содержится в user answer или наоборот (для подробных)
  if (u.length >= 4 && (u.includes(c) || c.includes(u))) {
    return true;
  }

  return false;
}

export async function saveExamAttempt(
  db: D1Database,
  params: {
    userId: string | null;
    examId: string;
    exam: "oge" | "ege";
    subject: string;
    score: number;
    maxScore: number;
    perProblem: ExamProblemResult[];
  },
): Promise<void> {
  const id = `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO events (id, user_id, name, data_json, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
    .bind(
      id,
      params.userId,
      "exam_completed",
      JSON.stringify({
        examId: params.examId,
        exam: params.exam,
        subject: params.subject,
        score: params.score,
        maxScore: params.maxScore,
        perProblem: params.perProblem,
      }),
      now,
    )
    .run();
}
