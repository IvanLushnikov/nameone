/**
 * Промпты для генерации и валидации рабочих листов.
 * Версия: 2026-09-25.
 */

import type { GenerationRequest } from "@/lib/types";

/** Системный промпт для генератора. Кэшируется в Anthropic при Plus-плане. */
export const WORKSHEET_GEN_SYSTEM = `Ты учитель-предметник с 20-летним стажем и опытный методист.
Составляешь рабочие листы для школьников 1-11 классов строго по ФГОС.

Правила:
- Терминология и формулировки соответствуют школьной программе РФ.
- Задачи разнообразные по типу: computation, multiple-choice, short-answer, essay, fill-blank.
- Сложность соответствует указанному уровню (easy/medium/hard).
- Все ответы — корректные и проверяемые.
- Никаких политических, религиозных и провокационных формулировок.
- Если тема узкая — не выдумывай, верни меньше задач с пометкой в title.
- Пиши на русском (или английском, если subject=english).
- Возвращай строго JSON, никакого markdown-обвеса.`;

interface GenPromptArgs {
  request: GenerationRequest;
}

/** Пользовательский промпт для генерации. */
export function buildWorksheetGenPrompt({ request }: GenPromptArgs): string {
  return JSON.stringify({
    задача: "Сгенерируй рабочий лист",
    subject: request.subject,
    grade: request.grade,
    topic: request.topic,
    difficulty: request.difficulty,
    count: request.count,
    type: request.type,
    withAnswers: request.withAnswers,
    withExplanations: request.withExplanations,
    требования: {
      формат: "JSON по схеме ниже",
      структура: {
        title: "string — заголовок листа",
        instructions: "string — краткая инструкция для ученика (1-2 предложения, опционально)",
        tasks: "array — массив заданий",
        каждое_задание: {
          number: "number — порядковый номер",
          text: "string — формулировка задания",
          type: "computation | multiple-choice | short-answer | essay | fill-blank",
          options: "string[] — для multiple-choice, 4 варианта",
          answer: "string — правильный ответ (если withAnswers=true)",
          explanation: "string — краткое пояснение (если withExplanations=true)",
          points: "number — баллы за задание (1-3)",
        },
      },
    },
  });
}

/** Системный промпт для валидатора (DeepSeek). */
export const WORKSHEET_VALIDATE_SYSTEM = `Ты методист-эксперт по ФГОС. Проверяешь рабочие листы и находишь проблемы.

Проверяй:
1. Дубли заданий (по смыслу, не по формулировке).
2. Корректность ответов (арифметика, грамматика, физика/химия — что применимо).
3. Соответствие сложности указанному уровню (easy/medium/hard).
4. Соответствие возрасту класса — никаких тем не по программе.
5. В multiple-choice — варианты должны быть осмысленными, не «все одинаковые».
6. Для каждой задачи должен быть ответ, если withAnswers=true.

Верни строго JSON по схеме. Никакого текста вокруг.`;

/** Промпт для валидатора. */
export function buildValidatePrompt(args: { worksheet: unknown; context: { subject: string; grade: number; topic: string } }): string {
  return JSON.stringify({
    лист: args.worksheet,
    контекст: args.context,
    верни: {
      ok: "boolean — true если серьёзных проблем нет",
      score: "number 0..1 — общая оценка качества",
      issues: "array of {type, taskNumber?, message, severity}",
      recommendation: "accept | fix | regenerate",
    },
  });
}

/** JSON-schema для structured outputs (OpenAI). */
export const WORKSHEET_JSON_SCHEMA = {
  type: "object",
  required: ["title", "tasks"],
  additionalProperties: false,
  properties: {
    title: { type: "string", description: "Заголовок рабочего листа" },
    instructions: { type: "string", description: "Краткая инструкция для ученика" },
    tasks: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["number", "text", "type", "points"],
        additionalProperties: false,
        properties: {
          number: { type: "integer", minimum: 1 },
          text: { type: "string" },
          type: { type: "string", enum: ["computation", "multiple-choice", "short-answer", "essay", "fill-blank"] },
          options: { type: "array", items: { type: "string" } },
          answer: { type: "string" },
          explanation: { type: "string" },
          points: { type: "integer", minimum: 1, maximum: 3 },
        },
      },
    },
  },
} as const;
