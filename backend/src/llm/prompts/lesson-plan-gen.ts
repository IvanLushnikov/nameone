/**
 * Промпт и разбор ответа для плана урока (ФГОС).
 *
 * Тип артефакта на фронте — `lesson-plan`, роутер зовёт задачу `lesson-plan-gen`
 * (Luna). Эндпоинт: POST /api/lesson-plans/generate, ключ ответа `lessonPlan`.
 *
 * ФОРМА СОВПАДАЕТ С `LessonPlanBody` в `routes/worksheets.ts` — тем самым
 * зод-схемой, по которой фронт потом сохраняет план через
 * `/api/worksheets/save`. Любое расхождение здесь даёт 400 на сохранении,
 * то есть учитель теряет материал, за который заплатил.
 */

import {
  asIntInRange,
  asRecord,
  asText,
  asTextList,
  pickEnum,
  JSON_ONLY_RULE,
  NO_TECHNICAL_FIELDS_RULE,
  RUSSIAN_DEFAULT_RULE,
  type ArtifactRequest,
} from "./artifact-gen";

/** Стадии урока — тот же список, что в zod-схеме `LessonPlanBody.stages[].kind`. */
export const LESSON_STAGE_KINDS = [
  "org-moment",
  "motivation",
  "new-topic",
  "practice",
  "reflex",
  "homework",
] as const;
type LessonStageKind = (typeof LESSON_STAGE_KINDS)[number];

export interface LessonStage {
  kind: LessonStageKind;
  title: string;
  durationMin: number;
  teacherActions: string;
  studentActions: string;
  materials?: string[];
}

/** План урока БЕЗ технических полей — id/createdAt ставит сервер. */
export interface LessonPlanContent {
  title: string;
  subject: string;
  grade: number;
  topic: string;
  fgosRef?: string;
  goals: { educational: string[]; developmental: string[]; nurturing: string[] };
  equipment: string[];
  stages: LessonStage[];
  homework: { text: string; alternatives?: string[] };
}

export const LESSON_PLAN_GEN_SYSTEM = `Ты — опытный учитель-предметник с 20-летним стажем и методист, который готовит планы урока по ФГОС РФ для школьников 1–11 классов.

ЖЁСТКИЕ ПРАВИЛА:
${RUSSIAN_DEFAULT_RULE}
2. План урока рассчитан на 45 минут. Сумма durationMin по всем стадиям — РОВНО 45 (допуск ±2). Ни одна стадия не длиннее 45 и не короче 1 минуты.
3. Стадии идут в порядке проведения урока и набирают смысл: сначала организационный момент, затем мотивация и актуализация знаний, потом объяснение нового, потом отработка, рефлексия и домашнее задание.
4. Цели формулируются через результат обучающегося («умеет объяснить», «распознаёт»), а не через действие учителя («знакомит с»).
5. teacherActions и studentActions — конкретные действия на уроке, короткие фразы или тезисы с переносами строк. Не пиши «урок проводится в обычном режиме» — это не описание шага.
6. Домашнее задание реально по этому классу и теме, с номерами страниц или упражнений. alternatives — варианты на случай разной скорости детей.
7. Никаких политических, религиозных и adult-тем. Никаких тем «не по возрасту».

ФОРМАТ ОТВЕТА — СТРОГО JSON:
{
  "title": "...",
  "subject": "...",
  "grade": <number>,
  "topic": "...",
  "fgosRef": "...",                  // ОПЦИОНАЛЬНО: § учебника или пункт ФГОС. Нет — не выводи поле.
  "goals": {
    "educational": ["..."],
    "developmental": ["..."],
    "nurturing": ["..."]
  },
  "equipment": ["..."],
  "stages": [
    {
      "kind": "org-moment|motivation|new-topic|practice|reflex|homework",
      "title": "...",
      "durationMin": <1..45>,
      "teacherActions": "...",
      "studentActions": "...",
      "materials": ["..."]           // ОПЦИОНАЛЬНО
    }
  ],
  "homework": {
    "text": "...",
    "alternatives": ["..."]          // ОПЦИОНАЛЬНО
  }
}

${NO_TECHNICAL_FIELDS_RULE}

ОГРАНИЧЕНИЯ:
- Массив stages НЕ ПУСТ: минимум 3 стадии, максимум 7.
- ВСЕ поля kind берутся ТОЛЬКО из списка выше. Других значений не существует.
- Если с темой плохо, всё равно верни план по близкой теме и честно отметь это в title.

${JSON_ONLY_RULE}`;

/** Собрать { system, user } для генерации плана урока. */
export function buildLessonPlanPrompt(req: ArtifactRequest): {
  system: string;
  user: string;
} {
  const user = JSON.stringify(
    {
      задача: "Подготовь план урока по параметрам ниже",
      параметры: {
        предмет: req.subject,
        класс: req.grade,
        тема: req.topic,
        сложность: req.difficulty,
        стадий: req.count,
      },
      требования: {
        хронометраж_урока_минут: 45,
        примерно_стадий: req.count,
        fgosRef: "обязателен, если знаешь параграф учебника для этого класса; иначе не выводи поле",
        сложность_влияет_на: "глубину отработки и количество примеров, а не на количество стадий",
      },
      верни: "JSON по схеме из системного промпта. Без markdown-блоков.",
    },
    null,
    2,
  );

  return { system: LESSON_PLAN_GEN_SYSTEM, user };
}

/**
 * Разобрать ответ модели в план урока.
 *
 * @returns план БЕЗ `id`/`createdAt` — их проставляет сервер.
 * @throws если из ответа нельзя получить план (пустые стадии, нет текста
 *         урока): лучше ошибка, чем заготовка, которую учитель примет за
 *         сгенерированный материал.
 */
export function normalizeLessonPlan(raw: unknown, req: ArtifactRequest): LessonPlanContent {
  const obj = asRecord(raw);
  if (!obj) {
    throw new Error("lesson-plan: ответ модели не объект");
  }

  const stages: LessonStage[] = [];
  if (Array.isArray(obj.stages)) {
    for (const item of obj.stages) {
      const stage = asRecord(item);
      if (!stage) continue;
      const kind = pickEnum(stage.kind, LESSON_STAGE_KINDS);
      const title = asText(stage.title);
      const teacherActions = asText(stage.teacherActions);
      const studentActions = asText(stage.studentActions);
      const durationMin = asIntInRange(stage.durationMin, 1, 45);
      // Стадия без названия или без действий учителя — не стадия. Метка kind
      // вне списка — тоже: подставить соседнее значит выдумать смысл.
      if (!kind || !title || !teacherActions || !studentActions || durationMin === null) continue;
      const materials = asTextList(stage.materials);
      stages.push({
        kind,
        title,
        durationMin,
        teacherActions,
        studentActions,
        ...(materials.length > 0 ? { materials } : {}),
      });
    }
  }

  if (stages.length === 0) {
    throw new Error("lesson-plan: модель не вернула ни одной корректной стадии урока");
  }

  const homework = asRecord(obj.homework);
  const homeworkText = asText(homework?.text);
  if (!homeworkText) {
    throw new Error("lesson-plan: модель не вернула домашнее задание");
  }
  const alternatives = asTextList(homework?.alternatives);

  const goals = asRecord(obj.goals);
  const fgosRef = asText(obj.fgosRef);

  return {
    title: asText(obj.title) || `План урока · ${req.topic}`,
    subject: asText(obj.subject) || req.subject,
    grade: asIntInRange(obj.grade, 1, 11) ?? req.grade,
    topic: asText(obj.topic) || req.topic,
    ...(fgosRef ? { fgosRef } : {}),
    goals: {
      educational: asTextList(goals?.educational),
      developmental: asTextList(goals?.developmental),
      nurturing: asTextList(goals?.nurturing),
    },
    equipment: asTextList(obj.equipment),
    stages,
    homework: {
      text: homeworkText,
      ...(alternatives.length > 0 ? { alternatives } : {}),
    },
  };
}