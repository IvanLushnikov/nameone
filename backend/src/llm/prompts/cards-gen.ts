/**
 * Промпт и разбор ответа для набора карточек (лицевая/оборотная сторона).
 *
 * Тип артефакта на фронте — `cards`, роутер зовёт задачу `cards-gen` (Luna).
 * Эндпоинт: POST /api/cards/generate, ключ ответа `cardSet`.
 *
 * ФОРМА — ФАКТИЧЕСКИ `CardSetBody` в `routes/worksheets.ts`. И тут первое
 * отступление от остальных типов: карточки фронт сохраняет НЕ через
 * `/api/worksheets/save` (см. `toSaveInput` в `src/app/constructor/page.tsx` —
 * для `cards` и `materials` он возвращает null, материал живёт только в
 * браузере). Форма всё равно держим той же: если фронт когда-нибудь начнёт
 * сохранять карточки, менять здесь ничего не придётся.
 */

import {
  asIntInRange,
  asRecord,
  asText,
  CLASS_APPROPRIATENESS_RULE,
  JSON_ONLY_RULE,
  NO_TECHNICAL_FIELDS_RULE,
  RUSSIAN_DEFAULT_RULE,
  SUBJECT_CONFINEMENT_RULE,
  PATTERN_REFERENCE_RULE,
  CONCRETE_ANSWER_RULE,
  type ArtifactRequest,
} from "./artifact-gen";

export interface FlashCard {
  front: string;
  back: string;
  category?: string;
  hint?: string;
}

/** Набор карточек БЕЗ технических полей — id/createdAt ставит сервер. */
export interface CardSetContent {
  title: string;
  subject: string;
  grade: number;
  topic: string;
  difficulty: string;
  cards: FlashCard[];
}

export const CARDS_GEN_SYSTEM = `Ты — методист, который готовит карточки для запоминания по школьной программе РФ для 1–11 классов.

ЖЁСТКИЕ ПРАВИЛА:
${RUSSIAN_DEFAULT_RULE}
2. Ровно столько карточек, сколько указано в параметре cards.
3. front — короткий вопрос, термин или дата, до 90 символов. Это то, что ученик видит на лицевой стороне.
4. back — ответ или определение: одно-два предложения, до 300 символов. На обороте не должно быть новых фактов, которых нет во front.
5. category — группа карточек по 2–5 штук («Словарь», «Даты», «Формулы», «Признаки»). Группировка помогает повторять выборочно.
6. hint — короткая подсказка на лицевой стороне (первая буква, ассоциация). ОПЦИОНАЛЬНО, не обязана быть у каждой карточки.
7. Карточки должны покрывать тему целиком: ключевые понятия, признаки, формулы, даты — а не один узкий факт.
8. Без «повторите параграф» вместо содержания: на карточке должен быть конкретный факт.
${SUBJECT_CONFINEMENT_RULE}
${PATTERN_REFERENCE_RULE}
${CONCRETE_ANSWER_RULE}
${CLASS_APPROPRIATENESS_RULE}

ФОРМАТ ОТВЕТА — СТРОГО JSON:
{
  "title": "...",
  "subject": "...",
  "grade": <number>,
  "topic": "...",
  "difficulty": "easy|medium|hard",
  "cards": [
    {
      "front": "...",
      "back": "...",
      "category": "...",
      "hint": "..."
    }
  ]
}

${NO_TECHNICAL_FIELDS_RULE}

ОГРАНИЧЕНИЯ:
- Количество карточек РОВНО равно числу из параметров (допуск ±1).
- Только школьный материал по этому классу и предмету.

${JSON_ONLY_RULE}`;

export function buildCardsPrompt(req: ArtifactRequest): { system: string; user: string } {
  const user = JSON.stringify(
    {
      задача: "Подготовь набор карточек для запоминания по параметрам ниже",
      параметры: {
        предмет: req.subject,
        класс: req.grade,
        тема: req.topic,
        сложность: req.difficulty,
        карточек: req.count,
      },
      требования: {
        ровно_карточек: req.count,
        на_карточку: "front до 90 символов, back до 300 символов",
        группы: "category по 2–5 карточек в каждой",
      },
      верни: "JSON по схеме из системного промпта. Без markdown-блоков.",
    },
    null,
    2,
  );

  return { system: CARDS_GEN_SYSTEM, user };
}

/**
 * Разобрать ответ модели в набор карточек.
 *
 * @returns набор БЕЗ `id`/`createdAt`.
 * @throws если не осталось ни одной карточки с обеими сторонами.
 */
export function normalizeCardSet(raw: unknown, req: ArtifactRequest): CardSetContent {
  const obj = asRecord(raw);
  if (!obj) {
    throw new Error("cards: ответ модели не объект");
  }

  const cards: FlashCard[] = [];
  if (Array.isArray(obj.cards)) {
    for (const item of obj.cards) {
      const card = asRecord(item);
      if (!card) continue;
      const front = asText(card.front);
      const back = asText(card.back);
      // Карточка только с одной стороной не запоминается — она не карточка.
      if (!front || !back) continue;
      const category = asText(card.category);
      const hint = asText(card.hint);
      cards.push({
        front,
        back,
        ...(category ? { category } : {}),
        ...(hint ? { hint } : {}),
      });
    }
  }

  if (cards.length === 0) {
    throw new Error("cards: модель не вернула ни одной карточки с обеими сторонами");
  }

  return {
    title: asText(obj.title) || `Карточки · ${req.topic}`,
    subject: asText(obj.subject) || req.subject,
    grade: asIntInRange(obj.grade, 1, 11) ?? req.grade,
    topic: asText(obj.topic) || req.topic,
    difficulty: asText(obj.difficulty) || req.difficulty,
    cards,
  };
}