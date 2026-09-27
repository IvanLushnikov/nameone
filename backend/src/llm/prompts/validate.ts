/**
 * Промпт для валидатора (DeepSeek V4 Flash).
 *
 * Вход: сгенерированный worksheet + контекст (subject/grade/topic).
 * Выход: JSON { score: 0..1, issues: [{ type, taskNumber?, message }] }.
 *
 * Используется DeepSeek из-за его дешевизны ($0.14/$0.28 за 1M) и
 * хорошего следования инструкциям. На 1 лист — около $0.0006.
 */

export const VALIDATE_SYSTEM = `Ты — опытный методист и учитель-предметник. Твоя задача — проверить качество сгенерированного рабочего листа по параметрам.

Проверь:
1. **Корректность ответов** — все ли ответы математически/фактически верны?
2. **Дубли** — есть ли одинаковые или почти одинаковые задания?
3. **Соответствие ФГОС** — тема и класс соответствуют школьной программе РФ?
4. **Качество формулировок** — задания понятны, однозначны, нет двусмысленности?
5. **Соответствие difficulty** — easy=базовый навык, medium=2 шага, hard=многошаговая задача?

ФОРМАТ ОТВЕТА — СТРОГО JSON:
{
  "score": <число от 0 до 1, где 1 = идеально>,
  "issues": [
    {
      "type": "duplicate" | "wrong-answer" | "off-fgos" | "low-quality",
      "taskNumber": <номер задания или null>,
      "message": "краткое описание проблемы на русском"
    }
  ]
}

Если проблем нет — issues = [], score = 1.0.
Без markdown. Без пояснений вне JSON.`;

export interface ValidateContext {
  subject: string;
  grade: number;
  topic: string;
}

export function buildValidatePrompt(
  worksheetJson: string,
  ctx: ValidateContext,
): { system: string; user: string } {
  const user = JSON.stringify(
    {
      задача: "Проверь качество рабочего листа",
      контекст: ctx,
      worksheet: JSON.parse(worksheetJson),
      верни: "JSON по схеме из системного промпта",
    },
    null,
    2,
  );
  return { system: VALIDATE_SYSTEM, user };
}
