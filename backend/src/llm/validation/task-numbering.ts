/**
 * Нумерация заданий и учёт заданий без ключа (ТЗ-32, части 1 и 2).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЗАЧЕМ НОМЕР ЗАДАЁТ СЕРВЕР, А НЕ МОДЕЛЬ (AD-1)
 *
 * Номер приходил из JSON-ответа модели и печатался как есть
 * (`src/lib/utils/docx.ts` печатает `${task.number}. `). На листе это читалось как
 * «1, 2, 3, 1» — потому что модель нумерует по-своему: нумерация сбивается на
 * выкинутых фильтром заданиях, на повторах и на дозапросе.
 *
 * Это не косметика. На нём построены две вещи:
 *   · строка ответа в DOCX — учитель сверяет работу по номеру;
 *   · карта заданий в сводке по выданному листу (`src/lib/lk/form-summary.ts`),
 *     где два задания с одинаковым номером ЗАТИРАЮТ друг друга: второе не
 *     попадает в сводку вообще.
 *
 * Значит номер — это позиция в готовом листе, а не содержание. Содержанием он
 * был только в голове у модели.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ПОЧЕМУ ПЕРЕНУМЕРОВКА ПОСЛЕ ФИЛЬТРА, А НЕ ДО НЕГО (AD-2)
 *
 * Фильтр выкидывает задания и меняет их количество. Если поставить номера до
 * фильтра, лист получит пропуски вида «1, 2, 4» — а пропуск учитель читает как
 * потерянное задание и пересчитывает вручную. Поэтому единственное правильное
 * место — тут, на выходе конвейера, когда состав листа уже окончательный.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ПОЧЕМУ РАСХОЖДЕНИЕ ЛОГИРУЕТСЯ, А НЕ ЧИНИТСЯ МОЛЧА (AD-3)
 *
 * Перенумеровка — это ремонт, а не проверка. Если модель стабильно нумерует
 * неправильно, это видно по логу, и это дешёвая правка промпта (номер вообще
 * можно убрать из ответа). Если номера чинятся каждый раз молча, никто не
 * узнает, что модель не понимает формат, и правка промпта не случится никогда.
 * Тот же довод, по которому ТЗ-25 перестал выбрасывать `QualityFilterReport`.
 */
import { hasUsableAnswer } from "./quality-filter";
import { logLlmEvent } from "../log";

/** Задание в том виде, в каком оно лежит в листе. */
export interface NumberableTask {
  number?: unknown;
  [key: string]: unknown;
}

export interface RenumberResult<T> {
  /** Задания с номерами по позиции, в том же порядке, что и на входе. */
  tasks: T[];
  /**
   * Номера, которые прислала модель, по позициям задания.
   * `null` — поля `number` у задания не было вовсе.
   */
  modelNumbers: (number | null)[];
  /**
   * Позиции (1..N по порядку в листе), где номер модели не совпал с позицией.
   *
   * Нужно для лога и для теста: показывать это учителю не надо — это признак
   * о качестве работы модели, а не о материале, который учитель получил.
   */
  mismatchedPositions: number[];
}

/** Прочитать номер задания так, как его могла прислать модель. */
function readModelNumber(task: NumberableTask): number | null {
  const raw = task?.number;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return Math.trunc(raw);
}

/**
 * Проставить каждому заданию его позицию в листе: `number = index + 1`.
 *
 * Мутировать входные объекты нельзя: они лежат в кэше листа и в `worksheet`,
 * который возвращается учителю, — тихая правка на месте сделала бы номер
 * зависимым от порядка вызовов. Поэтому возвращается новый массив, а
 * неизменившиеся задания переиспользуются как есть.
 */
export function renumberTasks<T extends NumberableTask>(
  tasks: readonly T[],
): RenumberResult<T> {
  const modelNumbers: (number | null)[] = [];
  const mismatchedPositions: number[] = [];
  let needsCopy = false;

  tasks.forEach((task, index) => {
    const position = index + 1;
    const fromModel = readModelNumber(task);
    modelNumbers.push(fromModel);
    if (fromModel !== position) mismatchedPositions.push(position);
    if (fromModel !== position) needsCopy = true;
  });

  // Совпало всё — возвращаем тот же массив: лишняя копия листа на каждый
  // запрос не нужна, а по ссылке на `worksheet.tasks` сравниваются местами
  // дальше по конвейеру.
  if (!needsCopy) {
    return { tasks: tasks as T[], modelNumbers, mismatchedPositions };
  }

  const renumbered = tasks.map((task, index) => {
    const position = index + 1;
    if (readModelNumber(task) === position) return task;
    return { ...task, number: position };
  });

  return { tasks: renumbered, modelNumbers, mismatchedPositions };
}

/**
 * Посчитать задания, у которых в готовом листе нет ключа (ТЗ-32, AD-4).
 *
 * Считаем по ФИНАЛЬНОМУ списку заданий, а не по отчёту фильтра:
 *   · фильтр обнуляет ответ-заглушку, но задание оставляет (`quality-filter.ts`);
 *   · защита от пустого листа возвращает исходный неотфильтрованный набор,
 *     если отфильтровано больше двух третей.
 *
 * Оба случая дают задание с `answer === null` в выдаче, и оба обязаны быть
 * видны учителю числом: пока это молчание, лист уезжает на печать без ключа.
 *
 * При `withAnswers = false` пустой ответ — законное состояние, и считать его
 * дефектом нельзя: поэтому при `required = false` возвращаем 0.
 */
export function countTasksWithoutAnswer(
  tasks: readonly NumberableTask[],
  /** Учитель просил ответы? */
  required: boolean,
): number {
  if (!required) return 0;
  return tasks.reduce(
    (count, task) => (hasUsableAnswer(task?.answer) ? count : count + 1),
    0,
  );
}

/** Что вернул `numberSheetForDelivery`, кроме самих заданий. */
export interface NumberedSheet<T> extends RenumberResult<T> {
  /** Сколько заданий в листе осталось без ключа. */
  withoutAnswer: number;
}

/**
 * Финальная подготовка листа к отдаче: серверные номера + счётчик пустых
 * ключей + лог расхождения с номерами модели.
 *
 * Отдельной функцией, а не строкой в конвейере, по двум причинам:
 *   · её можно вызвать из теста и проверить, что номер действительно стал
 *     позицией, а расхождение действительно попало в лог;
 *   · её обязаны вызвать ВСЕ стадии, которые отдают лист учителю, а не
 *     только первая: забытый вызов — это снова «1, 2, 3, 1» на печати.
 */
export function numberSheetForDelivery<T extends NumberableTask>(
  tasks: readonly T[],
  opts: {
    /** Предмет — для лога, чтобы видеть, на какой теме модель сбоит. */
    subject: string;
    /** Стадия конвейера: `primary`, `variant2` и т.п. */
    stage: string;
    /** Учитель просил ответы? При `false` пустой ключ — не дефект. */
    withAnswers: boolean;
  },
): NumberedSheet<T> {
  const renumbered = renumberTasks(tasks);

  if (renumbered.mismatchedPositions.length > 0) {
    logLlmEvent("warn", "worksheet-gen: task numbers from model differ from positions", {
      subject: opts.subject,
      stage: opts.stage,
      count: tasks.length,
      // Что прислала модель — целиком, это и есть материал для разбора.
      modelNumbers: renumbered.modelNumbers,
      // Где разошлись — по позициям в готовом листе.
      mismatchedPositions: renumbered.mismatchedPositions,
    });
  }

  const withoutAnswer = countTasksWithoutAnswer(tasks, opts.withAnswers);

  if (withoutAnswer > 0) {
    logLlmEvent("warn", "worksheet-gen: sheet delivered without answers", {
      subject: opts.subject,
      stage: opts.stage,
      withAnswers: opts.withAnswers,
      tasksWithoutAnswer: withoutAnswer,
      count: tasks.length,
    });
  }

  return { ...renumbered, withoutAnswer };
}