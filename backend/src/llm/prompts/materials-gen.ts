/**
 * Промпт и разбор ответа для комплекта материалов (словарь, справочник,
 * раздатка, чек-лист).
 *
 * Тип артефакта на фронте — `materials`, роутер зовёт задачу `worksheet-gen`
 * (это ровно тот случай, когда отдельной GenerationKind не нужно: материалы
 * генерируются той же дешёвой Luna, что и рабочие листы).
 * Эндпоинт: POST /api/materials/generate, ключ ответа `materialBundle`.
 *
 * Как и карточки, комплект фронт не сохраняет через `/api/worksheets/save`
 * (`toSaveInput` возвращает null для `materials`). Форму всё равно держим
 * совпадающей с `MaterialFile`, который потом уходит в ZIP.
 */

import { shortId } from "../../lib/shortid";
import {
  asIntInRange,
  asRecord,
  asText,
  pickEnum,
  CLASS_APPROPRIATENESS_RULE,
  JSON_ONLY_RULE,
  NO_TECHNICAL_FIELDS_RULE,
  RUSSIAN_DEFAULT_RULE,
  SUBJECT_CONFINEMENT_RULE,
  type ArtifactRequest,
} from "./artifact-gen";

/** Виды материалов — тот же список, что в `MaterialFileKind` на фронте. */
export const MATERIAL_FILE_KINDS = [
  "glossary",
  "reference",
  "handout",
  "checklist",
] as const;
type MaterialFileKind = (typeof MATERIAL_FILE_KINDS)[number];

const MATERIAL_FILE_FORMATS = ["txt", "docx", "csv"] as const;
type MaterialFileFormat = (typeof MATERIAL_FILE_FORMATS)[number];

export interface MaterialFile {
  /** Идентификатор файла ставит СЕРВЕР (см. normalizeMaterialBundle). */
  id: string;
  kind: MaterialFileKind;
  title: string;
  content: string;
  format: MaterialFileFormat;
}

/** Комплект БЕЗ технических полей — id/createdAt ставит сервер. */
export interface MaterialBundleContent {
  title: string;
  subject: string;
  grade: number;
  topic: string;
  files: MaterialFile[];
}

export const MATERIALS_GEN_SYSTEM = `Ты — методист, который готовит комплект раздаточных материалов по школьной программе РФ для 1–11 классов.

ЖЁСТКИЕ ПРАВИЛА:
${RUSSIAN_DEFAULT_RULE}
2. Комплект состоит ровно из указанного числа файлов. Каждый файл — законченный документ, который реально можно распечатать и отдать ученику.
3. kind — тип файла, только из списка: glossary (словарь терминов), reference (справочные данные: таблицы, формулы, даты), handout (раздатка-памятка или инструкция), checklist (чек-лист: что взять на урок, что повторить).
4. content — готовый текст документа, а не описание документа. Никаких «здесь будет таблица»: пиши саму таблицу или список, с переносами строк.
5. Никакого markdown: без **жирного**, без заголовков с решётками, без обрамления ответа блоками кода. Обычные дефисы в списках и двоеточие после термина допустимы.
${SUBJECT_CONFINEMENT_RULE}
${CLASS_APPROPRIATENESS_RULE}
6. Поля "id" и "createdAt" в ответе не нужны: файл в архиве получает идентификатор на сервере.

ФОРМАТ ОТВЕТА — СТРОГО JSON:
{
  "title": "...",
  "subject": "...",
  "grade": <number>,
  "topic": "...",
  "files": [
    {
      "kind": "glossary|reference|handout|checklist",
      "title": "...",
      "content": "...",
      "format": "txt|docx|csv"
    }
  ]
}

${NO_TECHNICAL_FIELDS_RULE}

ОГРАНИЧЕНИЯ:
- Количество файлов РОВНО равно числу из параметров.
- Количество элементов в files — от 1 до 6.
- Словарь (glossary) — таблица «термин — определение», поэтому его format = "csv".
- Остальные файлы — обычный текст, format = "txt".
- Содержание каждого файла — минимум 15 строк осмысленного текста по этой теме.

${JSON_ONLY_RULE}`;

export function buildMaterialsPrompt(req: ArtifactRequest): { system: string; user: string } {
  const user = JSON.stringify(
    {
      задача: "Подготовь комплект материалов по параметрам ниже",
      параметры: {
        предмет: req.subject,
        класс: req.grade,
        тема: req.topic,
        сложность: req.difficulty,
        файлов: req.count,
      },
      требования: {
        ровно_файлов: req.count,
        виды: "выбери из glossary / reference / handout / checklist так, чтобы файлы не повторяли друг друга",
        содержание: "готовый текст документа, а не описание документа",
      },
      верни: "JSON по схеме из системного промпта. Без markdown-блоков.",
    },
    null,
    2,
  );

  return { system: MATERIALS_GEN_SYSTEM, user };
}

/**
 * Разобрать ответ модели в комплект материалов.
 *
 * @returns комплект БЕЗ `id`/`createdAt`; идентификаторы файлов проставлены
 *          здесь, на сервере.
 * @throws если не осталось ни одного файла с содержимым.
 */
export function normalizeMaterialBundle(
  raw: unknown,
  req: ArtifactRequest,
): MaterialBundleContent {
  const obj = asRecord(raw);
  if (!obj) {
    throw new Error("materials: ответ модели не объект");
  }

  const files: MaterialFile[] = [];
  if (Array.isArray(obj.files)) {
    for (const item of obj.files) {
      const file = asRecord(item);
      if (!file) continue;
      const kind = pickEnum(file.kind, MATERIAL_FILE_KINDS);
      const title = asText(file.title);
      const content = asText(file.content);
      if (!kind || !title || !content) continue;
      files.push({
        // Идентификатор файла — только серверный. Модель их не знает, а на
        // фронте id идёт в ZIP-архив, и два одинаковых id от модели дали бы
        // архив с двумя файлами под одним именем.
        id: `mf_${shortId()}`,
        kind,
        title,
        content,
        format:
          pickEnum(file.format, MATERIAL_FILE_FORMATS) ?? (kind === "glossary" ? "csv" : "txt"),
      });
    }
  }

  if (files.length === 0) {
    throw new Error("materials: модель не вернула ни одного файла с содержимым");
  }

  return {
    title: asText(obj.title) || `Материалы · ${req.topic}`,
    subject: asText(obj.subject) || req.subject,
    grade: asIntInRange(obj.grade, 1, 11) ?? req.grade,
    topic: asText(obj.topic) || req.topic,
    files,
  };
}