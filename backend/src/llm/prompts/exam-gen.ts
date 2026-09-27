/**
 * Промпты для генерации ОГЭ/ЕГЭ вариантов.
 *
 * Exam-специфика:
 *   * 2 части: Часть 1 (short-answer, базовый/профильный уровень) +
 *     Часть 2 (detailed/choice, развёрнутое решение).
 *   * Строгие time limits (ОГЭ ≈ 235 мин, ЕГЭ профильный ≈ 235 мин,
 *     базовый 180 мин — задаём duration в meta варианта).
 *   * Стиль — реальные формулировки ФИПИ, без "придуманных" номеров.
 *
 * Только Plus-план вызывает эту функцию (по routing), но мы не валидируем
 * plan внутри — это делает router.
 */

import type { ExamProblem, SubjectSlug } from "../../types";

export const EXAM_GEN_SYSTEM = `Ты — эксперт ФИПИ, который готовит реальные варианты ОГЭ и ЕГЭ для школьников.

ЖЁСТКИЕ ПРАВИЛА ОГЭ/ЕГЭ:
1. Соблюдай реальную структуру экзамена:
   - Часть 1: задания с коротким ответом (1–19 для ОГЭ, 1–21 для ЕГЭ базовый/профильный). Тип: short-answer, иногда choice.
   - Часть 2: задания с развёрнутым ответом (20–25 для ОГЭ, 22–30 для ЕГЭ профильный). Тип: detailed.
2. Каждое задание имеет РЕАЛЬНЫЙ первичный балл (1, 2 или 3 для ЕГЭ профильного; 1 или 2 для ОГЭ/ЕГЭ базового).
3. Формулировки — в стиле ФИПИ, никаких "придуманных" обозначений и контекстов. Если не знаешь реальный формат — не выдумывай, оставь generic формулировку и пометь в title.
4. Все ответы корректны. Для Части 2 давай ПОЛНОЕ развёрнутое решение в ` + "`" + `explanation` + "`" + `.
5. duration (минуты) — реальная: ОГЭ 235 мин, ЕГЭ базовый 180 мин, ЕГЭ профильный 235 мин.
6. variantNumber — указывай, что было в запросе.

ФОРМАТ ОТВЕТА — СТРОГО JSON:
{
  "id": "exam_...",
  "exam": "oge|ege",
  "subject": "...",
  "variantNumber": <number>,
  "title": "Вариант №N, <предмет>, ОГЭ/ЕГЭ <год>",
  "duration": <minutes>,
  "problems": [
    {
      "number": <integer>,
      "part": 1|2,
      "text": "...",
      "type": "short-answer|detailed|choice",
      "options": ["A","B","C","D"],      // только для choice
      "answer": "...",
      "explanation": "...",
      "points": <integer>
    }
  ]
}

БЕЗ MARKDOWN. Только один JSON-объект.`;

export interface BuildExamPromptArgs {
  exam: "oge" | "ege";
  subject: SubjectSlug;
  variantNumber: number;
}

/**
 * Собрать { system, user } для генерации экзаменационного варианта.
 *
 * Дополнительно возвращаем expectedDuration — caller подмешает его в title.
 */
export function buildExamPrompt(args: BuildExamPromptArgs): {
  system: string;
  user: string;
  expectedDuration: number;
} {
  const expectedDuration = args.exam === "oge" ? 235 : 235; // TODO: разделить базовый/профильный позже
  const user = JSON.stringify(
    {
      задача: "Сгенерируй экзаменационный вариант",
      параметры: {
        экзамен: args.exam,
        предмет: args.subject,
        номер_варианта: args.variantNumber,
      },
      структура: {
        часть_1: "short-answer / choice задания с кратким ответом",
        часть_2: "detailed задания с развёрнутым решением",
        продолжительность_мин: expectedDuration,
      },
      верни: "JSON по схеме. Без markdown.",
    },
    null,
    2,
  );

  return { system: EXAM_GEN_SYSTEM, user, expectedDuration };
}

// Re-export type alias so callers don't have to dig into types.ts.
export type { ExamProblem };
