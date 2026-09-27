/**
 * Промпты для self-verification.
 *
 * Двухпроходная схема:
 *   1. SOLVE_PROMPT  — LLM решает задачу, получает answer.
 *   2. VERIFY_PROMPT — LLM (тот же или второй) проверяет корректность ответа.
 *
 * В обоих случаях модель получает минимальный контекст: subject / grade / topic,
 * формулировку задачи и (если есть) ожидаемый ответ из банка задач.
 *
 * Температура 0 на обоих проходах — нам нужна воспроизводимость, не креатив.
 */

export const SOLVE_PROMPT = (input: {
  subject: string;
  grade: number;
  topic: string;
  taskText: string;
  expectedAnswer?: string;
}): string => {
  const contextLine =
    input.expectedAnswer && input.expectedAnswer.length > 0
      ? `\nИзвестный ответ (подсказка для самопроверки, не подглядывать в финальный вывод): ${input.expectedAnswer}`
      : "";

  return `Ты — решатель математических задач для школьников.
Предмет: ${input.subject}, класс: ${input.grade}, тема: ${input.topic}.

Задача:
${input.taskText}
${contextLine}

Дай КРАТКОЕ решение по шагам и финальный числовой ответ в конце.
Формат:
Шаг 1: ...
Шаг 2: ...
Ответ: <число или выражение>`;
};

export const VERIFY_PROMPT = (input: {
  subject: string;
  grade: number;
  taskText: string;
  proposedAnswer: string;
  expectedAnswer?: string;
}): string => {
  const expectedLine =
    input.expectedAnswer && input.expectedAnswer.length > 0
      ? `\nЭталонный ответ (из банка задач): ${input.expectedAnswer}`
      : "";

  return `Ты — проверяющий решений математических задач.
Предмет: ${input.subject}.
Задача:
${input.taskText}

Предложенное решение:
${input.proposedAnswer}
${expectedLine}

Твоя задача — независимо решить задачу и сравнить с предложенным ответом.
Верни СТРОГО JSON без пояснений вокруг:
{"verified": true | false, "reason": "короткое объяснение на русском"}`;
};