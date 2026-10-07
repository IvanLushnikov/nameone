/**
 * Промпт и разбор ответа для календарно-тематического плана (КТП).
 *
 * Тип артефакта на фронте — `ktp`, роутер зовёт задачу `ktp-gen` (Sonnet 5.5)
 * и она же входит в PLUS_ONLY_TASKS: годовой план не выдаётся на «Базовом».
 * Эндпоинт: POST /api/ktp/generate, ключ ответа `ktp`.
 *
 * ФОРМА СОВПАДАЕТ С `KtpBody` в `routes/worksheets.ts`.
 *
 * Объём тут заметно больше остальных типов: КТП на год — это десятки уроков,
 * поэтому prompt-caching включён (см. `supportsPromptCache` в llm/config.ts) и
 * система просит модель не дублировать предмет в каждой записи.
 */

import {
  asIntInRange,
  asRecord,
  asText,
  pickEnum,
  JSON_ONLY_RULE,
  NO_TECHNICAL_FIELDS_RULE,
  RUSSIAN_DEFAULT_RULE,
  type ArtifactRequest,
} from "./artifact-gen";

/** Виды уроков — тот же список, что в `KtpBody.weeks[].entries[].kind`. */
export const KTP_LESSON_KINDS = [
  "lesson",
  "control",
  "test",
  "review",
  "reserve",
  "project",
] as const;
type KtpLessonKind = (typeof KTP_LESSON_KINDS)[number];

export interface KtpEntry {
  num: number;
  dates: string;
  topic: string;
  kind: KtpLessonKind;
  hours: 1 | 2;
  fgosRef?: string;
  uud?: string;
}

export interface KtpWeek {
  weekNum: number;
  entries: KtpEntry[];
}

const MAX_WEEKS = 40;
const MAX_ENTRIES_PER_WEEK = 7;

/** КТП БЕЗ технических полей — id/createdAt ставит сервер. */
export interface KtpContent {
  title: string;
  subject: string;
  grade: number;
  topic: string;
  schoolYear: string;
  totalHours: number;
  weeks: KtpWeek[];
}

export const KTP_GEN_SYSTEM = `Ты — методист, который составляет календарно-тематическое планирование (КТП) по школьной программе РФ для 1–11 классов.

ЖЁСТКИЕ ПРАВИЛА:
${RUSSIAN_DEFAULT_RULE}
2. План на полный учебный год: с сентября по май, 34–36 учебных недель.
3. Номера уроков (num) идут подряд по всему плану без пропусков, начиная с 1.
4. Даты (dates) — реалистичные учебные даты этой недели в формате "12.09.2026-18.09.2026". Праздничные дни пропускай.
5. Недель без уроков не бывает: каждая неделя в weeks содержит 2–6 уроков.
6. Заполни примерно 20–25% плана детально (тема, ФГОС-результат, УУД), остальное распредели по темам программы равномерно, с ключевыми темами и контрольными работами. Лучше равномерный план с проработанными ключевыми уроками, чем детальный кусок на 4 недели и пустота дальше.
7. Контрольные работы ставь в середине каждого раздела и в конце каждой четверти, реже — 1–2 раза в месяц.
8. Не более 2 часов в день и не более 6 уроков в неделю — иначе план нереализуем.

ФОРМАТ ОТВЕТА — СТРОГО JSON:
{
  "title": "...",
  "subject": "...",
  "grade": <number>,
  "topic": "...",
  "schoolYear": "2026/2027",
  "totalHours": <number>,
  "weeks": [
    {
      "weekNum": <1..36>,
      "entries": [
        {
          "num": <number>,
          "dates": "DD.MM.YYYY-DD.MM.YYYY",
          "topic": "...",
          "kind": "lesson|control|test|review|reserve|project",
          "hours": <1|2>,
          "fgosRef": "...",     // ОПЦИОНАЛЬНО
          "uud": "..."         // ОПЦИОНАЛЬНО
        }
      ]
    }
  ]
}

${NO_TECHNICAL_FIELDS_RULE}

ОГРАНИЧЕНИЯ:
- ВСЕ поля kind берутся ТОЛЬКО из списка выше.
- Школьный год (schoolYear) — строка формата "ГГГГ/ГГГГ", возьми его из параметров.
- Не больше ${MAX_WEEKS} недель и ${MAX_ENTRIES_PER_WEEK} уроков в неделе.
- Темы — из программы по этому предмету и классу, по порядку, с повторением между периодами.

${JSON_ONLY_RULE}`;

/** Учебный год: строка «ГГГГ/ГГГГ» из запроса либо ближайший к текущему. */
export function resolveSchoolYear(value: string | undefined): string {
  if (value && /^\d{4}\/\d{4}$/.test(value)) return value;
  const now = new Date();
  const startYear = now.getUTCMonth() >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return `${startYear}/${String(startYear + 1).padStart(4, "0")}`;
}

export function buildKtpPrompt(req: ArtifactRequest): { system: string; user: string } {
  const schoolYear = resolveSchoolYear(req.schoolYear);
  const user = JSON.stringify(
    {
      задача: "Составь календарно-тематическое планирование на учебный год",
      параметры: {
        предмет: req.subject,
        класс: req.grade,
        раздел_программы: req.topic,
        учебный_год: schoolYear,
        сложность: req.difficulty,
      },
      требования: {
        недель: 34,
        часов_в_неделю: req.grade >= 10 ? 4 : req.grade >= 5 ? 4 : 3,
        детально_заполнить: "20–25% уроков с fgosRef и uud",
        нумерация: "сквозная по всему плану, начиная с 1",
      },
      верни: "JSON по схеме из системного промпта. Без markdown-блоков.",
    },
    null,
    2,
  );

  return { system: KTP_GEN_SYSTEM, user };
}

/**
 * Разобрать ответ модели в КТП.
 *
 * @returns КТП БЕЗ `id`/`createdAt`.
 * @throws если не осталось ни одной корректной записи об уроке.
 */
export function normalizeKtp(raw: unknown, req: ArtifactRequest): KtpContent {
  const obj = asRecord(raw);
  if (!obj) {
    throw new Error("ktp: ответ модели не объект");
  }

  const weeks: KtpWeek[] = [];
  let lessonCounter = 0;

  if (Array.isArray(obj.weeks)) {
    for (const rawWeek of obj.weeks) {
      const week = asRecord(rawWeek);
      if (!week || weeks.length >= MAX_WEEKS) continue;
      const weekNum = asIntInRange(week.weekNum, 1, MAX_WEEKS);
      if (weekNum === null) continue;

      const entries: KtpEntry[] = [];
      if (Array.isArray(week.entries)) {
        for (const rawEntry of week.entries) {
          const entry = asRecord(rawEntry);
          if (!entry) continue;
          const kind = pickEnum(entry.kind, KTP_LESSON_KINDS);
          const topic = asText(entry.topic);
          const dates = asText(entry.dates);
          const hours = asIntInRange(entry.hours, 1, 2);
          if (!kind || !topic || !dates || hours === null) continue;

          // Сквозная нумерация — серверная. Модель нумерует уроки по-своему и
          // регулярно сбивается (повторы, пропуски), а фронт по этой нумерации
          // печатает «урок N» и считает объём программы. Значение из ответа
          // игнорируем — как id и createdAt.
          lessonCounter += 1;
          const fgosRef = asText(entry.fgosRef);
          const uud = asText(entry.uud);
          entries.push({
            num: lessonCounter,
            dates,
            topic,
            kind,
            hours: hours as 1 | 2,
            ...(fgosRef ? { fgosRef } : {}),
            ...(uud ? { uud } : {}),
          });
          if (entries.length >= MAX_ENTRIES_PER_WEEK) break;
        }
      }

      // Пустую неделю выбрасываем: фронт рисует её как «неделя без уроков»,
      // а по программе такого быть не должно.
      if (entries.length > 0) weeks.push({ weekNum, entries });
    }
  }

  if (weeks.length === 0) {
    throw new Error("ktp: модель не вернула ни одной корректной записи об уроке");
  }

  const totalLessons = weeks.reduce((sum, week) => sum + week.entries.length, 0);
  const declaredTotal = asIntInRange(obj.totalHours, 1, 1000);

  return {
    title: asText(obj.title) || `КТП · ${req.subject} · ${req.grade} класс`,
    subject: asText(obj.subject) || req.subject,
    grade: asIntInRange(obj.grade, 1, 11) ?? req.grade,
    topic: asText(obj.topic) || req.topic,
    schoolYear: resolveSchoolYear(
      typeof obj.schoolYear === "string" ? obj.schoolYear : req.schoolYear,
    ),
    // Число часов в шапке КТП читают как объём программы, поэтому берём то,
    // что реально расписали, иначе шапка будет врать.
    totalHours: declaredTotal ?? totalLessons,
    weeks,
  };
}