/**
 * Разбор вопросов для беседы с учеником (TZ-17 §5.4).
 *
 * Модуль ЧИСТЫЙ: ни D1, ни R2, ни env, ни HTTP. На вход — сырой JSON от
 * текстовой LLM + выбранные задания (текст, эталон, ответ ученика, вердикт).
 * На выходе — типизированный список вопросов и список отбракованных. Так его
 * можно тестировать без сети и без ключей, ровно как `photoCheckGrading.ts`.
 *
 * ── Правила честности ───────────────────────────────────────────────────────
 * 1. Модель вернула 3 вопроса из 5 заданий → отдаём 3. НЕ добиваем шаблонами
 *    и НЕ дублируем: учитель должен знать, что три вопроса — это три.
 * 2. Вопрос, внутри которого проговорился правильный ответ, ВЫБРАСЫВАЕТСЯ
 *    (причина LEAKS_ANSWER). Это второй рубеж после запрета в промпте: учитель
 *    печатает блок и раздаёт классу, вопрос-подсказка ломает фичу быстрее бага.
 * 3. Модель вернула мусор → пустой массив и ни одного выдуманного вопроса;
 *    вызывающий роут отдаёт 503 и не списывает квоту.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Типы
// ─────────────────────────────────────────────────────────────────────────────

import {
  buildInterviewPrompt,
  INTERVIEW_QUESTIONS_SYSTEM,
  type InterviewTask,
} from "../llm/prompts/interview-questions";

export { buildInterviewPrompt, INTERVIEW_QUESTIONS_SYSTEM };
export type { InterviewTask };

/** Позиция проверки по фото в том виде, в каком она нужна формулировке вопроса. */
export interface InterviewTaskItem extends InterviewTask {
  /** Вердикт проверки по этому заданию. Только якорь для учителя, в промпт не идёт. */
  verdict: string | null;
}

/** Готовый вопрос, который видит учитель. */
export interface InterviewQuestion {
  taskNumber: number;
  taskText: string | null;
  studentAnswer: string | null;
  question: string;
  /** Вердикт на момент генерации — чтобы учитель знал, куда смотреть. */
  verdictAtGeneration: string | null;
}

/** Почему вопрос не дошёл до учителя. */
export type DroppedReason =
  | "LEAKS_ANSWER" // внутри вопроса проговорился эталон — самый важный случай
  | "EMPTY" // пустая строка или мусор
  | "DUPLICATE" // такой же вопрос уже есть в наборе
  | "UNKNOWN_TASK" // модель спросила про задание, которого учитель не выбирал
  | "INVALID_JSON"; // ответ модели нечитаем

export interface DroppedQuestion {
  taskNumber: number | null;
  reason: DroppedReason;
  /** Обрезанный текст — для отладки качества промпта. */
  text?: string;
}

/**
 * Дисклеймер едет С СЕРВЕРА (ТЗ §5.1): при смене формулировки правим в одном
 * месте, и текст нельзя случайно потерять в вёрстке фронта.
 */
export const INTERVIEW_DISCLAIMER = "Это не проверка на списывание. Решение принимаете вы.";

/** Максимальная длина вопроса (ТЗ §5.3). */
export const MAX_QUESTION_LENGTH = 200;

/**
 * Сколько заданий отмечаем по умолчанию. Это ДЕФОЛТ, а не ограничение:
 * учитель вправе спросить про любое задание, включая верное (В-2).
 */
export const DEFAULT_TASK_PICK_LIMIT = 5;

// ─────────────────────────────────────────────────────────────────────────────
// Отбор заданий по умолчанию
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Номера заданий, отмеченных по умолчанию: где `verdict !== "correct"`, первые 5.
 *
 * ВАЖНО: это только стартовое состояние чекбоксов на фронте, а не фильтр роута.
 * Ранжировать задания по «подозрительности» запрещено (ТЗ §3.2) — отбор только
 * явный, руками учителя.
 */
export function pickDefaultTaskNumbers(
  items: Array<{ number: number; verdict: string | null }>,
  limit: number = DEFAULT_TASK_PICK_LIMIT,
): number[] {
  return items
    .filter((i) => i.verdict !== "correct")
    .map((i) => i.number)
    .sort((a, b) => a - b)
    .slice(0, Math.max(0, limit));
}

// ─────────────────────────────────────────────────────────────────────────────
// Чистка текста вопроса
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Привести строку вопроса к виду, пригодному для показа учителю: снять
 * markdown-обвязку, схлопнуть пробелы, обрезать до 200 знаков.
 *
 * Возвращает null, если после чистки ничего не осталось — такой вопрос
 * вызывающий роут отбрасывает, а не показывает пустую строку.
 */
export function sanitizeQuestion(text: string | null | undefined): string | null {
  if (typeof text !== "string") return null;

  let s = text.trim();
  if (!s) return null;

  // markdown-обёртка целиком: ```…```
  s = s.replace(/^```[a-z]*\s*/i, "").replace(/```$/, "").trim();
  // маркер списка в начале: «- », «• », «3. », «3) », «* »
  s = s.replace(/^(?:[-•*—–]|\d+[.)])\s+/, "").trim();
  // выделение внутри: **жирный**, `код`
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1");
  // обрамляющие кавычки — вопрос читается вслух, кавычки в тексте лишние
  s = s.replace(/^[«"'„]+/, "").replace(/[»"'“]+$/, "").trim();
  // схлопываем пробелы и переносы строк
  s = s.replace(/\s+/g, " ").trim();
  if (!s) return null;

  if (s.length > MAX_QUESTION_LENGTH) {
    s = s.slice(0, MAX_QUESTION_LENGTH);
    // режем по последнему пробелу, чтобы не оставить обрывок слова
    const cut = s.lastIndexOf(" ");
    if (cut > MAX_QUESTION_LENGTH * 0.6) s = s.slice(0, cut);
    s = s.replace(/[\s,;:—-]+$/, "");
  }
  return s || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Детектор утечки правильного ответа
// ─────────────────────────────────────────────────────────────────────────────

/** Прямое упоминание ответа — ловим словами, даже если цифр рядом нет. */
const LEAK_PHRASES = /(правильн\w*\s+ответ|ответ\s+должен\s+быть|верный\s+ответ|эталон|неправильн\w*|ошиб(ка|и|ке|ку|ки)\s+в\s+решении)/i;

/** Приводит строку к виду для сравнения: нижний регистр, только буквы/цифры. */
function squash(value: string): string {
  return value.toLowerCase().replace(/[^0-9a-zа-яё]+/gi, "");
}

/** Слова и числа вопроса — по ним ищем эталон, чтобы «10» не нашлось в «100». */
function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^0-9a-zа-яё]+/i)
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Эталон проговорился в вопросе?
 *
 * Две проверки, потому что ложное срабатывание здесь дорого:
 *  - числа сравниваем ЦЕЛЫМИ токенаМИ: «10» не должен ловиться в «100», но
 *    должен ловиться в «Почему ты написал 10?». Слишком короткие эталоны
 *    (одна буква) не проверяем вовсе — иначе вылетел бы вопрос «Как ты это
 *    получил?» из-за буквы «а» в любом слове;
 *  - текстовый эталон ищем по «склеенному» тексту, от 4 знаков.
 */
export function leaksExpectedAnswer(question: string, expected: string | null): boolean {
  if (LEAK_PHRASES.test(question)) return true;
  const exp = (expected ?? "").trim();
  if (!exp) return false;

  const expTokens = tokenize(exp);
  const qTokens = new Set(tokenize(question));
  const isPureNumber = expTokens.length > 0 && expTokens.every((t) => /^[0-9]+(?:[.,][0-9]+)?$/.test(t));

  // 1) Чисто числовой эталон — строго по ЦЕЛЫМ токенам. Иначе «10» нашлось бы
  //    внутри «100» и мы бы выкидывали нормальные вопросы.
  if (isPureNumber) {
    return expTokens.some((t) => qTokens.has(t) || qTokens.has(t.replace(/[.,]/g, "")));
  }

  // 2) Смешанный эталон («11/12», «2x+3») — числа от двух знаков и выше:
  //    «12» из эталона «11/12» в вопросе означает утечку.
  if (expTokens.some((t) => /^[0-9]{2,}$/.test(t) && qTokens.has(t))) return true;

  // 3) Текстовый эталон — по «склеенному» тексту, от 4 знаков. Короткие эталоны
  //    (одна буква) не проверяем: «а» нашлось бы в каждом слове вопроса.
  const expSquashed = squash(exp);
  return expSquashed.length >= 4 && squash(question).includes(expSquashed);
}

// ─────────────────────────────────────────────────────────────────────────────
// Разбор ответа модели
// ─────────────────────────────────────────────────────────────────────────────

/** Обёртка ```json и хвост после JSON — модели лепят их даже когда просят JSON. */
function extractJson(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const body = fenced?.[1]?.trim() ?? trimmed;
  const start = body.indexOf("{");
  if (start === -1) return null;
  const end = body.lastIndexOf("}");
  if (end <= start) return null;
  return body.slice(start, end + 1);
}

function safeParse(raw: string): { questions?: unknown[] } | null {
  const json = extractJson(raw);
  if (!json) return null;
  try {
    const v = JSON.parse(json) as unknown;
    return v && typeof v === "object" ? (v as { questions?: unknown[] }) : null;
  } catch {
    return null;
  }
}

function toText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const s = value.trim();
    return s === "" ? null : s;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function toTaskNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * Разобрать ответ модели в список вопросов + список отбракованных.
 *
 * Возвращает столько вопросов, сколько модель реально дала: меньше заданий —
 * значит меньше вопросов, добивать нечем (ТЗ §5.4).
 */
export function parseInterviewQuestions(
  raw: string,
  tasks: InterviewTaskItem[],
): { questions: InterviewQuestion[]; dropped: DroppedQuestion[] } {
  const byNumber = new Map(tasks.map((t) => [t.number, t]));
  const parsed = safeParse(raw);
  const modelQuestions: unknown[] = Array.isArray(parsed?.questions) ? parsed.questions : [];

  if (!parsed) {
    return { questions: [], dropped: [{ taskNumber: null, reason: "INVALID_JSON" }] };
  }

  const questions: InterviewQuestion[] = [];
  const dropped: DroppedQuestion[] = [];
  const seen = new Set<string>();
  const usedNumbers = new Set<number>();

  for (const entry of modelQuestions) {
    const rec = (entry ?? {}) as Record<string, unknown>;
    const taskNumber = toTaskNumber(rec.number ?? rec.taskNumber);
    const rawText = toText(rec.question);

    // Вопрос про задание, которое учитель не выбирал, — в набор не идёт.
    if (taskNumber === null || !byNumber.has(taskNumber)) {
      dropped.push({ taskNumber, reason: "UNKNOWN_TASK", text: rawText ?? undefined });
      continue;
    }

    const question = sanitizeQuestion(rawText);
    if (!question) {
      dropped.push({ taskNumber, reason: "EMPTY" });
      continue;
    }

    const task = byNumber.get(taskNumber)!;
    if (leaksExpectedAnswer(question, task.expected)) {
      dropped.push({ taskNumber, reason: "LEAKS_ANSWER", text: question });
      continue;
    }

    // Один вопрос на задание + защита от одинаковых формулировок.
    const key = squash(question);
    if (usedNumbers.has(taskNumber) || seen.has(key)) {
      dropped.push({ taskNumber, reason: "DUPLICATE", text: question });
      continue;
    }
    usedNumbers.add(taskNumber);
    seen.add(key);

    questions.push({
      taskNumber,
      taskText: task.taskText,
      studentAnswer: task.studentAnswer,
      question,
      verdictAtGeneration: task.verdict,
    });
  }

  // Стабильный порядок — по номеру задания, как в таблице результатов.
  questions.sort((a, b) => a.taskNumber - b.taskNumber);
  return { questions, dropped };
}
