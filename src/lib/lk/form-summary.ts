/**
 * Разбор формы «по заданиям» (ТЗ-12, этап 8, лист 6.1.7).
 *
 * Зачем файл: учитель смотрит на ведомость по классу и не видит главного — по
 * каким заданиям класс спотыкается. Иначе он открывает 30 работ и считает в
 * уме, что переобъяснить. Вкладка «по заданиям» была отложена на этап 8, и
 * это была сознательно не сделанная работа, а не забытая.
 *
 * ─── Что считается попыткой ─────────────────────────────────────────────────
 * Главная ловушка этого экрана: бэк пишет строку в `form_answers` для КАЖДОГО
 * задания КАЖДОЙ работы, даже если ученик оставил поле пустым
 * (`backend/src/services/formGrading.ts`: «Задания, на которые ученик не
 * отвечал, всё равно попадают в perTask — учитель в сводке должен видеть
 * "пропущено", а не пустоту»). Значит «сколько строк пришло» — это не
 * «сколько попыток». Попытка есть только там, где ученик что-то написал.
 *
 * ─── Три состояния, а не два ────────────────────────────────────────────────
 *   верно · неверно · не уверены.
 * `needsReview` — третье состояние: модель не смогла решить, ответ ждёт
 * учителя. Считать его ошибкой нельзя (этот класс ошибок продукт уже чинил
 * дважды), но и верным он не является. То же самое — `isCorrect === null`
 * при снятой галочке: вердикта нет вообще, это тоже «не уверены».
 *
 * ─── Пусто ≠ «не усвоено» ───────────────────────────────────────────────────
 * Задание без единой попытки стоит в ОТДЕЛЬНОЙ секции «попыток не было» и не
 * попадает в «переобъяснить». Иначе сводка врёт: учитель идёт переобъяснять
 * то, что никто не открывал.
 *
 * ─── Про темы ───────────────────────────────────────────────────────────────
 * Темы у задания на фронте нет: `WorksheetTask` её не несёт, а `GET /forms/:id`
 * отдаёт снимок заданий (`tasks`) без неё — см. `readTaskSnapshot`. Поэтому
 * сводка считается ПО ЗАДАНИЯМ, а подпись берётся из снимка («Задание 3 — текст»).
 * Если бэк однажды отдаст тему, подпись станет лучше, а счёт не изменится.
 *
 * Файл чистый: ни сети, ни React. Всё проверяется обычными массивами
 * (`scripts/check-form-summary.mjs`).
 */

import type { FormResponse, FormResponseAnswer } from "@/lib/forms/types";

/**
 * Ниже этого процента задание попадает в «переобъяснить».
 *
 * Это ПРАВИЛО ЭКРАНА, а не измерение: порога нет в данных, и мы его не
 * выдумываем как факт. Поэтому рядом с процентом всегда стоят сырые числа
 * «N из M» — учитель всегда видит, из чего процент получился, и может не
 * согласиться с порогом, ничего не потеряв.
 */
export const RETEACH_BELOW_PERCENT = 60;

/**
 * Ниже этого числа попыток процент не показываем вовсе.
 *
 * Один неверный ответ из одной попытки — это не «класс не понял тему», это
 * один ученик. Называть это слабым местом класса — такое же враньё, как
 * показать 0 % там, где попыток не было.
 */
export const MIN_ATTEMPTS_FOR_PERCENT = 3;

/** Что сводка советует учителю с заданием. */
export type TaskVerdict =
  /** Ни одного ответа — это «не открывали», а не «не усвоено». */
  | "no_attempts"
  /** Ответов было, но мало: процент здесь не про класс. */
  | "few_attempts"
  /** Класс спотыкается — это и есть повод вернуться к теме. */
  | "reteach"
  /** Усвоено, возвращаться незачем. */
  | "ok";

export interface TaskStats {
  taskNumber: number;
  /** Короткая подпись строки: «Задание 3», плюс текст, если бэк его прислал. */
  label: string;
  /** Текст задания из снимка. `null`, если снимка нет или битый. */
  text: string | null;
  /** Сколько учеников реально что-то написали. */
  attempts: number;
  /** Сколько оставили поле пустым. Это «пропустил», а не «ошибся». */
  skipped: number;
  correct: number;
  wrong: number;
  /** Третье состояние: модель не уверена или ждёт учителя. Не ошибка. */
  unsure: number;
  /** `null`, когда попыток не было. Ноль процентов — это про другое. */
  successPercent: number | null;
  verdict: TaskVerdict;
  /** Одна строка «что делать», а не голый процент. */
  action: string;
}

export interface TaskSummary {
  /** Худшие сверху: что переобъяснить. */
  reteach: TaskStats[];
  /** Всё остальное с попытками. */
  ok: TaskStats[];
  /**
   * Ответов было, но мало (меньше `MIN_ATTEMPTS_FOR_PERCENT`). Процент тут
   * ничего не значит, но задание нельзя ни спрятать, ни назвать слабым —
   * учитель должен увидеть его и посмотреть работы руками.
   */
  fewAttempts: TaskStats[];
  /** Попыток не было. Отдельным списком и ВНЕ `reteach`. */
  noAttempts: TaskStats[];
  /** Одна строка, ради которой учитель вообще открыл этот блок. */
  headline: string;
  /** Пояснение к строке выше. */
  detail: string;
  /**
   * Честная оговорка о данных. Не `null` там, где без снимка заданий
   * сводка неполна — молчать о таком нельзя.
   */
  dataNote: string | null;
}

/* ─── Снимок заданий ───────────────────────────────────────────────────────── */

/** Структура снимка заданий, который кладёт в ответ `GET /forms/:id`. */
interface TaskSnapshotEntry {
  number: number;
  text: string;
}

const NO_SNAPSHOT: TaskSnapshotEntry[] = [];

/**
 * Достаёт снимок заданий из ответа бэка.
 *
 * Тип `FormRecord` (`src/lib/forms/types.ts`) поле `tasks` НЕ объявляет, но
 * бэк его отдаёт (`backend/src/routes/f07.ts`: `tasks: parseTasks(...)`), и
 * `getForm` кладёт в `form` сырой объект ответа. Поэтому читаем осторожно:
 * проверяем каждый элемент и молча возвращаем пустой список, если снимка нет
 * или он битый. Лучше «данных пока нет», чем правдоподобный мусор.
 */
export function readTaskSnapshot(form: unknown): TaskSnapshotEntry[] {
  const raw = (form as { tasks?: unknown } | null | undefined)?.tasks;
  if (!Array.isArray(raw)) return NO_SNAPSHOT;

  const out: TaskSnapshotEntry[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const t = item as { number?: unknown; text?: unknown };
    if (typeof t.number !== "number" || !Number.isFinite(t.number)) continue;
    out.push({ number: t.number, text: typeof t.text === "string" ? t.text : "" });
  }
  return out;
}

/* ─── Счёт ──────────────────────────────────────────────────────────────────── */

/** Ответ ученика пустой? `null`, пробелы и неразрывные пробелы — тоже пусто. */
function isBlank(answer: FormResponseAnswer): boolean {
  const raw = answer.studentAnswer;
  if (typeof raw !== "string") return true;
  return raw.replace(/[\s ]+/g, "") === "";
}

/**
 * Три состояния ответа, разбираются в строгом порядке.
 *
 * 1. Пустой ответ — это «пропустил». Ученик не ошибся, он не отвечал.
 * 2. `needsReview` — модель не смогла решить. Третье состояние.
 * 3. `isCorrect === null` без `needsReview` — вердикта нет вовсе (галочка
 *    сверки снята). Тоже третье состояние, а не ошибка.
 */
function classify(answer: FormResponseAnswer): "skipped" | "unsure" | "correct" | "wrong" {
  if (isBlank(answer)) return "skipped";
  if (answer.needsReview) return "unsure";
  if (answer.isCorrect === true) return "correct";
  if (answer.isCorrect === false) return "wrong";
  return "unsure";
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

function attemptsWord(n: number): string {
  return `${n} ${plural(n, "попытка", "попытки", "попыток")}`;
}

/**
 * Процент — только когда выборка это выдерживает.
 *
 * Одна попытка и 0 верных дают честные «0 из 1», но «0 %» тут враньё: класс
 * не провалил тему, ответил один человек из тридцати. Поэтому при малой
 * выборке процент — `null`, а сырые числа «N из M» остаются.
 */
function successPercentOf(attempts: number, correct: number): number | null {
  if (attempts < MIN_ATTEMPTS_FOR_PERCENT) return null;
  return Math.round((correct / attempts) * 100);
}

function verdictOf(
  attempts: number,
  successPercent: number | null,
): TaskVerdict {
  if (attempts === 0) return "no_attempts";
  if (successPercent === null) return "few_attempts";
  return successPercent < RETEACH_BELOW_PERCENT ? "reteach" : "ok";
}

function actionOf(
  taskNumber: number,
  attempts: number,
  correct: number,
  wrong: number,
  unsure: number,
  skipped: number,
  verdict: TaskVerdict,
): string {
  const num = `Задание ${taskNumber}`;
  switch (verdict) {
    case "no_attempts":
      return skipped > 0
        ? `${num}: никто не ответил — задание пропустили целиком. Усвоена тема или нет, пока неизвестно`
        : `${num}: попыток не было. Никто не открывал — это не значит, что тема не усвоена`;
    case "few_attempts":
      return unsure > 0 && wrong === 0
        ? `${num}: ответили ${attemptsWord(attempts)}, модель не уверена — посмотрите работы сами`
        : `${num}: ответили ${attemptsWord(attempts)} — мало, чтобы судить о классе. Посмотрите работы`;
    case "reteach":
      return `${num}: ${wrong} ${plural(wrong, "ошибка", "ошибки", "ошибок")} из ${attempts} — вернуться к теме` +
        (unsure > 0 ? `, ещё ${unsure} ждут вас` : "");
    case "ok":
      return unsure > 0
        ? `${num}: ${correct} из ${attempts} верно — возвращаться незачем, ${unsure} ждут вас`
        : `${num}: ${correct} из ${attempts} верно — возвращаться незачем`;
  }
}

/** Короткий счёт для строки: «3 из 10» или честное «—», если попыток нет. */
export function countsLabel(row: TaskStats): string {
  if (row.attempts === 0) return "—";
  return `${row.correct} из ${row.attempts}`;
}

/* ─── Сборка сводки ────────────────────────────────────────────────────────── */

export interface BuildTaskSummaryInput {
  /** Все работы класса по этой форме. */
  responses: FormResponse[];
  /** Снимок заданий из ответа бэка (`readTaskSnapshot`). */
  tasks?: TaskSnapshotEntry[];
}

/**
 * Считает разбивку по заданиям. Единственное место, где живут числа сводки —
 * экран только рисует то, что вернулось.
 *
 * Порядок строк — от худшего к лучшему, а задания без попыток уходят в самый
 * низ отдельным списком: иначе «попыток не было» стояло бы рядом с «класс
 * не понял» и учитель не отличил бы их между собой.
 */
export function buildTaskSummary(input: BuildTaskSummaryInput): TaskSummary {
  const responses = Array.isArray(input.responses) ? input.responses : [];
  const tasks = Array.isArray(input.tasks) ? input.tasks : NO_SNAPSHOT;

  const byNumber = new Map<number, TaskSnapshotEntry>();
  for (const t of tasks) byNumber.set(t.number, t);

  const counters = new Map<
    number,
    { attempts: number; skipped: number; correct: number; wrong: number; unsure: number }
  >();

  const bump = (number: number, key: "attempts" | "skipped" | "correct" | "wrong" | "unsure") => {
    let row = counters.get(number);
    if (!row) {
      row = { attempts: 0, skipped: 0, correct: 0, wrong: 0, unsure: 0 };
      counters.set(number, row);
    }
    row[key] += 1;
  };

  for (const response of responses) {
    for (const answer of response?.answers ?? []) {
      if (typeof answer?.taskNumber !== "number") continue;
      const state = classify(answer);
      bump(answer.taskNumber, state);
      // Пустой ответ в «попытки» не идёт: ученик ничего не писал. Иначе
      // «не ответил» выглядел бы как «ответил неверно».
      if (state !== "skipped") bump(answer.taskNumber, "attempts");
    }
  }

  // Номера заданий = снимок + всё, что пришло в ответах.
  const numbers = new Set<number>([...byNumber.keys(), ...counters.keys()]);

  const rows: TaskStats[] = [];
  for (const number of numbers) {
    const c = counters.get(number) ?? {
      attempts: 0,
      skipped: 0,
      correct: 0,
      wrong: 0,
      unsure: 0,
    };
    const successPercent = successPercentOf(c.attempts, c.correct);
    const verdict = verdictOf(c.attempts, successPercent);
    const snapshot = byNumber.get(number);

    rows.push({
      taskNumber: number,
      label: `Задание ${number}`,
      text: snapshot && snapshot.text ? snapshot.text : null,
      attempts: c.attempts,
      skipped: c.skipped,
      correct: c.correct,
      wrong: c.wrong,
      unsure: c.unsure,
      successPercent,
      verdict,
      action: actionOf(number, c.attempts, c.correct, c.wrong, c.unsure, c.skipped, verdict),
    });
  }

  const noAttempts = rows
    .filter((r) => r.verdict === "no_attempts")
    .sort((a, b) => a.taskNumber - b.taskNumber);
  const rest = rows.filter((r) => r.verdict !== "no_attempts");

  // Худшие сверху: ниже процент — выше в списке; при равенстве больше ошибок.
  rest.sort((a, b) => {
    const pa = a.successPercent ?? -1;
    const pb = b.successPercent ?? -1;
    if (pa !== pb) return pa - pb;
    if (a.wrong !== b.wrong) return b.wrong - a.wrong;
    return a.taskNumber - b.taskNumber;
  });

  const reteach = rest.filter((r) => r.verdict === "reteach");
  const ok = rest.filter((r) => r.verdict === "ok");
  const fewAttempts = rest.filter((r) => r.verdict === "few_attempts");

  const { headline, detail } = lead(
    reteach,
    ok,
    fewAttempts,
    noAttempts,
    responses.length,
    tasks.length > 0,
  );

  return {
    reteach,
    ok,
    fewAttempts,
    noAttempts,
    headline,
    detail,
    dataNote: dataNote(tasks.length > 0, responses.length, noAttempts.length),
  };
}

/** Главная строка блока: ответ на вопрос «что мне делать сейчас». */
function lead(
  reteach: TaskStats[],
  ok: TaskStats[],
  fewAttempts: TaskStats[],
  noAttempts: TaskStats[],
  responseCount: number,
  hasTasks: boolean,
): { headline: string; detail: string } {
  if (responseCount === 0) {
    return hasTasks
      ? {
          headline: "Пока нечего разбирать",
          detail: "Ответов ещё не было. Как только класс отправит работы, здесь появится разбивка по заданиям.",
        }
      : {
          headline: "Данных пока нет",
          detail: "Нет ни ответов, ни списка заданий — показать сводку не по чему. Отправьте ссылку классу и вернитесь позже.",
        };
  }

  const unsureTotal = ok.reduce((acc, r) => acc + r.unsure, 0);
  // Оговорки собираем один раз и вставляем во все ветки: пустой список не
  // должен оставлять в тексте висящий пробел или двойную точку.
  const skipNote =
    noAttempts.length > 0
      ? ` ${noAttempts.length} ${plural(noAttempts.length, "задание", "задания", "заданий")} осталось без попыток — по ним судить об усвоении нельзя.`
      : "";
  const fewNote =
    fewAttempts.length > 0
      ? ` По ${fewAttempts.length} ${plural(fewAttempts.length, "заданию", "заданиям", "заданиям")} ответов мало — это смотрите сами.`
      : "";

  if (reteach.length > 0) {
    const names = reteach
      .slice(0, 3)
      .map(
        (r) =>
          `задание ${r.taskNumber} (${r.wrong} ${plural(r.wrong, "ошибка", "ошибки", "ошибок")} из ${r.attempts})`,
      )
      .join(", ");
    const restCount = reteach.length > 3 ? ` и ещё ${reteach.length - 3}` : "";
    // Формулировка через явное число: так не нужно согласовывать падежи
    // («на одном задании — с них» — как раз такая ошибка).
    const lead2 =
      reteach.length === 1
        ? `Слабое место одно: ${names}. Начните разбор с него.`
        : `Слабых мест ${reteach.length}: ${names}${restCount}. Начните разбор с них.`;
    return {
      headline: `Начните с: ${names}${restCount}`,
      detail: `${lead2}${skipNote}${fewNote}`,
    };
  }

  if (ok.length === 0) {
    return {
      headline: "Слабых заданий не видно",
      detail: `Явных пробелов нет.${fewNote}${skipNote}`,
    };
  }

  // «Все задания усвоены» нельзя сказать, пока часть заданий набрала мало
  // ответов: про них мы не знаем ничего, а утверждать — враньё.
  const done = fewAttempts.length > 0 ? "Явных пробелов нет." : "Все задания с ответами разобраны и усвоены.";
  return {
    headline: "Переобъяснять не нужно",
    detail:
      unsureTotal > 0
        ? `${done} ${unsureTotal} ${plural(unsureTotal, "ответ", "ответа", "ответов")} модель не смогла решить — проверьте их вы.${skipNote}${fewNote}`
        : `${done}${skipNote}${fewNote}`,
  };
}

/**
 * Оговорка о данных. `null` только когда данных действительно достаточно —
 * то есть когда есть снимок заданий (иначе нельзя отличить «попыток не было»
 * от «такого задания нет») и ответы есть.
 */
function dataNote(hasTasks: boolean, responseCount: number, noAttemptsCount: number): string | null {
  if (!hasTasks) {
    return "Бэк не прислал список заданий этой формы. Показаны только задания, где есть ответы, — по остальным судить нельзя.";
  }
  if (responseCount === 0) {
    return "Список заданий есть, ответов пока нет — сводка посчитана по нулю попыток и ничего не утверждает.";
  }
  if (noAttemptsCount > 0) {
    return "Задания без попыток помечены отдельно: «попыток не было» — это не «тема не усвоена», такие задания в разбор не идут.";
  }
  return null;
}