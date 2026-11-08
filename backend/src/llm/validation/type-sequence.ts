/**
 * Детектор последовательности форм в листе (ТЗ-40, Q-09).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЗАЧЕМ ЕЩЁ ОДИН ДЕТЕКТОР, РАЗ УЖЕ ЕСТЬ `skill-dupes.ts`
 * ─────────────────────────────────────────────────────────────────────────────
 * `skill-dupes.ts` смотрит на СОДЕРЖАНИЕ заданий: совпал ли текст, совпали ли
 * варианты ответа, совпала ли метка навыка. Он не смотрит на ТИП задания.
 *
 * Дыра была именно там: лист из семи заданий с выбором ответа подряд — это не
 * дубль (задания разные), но для класса это один большой тест с одной формой.
 * Живые прогоны 29.10.2026 (10 листов, `docs/research/2026-10-29-quality-findings.md`,
 * раздел 4, Q-09): в 7 листах из 10 есть соседние задания одного типа, и
 * ПРОВЕРКИ В КОДЕ НЕ БЫЛО — `grep -rn "подряд" backend/src` находил только
 * просьбу в промпте («Не пиши 5 одинаковых задач подряд»), а просьба — это не
 * гарантия.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ГРАНИЦА ДЕТЕКТОРА: ГДЕ ЭТО ДЕФЕКТ, А ГДЕ НОРМАЛЬНАЯ МЕТОДИКА
 * ─────────────────────────────────────────────────────────────────────────────
 * Правило репозитория (аудит 19.10.2026, §12): ЛОЖНЫЙ ДЕФЕКТ ХУЖЕ
 * ПРОПУЩЕННОГО. Детектор, который бракует нормальный лист, учитель выключит.
 *
 * Поэтому «три одинаковые формы подряд» — это НЕ всегда дефект. Дефект — это
 * лист, который выглядит как один формат; а «три вычисления подряд на разном
 * материале» — это обычная отработка навыка, и учитель на неё не жалуется.
 * Границы здесь три:
 *
 *   1. ПОРОГ — ТРИ, А НЕ ДВА. Два одинаковых типа подряд — нормальный лист
 *      (два вычисления в математике, два выбора ответа в русском). Настоящая
 *      проблема начинается с трёх: это уже «лист из одной формы».
 *
 *   2. ОТРАБОТКА НАВЫКА — НЕ ДЕФЕКТ. Если у всех заданий серии ОДНА И ТА ЖЕ
 *      метка навыка от модели («Нахождение процента от числа» ×3), то это
 *      намеренная отработка одного навыка, а не однообразие листа. Метка —
 *      это то, что МОДЕЛЬ САМА сказала о задании (ТЗ-33, Q-03), и верить ей
 *      тут основание: в живых прогонах метка заполнена у всех заданий
 *      (11–12 разных меток на 12 заданий) и называет узкий навык, а не тему.
 *
 *      Оговорка: метка, совпадающая с темой листа, — это НЕ метка навыка
 *      (так подставляет сервер, `validation/skill-labels.ts`), и такой «навык»
 *      ничего не доказывает. Такие серии чинятся.
 *
 *   3. ФОРМА, ЗАДАННАЯ САМИМ ТИПОМ РАБОТЫ, — НЕ ДЕФЕКТ. Тест с автопроверкой
 *      по определению состоит из заданий с выбором ответа (фронт прячет поле
 *      ответа и рисует варианты A–D, `src/components/constructor/WorksheetPreview.tsx`),
 *      а вариант ОГЭ/ЕГЭ повторяет формат экзамена, где часть 1 — это краткие
 *      ответы (выбор ответа или число) подряд. Замена таких заданий на другие
 *      формы сломала бы сам смысл работы.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ЭТОТ МОДУЛЬ НЕ ДЕЛАЕТ
 * ─────────────────────────────────────────────────────────────────────────────
 *   · не проверяет содержание заданий — это делает `skill-dupes.ts`;
 *   · не решает, каким типом заменить задание, — это делает конвейер
 *     (`backend/src/llm/index.ts`), здесь только считаются серии;
 *   · не ходит в сеть и не меняет переданные ему данные.
 */

import { normalizeSkillLabel } from "./skill-dupes";
import type { TaskType } from "../../types";

/**
 * Тип задания — тот же список, что в `backend/src/types.ts:89` и
 * `src/lib/types.ts:120`. Дублируется здесь как ТИП, а не как источник истины:
 * список приходит от модели, и серверной валидации типа в проекте нет
 * (это отмечено в реестре как наблюдение, а не как проблема).
 */
export type TaskTypeName =
  | "computation"
  | "multiple-choice"
  | "short-answer"
  | "essay"
  | "fill-blank";

/** Канонический список типов — в том же порядке, что в схеме листа. */
export const TASK_TYPE_NAMES: readonly TaskTypeName[] = [
  "computation",
  "multiple-choice",
  "short-answer",
  "essay",
  "fill-blank",
];

/** Найденная серия одинаковых форм. */
export interface TypeRun {
  /** Позиция первого задания серии, с единицы. */
  start: number;
  /** Длина серии. */
  length: number;
  /** Тип задания во всей серии. */
  type: TaskTypeName;
}

/**
 * Порог серии по умолчанию.
 *
 * Три — не два: два одинаковых типа подряд это нормальный лист, а три — уже
 * «лист из одной формы». Тот же порог стоит у детектора дублей
 * (`MIN_SHARED_PHRASE` в `skill-dupes.ts`) и он же зафиксирован в тексте
 * страницы «Методика».
 */
export const MIN_TYPE_RUN = 3;

/**
 * Тип работы — от него зависит, какая форма задана жёстко.
 *
 * Это тот же список, что в `backend/src/types.ts` (`TaskType`): листы, тесты,
 * карточки, контрольные, ОГЭ и ЕГЭ. Карточки через этот конвейер не идут, но
 * тип живёт в общем перечне, и молча сужать его здесь нельзя.
 */
export type WorkType = TaskType;

/**
 * Типы, которые проверяет автопроверка (`backend/src/services/formGrading.ts`).
 *
 * Короткий ответ и эссе проверяет учитель — для «теста с автопроверкой» они
 * не годятся.
 */
const AUTO_GRADED: readonly TaskTypeName[] = ["multiple-choice", "computation", "fill-blank"];

/**
 * Предметы, где вычисление — часть предмета.
 *
 * Тот же список, что в `validation/quality-filter.ts` (тот файл не в зоне
 * этой задачи, поэтому список продублирован со ссылкой).
 */
const MATH_SUBJECTS: readonly string[] = [
  "math",
  "algebra",
  "geometry",
  "informatics",
  "physics",
  "chemistry",
];

/**
 * Привести тип к каноническому виду.
 *
 * Модель присылает тип строкой; пробелы и регистр — её дело, а не наше. Тип,
 * который после нормализации не узнан, считается НЕИЗВЕСТНЫМ (см. AD-4 в ТЗ-40:
 * неизвестный тип — отдельная форма, он не входит ни в одну серию).
 */
export function normalizeType(value: unknown): TaskTypeName | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return (TASK_TYPE_NAMES as readonly string[]).includes(normalized)
    ? (normalized as TaskTypeName)
    : null;
}

/** Известен ли тип задания. */
export function isTaskType(value: unknown): value is TaskTypeName {
  return normalizeType(value) !== null;
}

/**
 * Найти серии одинаковых типов в списке заданий.
 *
 * Чистая функция: на вход — массив заданий, на выходе — список серий. Порядок
 * входа не меняется, сети нет, побочных эффектов нет.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО СЧИТАЕТСЯ СЕРИЕЙ, А ЧТО НЕТ
 * ─────────────────────────────────────────────────────────────────────────────
 * · Серия — это МАКСИМАЛЬНЫЙ непрерывный кусок соседних заданий одного типа.
 *   Две серии подряд невозможны: максимальный кусок по определению один.
 * · Задание с НЕИЗВЕСТНЫМ типом (нет поля, мусор в поле) разрывает серию и
 *   само серией не является (ТЗ-40, AD-4): придумывать правила для мусора
 *   нельзя, а серверной валидации типа в проекте нет.
 * · Серия короче `minRun` не возвращается: два одинаковых типа подряд — это
 *   нормальный лист.
 */
export function findTypeRuns(
  tasks: readonly { type?: unknown }[],
  minRun: number = MIN_TYPE_RUN,
): TypeRun[] {
  const list = Array.isArray(tasks) ? tasks : [];
  // Порог меньше двух бессмыслен: «серия из одного задания» — это не серия.
  const threshold = Math.max(2, Math.floor(minRun) || MIN_TYPE_RUN);
  const runs: TypeRun[] = [];

  let index = 0;
  while (index < list.length) {
    const type = normalizeType(list[index]?.type);
    if (!type) {
      // Неизвестный тип — отдельная форма: разрывает серию (AD-4).
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < list.length && normalizeType(list[end]?.type) === type) end += 1;
    const length = end - index;
    if (length >= threshold) {
      runs.push({ start: index + 1, length, type });
    }
    index = end;
  }

  return runs;
}

/**
 * Формы, которые для типа работы заданы жёстко и дефектом не являются.
 *
 * · `test` — тест с автопроверкой: фронт прячет поле ответа и рисует варианты
 *   A–D, то есть лист по определению состоит из заданий с выбором ответа.
 * · `oge` / `ege` — формат экзамена: часть 1 — краткие ответы (выбор ответа
 *   или число), и они в формате идут подряд.
 *
 * Для рабочего листа и контрольной таких форм нет: там смешанные формы — это
 * как раз то, чего ждёт учитель.
 */
export function nativeFormsFor(workType: WorkType | null | undefined): readonly TaskTypeName[] {
  switch (workType) {
    case "test":
      return ["multiple-choice"];
    case "oge":
    case "ege":
      return ["multiple-choice", "computation"];
    default:
      return [];
  }
}

/**
 * Отформатировать метку навыка тем же способом, что и детектор дублей.
 *
 * Метка приходит от модели свободным текстом: «Нахождение процента от
 * числа», «Нахождение  процента  от  числа». Сравнение по сырой строке дало бы
 * ложные расхождения.
 */
function normalizeLabel(value: unknown): string {
  return normalizeSkillLabel(value);
}

/**
 * Отстройка одного навыка: все задания серии проверяют ОДНО И ТО ЖЕ.
 *
 * Это не дефект, а нормальная методика — «три вычисления подряд на разном
 * материале» учителя не смущает. Подтверждается меткой навыка от модели: если
 * она одинакова у всех заданий серии и это не «просто тема листа», значит
 * модель сама сказала, что это отработка одного навыка.
 *
 * Если метки нет ни у одного задания серии — отстройку подтвердить нечем, и
 * серия считается дефектом.
 */
export function isDrillingRun(
  tasks: readonly { type?: unknown; skill?: unknown }[],
  run: TypeRun,
  options: { topic?: string | null } = {},
): boolean {
  const labels = new Set<string>();
  for (let i = run.start - 1; i < run.start - 1 + run.length; i += 1) {
    const label = normalizeLabel(tasks[i]?.skill);
    if (!label) return false;
    labels.add(label);
  }
  if (labels.size !== 1) return false;

  // Метка, совпадающая с темой листа, — это не навык: так подставляет сервер
  // (`validation/skill-labels.ts`). Такой «навык» не доказывает отстройку.
  const topic = normalizeLabel(options.topic);
  const only = [...labels][0];
  if (topic && only === topic) return false;

  return true;
}

/** Настройки отбора серий-дефектов. */
export interface DefectRunOptions {
  /** Порог длины серии. По умолчанию — {@link MIN_TYPE_RUN}. */
  minRun?: number;
  /** Тип работы: от него зависит, какая форма задана жёстко. */
  workType?: WorkType | null;
  /** Тема листа: нужна, чтобы отличить метку навыка от «просто темы». */
  topic?: string | null;
}

/**
 * Серии, которые считаются ДЕФЕКТОМ и подлежат замене.
 *
 * Из всех серий убираются две группы:
 *   · форма, заданная самим типом работы (тест, ОГЭ, ЕГЭ);
 *   · отстройка одного навыка (одинаковая метка у всех заданий серии).
 *
 * Всё остальное — дефект: лист выглядит как одна форма.
 */
export function findDefectRuns(
  tasks: readonly { type?: unknown; skill?: unknown }[],
  options: DefectRunOptions = {},
): TypeRun[] {
  const native = nativeFormsFor(options.workType);
  return findTypeRuns(tasks, options.minRun).filter((run) => {
    if (native.includes(run.type)) return false;
    if (isDrillingRun(tasks, run, options)) return false;
    return true;
  });
}

/**
 * Номера заданий, которые надо заменить: в каждой серии — ВСЕ, КРОМЕ ПЕРВОГО.
 *
 * Первое задание серии уже стоит в листе и выглядит уместно; менять его —
 * ломать лист сильнее, чем нужно. Логика та же, что у `tasksToReplace` в
 * `skill-dupes.ts`: чистка убирает второе задание пары, не первое.
 */
export function runTailNumbers(runs: readonly TypeRun[]): number[] {
  const numbers = new Set<number>();
  for (const run of runs) {
    for (let i = 1; i < run.length; i += 1) {
      numbers.add(run.start + i);
    }
  }
  return [...numbers].sort((a, b) => a - b);
}

/**
 * Типы, которые можно просить у модели вместо типа серии.
 *
 * · эссе исключено: замена на эссе меняет природу листа (учитель просил
 *   упражнения, а не сочинение), а ключ к эссе — это критерии, а не ответ;
 * · для теста с автопроверкой берутся только автопроверяемые типы: короткий
 *   ответ и эссе учитель всё равно проверяет сам;
 * · вычисление — только для предметов, где математика часть предмета: в листе
 *   по истории задание «посчитайте» — чужой предмет, и его выкинет фильтр
 *   качества (потеря материала вместо замены).
 */
export function replacementCandidates(
  runType: TaskTypeName,
  workType: WorkType | null | undefined,
  subject?: string | null,
): TaskTypeName[] {
  const allowed =
    workType === "test"
      ? AUTO_GRADED
      : TASK_TYPE_NAMES.filter((type) => type !== "essay");
  const usable = subject && !MATH_SUBJECTS.includes(subject)
    ? allowed.filter((type) => type !== "computation")
    : allowed;
  return usable.filter((type) => type !== runType);
}

/** Сколько заданий каждого типа в листе. */
function countTypes(tasks: readonly { type?: unknown }[]): Map<TaskTypeName, number> {
  const counts = new Map<TaskTypeName, number>();
  for (const task of Array.isArray(tasks) ? tasks : []) {
    const type = normalizeType(task?.type);
    if (!type) continue;
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return counts;
}

/**
 * Проверяет ли автопроверка задание такого типа.
 *
 * Короткий ответ и эссе проверяет учитель (`backend/src/services/formGrading.ts`),
 * поэтому в «тесте с автопроверкой» им места нет.
 */
export function isAutoGradedType(type: TaskTypeName): boolean {
  return AUTO_GRADED.includes(type);
}

/**
 * Порядок типов, которыми можно заменить серию: от НАИМЕНЕЕ используемого в
 * листе к самому используемому.
 *
 * Замена не должна добавлять в лист ещё одну порцию той же формы, поэтому
 * первым идёт тип, которого в листе меньше всего. При равенстве — порядок
 * `TASK_TYPE_NAMES`, чтобы поведение не зависело от порядка ключей объекта.
 *
 * Тип самой серии уже исключён (`replacementCandidates`). Соседей исключать
 * не нужно: слияние нового куска с соседом ловит проверка «не создать новую
 * серию» в конвейере — она смотрит на готовый ряд, а не на список запретов.
 */
export function replacementTypeOrder(
  tasks: readonly { type?: unknown }[],
  runType: TaskTypeName,
  workType: WorkType | null | undefined,
  subject?: string | null,
): TaskTypeName[] {
  const allowed = replacementCandidates(runType, workType, subject);
  const counts = countTypes(tasks);
  return [...allowed].sort((a, b) => {
    const diff = (counts.get(a) ?? 0) - (counts.get(b) ?? 0);
    if (diff !== 0) return diff;
    return TASK_TYPE_NAMES.indexOf(a) - TASK_TYPE_NAMES.indexOf(b);
  });
}

/**
 * Сколько РАЗНЫХ меток навыка в листе.
 *
 * Нужна, чтобы после замены проверить: разнообразие навыков не должно упасть.
 * Пустые метки в счёт не идут — «метки нет» и «метка такая же» — разные вещи.
 */
export function countDistinctSkills(tasks: readonly { skill?: unknown }[]): number {
  const labels = new Set<string>();
  for (const task of Array.isArray(tasks) ? tasks : []) {
    const label = normalizeLabel(task?.skill);
    if (label) labels.add(label);
  }
  return labels.size;
}
