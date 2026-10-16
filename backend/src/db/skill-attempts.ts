/**
 * Попытки по темам: расчёт и чтение (ТЗ-27, куски B и C).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЗАЧЕМ ФАЙЛ ОТДЕЛЁН ОТ `db/journal.ts`
 * ─────────────────────────────────────────────────────────────────────────────
 * Журнал проверок отвечает на вопрос «что я проверял и кто поставил отметку».
 * Здесь — другой вопрос: «какая тема у меня провалилась и что делать завтра».
 * Смешать их в одном модуле значило бы потом искать, какой из двух вопросов
 * пришёл к строке `skill_attempts`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ГЛАВНОЕ: ЧИСТЫЕ ФУНКЦИИ ОТДЕЛЬНО ОТ ЗАПРОСОВ
 * ─────────────────────────────────────────────────────────────────────────────
 * `buildSkillBreakdown`, `findStrugglingStudents` и `taskBreakdown` не ходят в
 * базу: на вход — строки попыток, на выход — то, что показывает учителю. Так их
 * можно проверить тестом без D1 и без workerd, а сервер при этом всё равно
 * считает сам (AD-3: числа считает сервер, браузер только рисует).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ПОЧЕМУ НЕ «ПОСЧИТАЕМ ПРИ ОТКРЫТИИ ВЕДОМОСТИ»
 * ─────────────────────────────────────────────────────────────────────────────
 * «Кто ошибается два раза подряд» и «три последние проверки по теме» — выборка
 * по всем работам класса и по всем ответам в них. Считать это на каждом
 * открытии ведомости — платить одни и те же запросы снова и снова. Дёшево
 * сделать один раз при завершении проверки (AD-2 ТЗ-27).
 */

import type { D1Database } from "@cloudflare/workers-types";
import { shortId } from "../lib/shortid";

// ─────────────────────────────────────────────────────────────────────────────
// Типы
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Одна попытка: ученик на одной работе по одной теме.
 *
 * `correct`/`total` — сколько заданий этой темы оценено верно и сколько всего
 * было оценено. Ответы без вердикта (`is_correct IS NULL`, ждут учителя) в
 * `total` НЕ входят: зачтя «неизвестно» как «неверно», мы занизили бы процент
 * темы из-за работы, которую учитель ещё не посмотрел.
 */
export interface SkillAttempt {
  skill: string;
  correct: number;
  total: number;
  checkedAt: number;
  formId: string;
  responseId: string;
  /** null — ответ по общей ссылке, к ученику не привязан. */
  studentId: string | null;
  studentName?: string | null;
  formTitle?: string | null;
}

/** Строка блока «Темы, где просели». */
export interface SkillBreakdownRow {
  skill: string;
  correct: number;
  total: number;
  /** Сколько попыток по теме всего — учитель видит, что «28 ответов» это счёт попыток. */
  attempts: number;
  /** Unix seconds последней проверки по теме. */
  lastCheckedAt: number;
}

/** Ученик, который ошибается в этой теме две последние проверки подряд. */
export interface StrugglingStudent {
  studentId: string;
  studentName: string;
  /** Даты двух проверок, по которым это видно. Формат `ГГГГ-ММ-ДД`. */
  dates: string[];
}

/** Одна проверка в блоке «эта тема в трёх последних проверках». */
export interface SkillRecentCheck {
  formId: string;
  title: string;
  checkedAt: number;
  /** null — оценивать было нечего. */
  percent: number | null;
}

/** Задание темы в блоке «разбор по заданиям». */
export interface SkillTaskRow {
  formId: string;
  taskNumber: number;
  prompt: string;
  correct: number;
  total: number;
}

/** Ответ карточки темы целиком. */
export interface SkillDetail {
  skill: string;
  recent: SkillRecentCheck[];
  struggling: StrugglingStudent[];
  tasks: SkillTaskRow[];
}

/** Дата попытки в московской? Нет — в датах, которые учитель видит на стенке. */
function dayKey(checkedAt: number): string {
  // UTC-дата, а не локальная: попытка сдана в 23:40 по местному времени не
  // должна «переезжать» на следующий день из-за часового пояса сервера.
  return new Date(checkedAt * 1000).toISOString().slice(0, 10);
}

/** Процент по попытке. null — оценивать было нечего, а не «ноль процентов». */
function percentOf(correct: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((correct / total) * 100);
}

/** Ошибался ли ученик в этой попытке: хотя бы одно задание темы неверно. */
function isWrong(attempt: SkillAttempt): boolean {
  return attempt.total > 0 && attempt.correct < attempt.total;
}

// ─────────────────────────────────────────────────────────────────────────────
// Чистый расчёт
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Срез по темам: сколько верно, сколько всего, сколько попыток.
 *
 * СОРТИРОВКА — ПО ДОЛЕ ВЕРНЫХ, ПО ВОЗРАСТАНИЮ, ХУДШАЯ СВЕРХУ. Это ровно тот
 * порядок, о котором просит учитель: «какая тема у меня провалилась» — вопрос
 * про начало списка, а не про середину. Учитель не должен переставлять список
 * глазами.
 *
 * Темы, где нечего считать (все попытки с `total = 0`), в ответ не попадают:
 * строка «0 из 0, 0%» выглядела бы как провал, которого не было.
 */
export function buildSkillBreakdown(attempts: SkillAttempt[]): SkillBreakdownRow[] {
  const bySkill = new Map<string, SkillBreakdownRow>();

  for (const attempt of attempts) {
    if (attempt.total <= 0) continue;
    const row = bySkill.get(attempt.skill);
    if (row) {
      row.correct += attempt.correct;
      row.total += attempt.total;
      row.attempts += 1;
      if (attempt.checkedAt > row.lastCheckedAt) row.lastCheckedAt = attempt.checkedAt;
    } else {
      bySkill.set(attempt.skill, {
        skill: attempt.skill,
        correct: attempt.correct,
        total: attempt.total,
        attempts: 1,
        lastCheckedAt: attempt.checkedAt,
      });
    }
  }

  return [...bySkill.values()].sort((a, b) => {
    // a.total > 0 у обоих — делить безопасно, ноль отсеян выше.
    const pa = a.correct / a.total;
    const pb = b.correct / b.total;
    if (pa !== pb) return pa - pb;
    // При равных долях сверху та тема, где ошибок больше: 5 из 20 — это слабее,
    // чем 50 из 200, хотя доли одинаковые.
    if (a.total !== b.total) return a.total - b.total;
    return a.skill.localeCompare(b.skill, "ru");
  });
}

/**
 * «Кто ошибается два раза подряд» — по датам, а не по секундам.
 *
 * ЧТО СЧИТАЕТСЯ ОШИБКОЙ: попытка, где есть хотя бы одно неверное задание темы.
 * Не «ноль верных» — одна ошибка из трёх заданий тоже повод поговорить.
 *
 * ПОЧЕМУ ПО ДАТАМ: два ответа одного дня (пересдача, вторая попытка вечером) —
 * одна проверка, а не две. Считать по дате значит не назвать «ошибается два раза
 * подряд» того, кто за вечер отправил работу дважды.
 *
 * ПОСЛЕДНИЕ ДВЕ ДАТЫ — а не любые две: «ошибался, потом справился, снова
 * ошибался» — это уже другая история, и называть её «две ошибки подряд» было бы
 * неправдой.
 *
 * Список УЧИТЕЛЬСКИЙ, а не оценка: поэтому здесь нет ни процентов, ни баллов —
 * только фамилия и две даты, по которым учитель сам поймёт, что смотреть.
 */
export function findStrugglingStudents(
  attempts: SkillAttempt[],
  options: { streak?: number } = {},
): StrugglingStudent[] {
  const streak = options.streak ?? 2;
  const byStudent = new Map<string, SkillAttempt[]>();

  for (const attempt of attempts) {
    if (!attempt.studentId) continue;
    const list = byStudent.get(attempt.studentId);
    if (list) list.push(attempt);
    else byStudent.set(attempt.studentId, [attempt]);
  }

  const out: StrugglingStudent[] = [];
  for (const [studentId, list] of byStudent) {
    // Новые сверху; внутри дня — последняя попытка, потому что пересдача в тот же
    // день заменяет утреннюю, а не дополняет её.
    const sorted = [...list].sort((a, b) => b.checkedAt - a.checkedAt);
    const byDay = new Map<string, SkillAttempt>();
    for (const attempt of sorted) {
      const day = dayKey(attempt.checkedAt);
      if (!byDay.has(day)) byDay.set(day, attempt);
    }

    const days = [...byDay.values()];
    if (days.length < streak) continue;
    const last = days.slice(0, streak);
    if (!last.every(isWrong)) continue;

    out.push({
      studentId,
      // Имя берём у самой свежей попытки: переименование ученика в классе не
      // должно стирать его из уже показанного учителю списка.
      studentName: (last[0]!.studentName ?? "").trim() || "Ученик без имени",
      // Даты в порядке «сначала старые» — так читается глазом: «8-го и 15-го».
      dates: last
        .map((a) => dayKey(a.checkedAt))
        .sort((a, b) => a.localeCompare(b)),
    });
  }

  // Порядок списка — по фамилии: учитель читает его как список, а не как лог.
  return out.sort((a, b) => a.studentName.localeCompare(b.studentName, "ru"));
}

/**
 * Три последние проверки по теме — одна строка на РАБОТУ, а не на попытку.
 *
 * Одна работа = одна строка: двадцать восемь учеников сдали её в один день, и
 * двадцать восемь строк «15 октября» учителю ничего не сказали бы. Процент по
 * работе — среднее по попыткам, а не по одной из них.
 */
export function buildRecentChecks(attempts: SkillAttempt[], limit = 3): SkillRecentCheck[] {
  const byForm = new Map<string, SkillAttempt[]>();
  for (const attempt of attempts) {
    const list = byForm.get(attempt.formId);
    if (list) list.push(attempt);
    else byForm.set(attempt.formId, [attempt]);
  }

  return [...byForm.values()]
    .map((list): SkillRecentCheck => {
      const checkedAt = Math.max(...list.map((a) => a.checkedAt));
      const correct = list.reduce((sum, a) => sum + a.correct, 0);
      const total = list.reduce((sum, a) => sum + a.total, 0);
      return {
        formId: list[0]!.formId,
        title: list[0]!.formTitle ?? "Работа без названия",
        checkedAt,
        percent: percentOf(correct, total),
      };
    })
    .sort((a, b) => b.checkedAt - a.checkedAt)
    .slice(0, limit);
}

/**
 * Сырая статистика по ОДНОМУ заданию темы — то, чем наполняется «разбор по
 * заданиям». Считается из ответов, а не из `skill_attempts`: там строка на
 * «тема + попытка», и по одному заданию из неё не восстановить.
 */
export interface TaskStat {
  formId: string;
  formTitle: string | null;
  taskNumber: number;
  prompt: string;
  skill: string;
  correct: number;
  total: number;
}

/**
 * Разбор по заданиям темы: худшее задание сверху.
 *
 * ВОСХОДЯЩИЙ ПРОЦЕНТ, А НЕ ПРОСТО «БОЛЬШЕ ВСЕГО ОШИБОК»: у задания «3 из 28»
 * и задания «150 из 400» ошибок одинаково много, а провалились они одинаково
 * явно только по доле. Количество в знаменателе показываем рядом — по нему
 * учитель видит, одно это задание или весь класс на нём.
 */
export function buildTaskBreakdown(rows: TaskStat[], skill: string, limit = 20): SkillTaskRow[] {
  return rows
    .filter((r) => r.skill === skill)
    .map((r) => ({
      formId: r.formId,
      taskNumber: r.taskNumber,
      prompt: r.prompt.trim() || `Задание ${r.taskNumber}`,
      correct: r.correct,
      total: r.total,
    }))
    .sort((a, b) => {
      const pa = percentOf(a.correct, a.total) ?? 101;
      const pb = percentOf(b.correct, b.total) ?? 101;
      if (pa !== pb) return pa - pb;
      if (a.total !== b.total) return a.total - b.total;
      return a.formId.localeCompare(b.formId) || a.taskNumber - b.taskNumber;
    })
    .slice(0, limit);
}

/**
 * Прирост процента между двумя проверками — стрелка вверх или вниз.
 *
 * null, когда сравнивать не с чем (одна проверка) или нечего было оценивать.
 * Показывать вместо этого «0%» значило бы выдумать изменение, которого не было.
 */
export function trendPercent(
  recent: SkillRecentCheck[],
): { previous: number; latest: number; percent: number } | null {
  if (recent.length < 2) return null;
  const latest = recent[0]!.percent;
  const previous = recent[1]!.percent;
  if (latest === null || previous === null) return null;
  return { previous, latest, percent: latest - previous };
}

// ─────────────────────────────────────────────────────────────────────────────
// Запись попыток
// ─────────────────────────────────────────────────────────────────────────────

/** Ответ на задание в том виде, в каком его читает пересчёт. */
export interface GradedAnswerRow {
  response_id: string;
  task_number: number;
  is_correct: number | null;
}

/** Привязка ответа к ученику и классу — из `class_student_answers`. */
export interface ResponseOwnerRow {
  response_id: string;
  student_id: string;
  class_id: string;
}

/**
 * Задание листа в том виде, в каком метка навыка доезжает из снимка.
 *
 * Отдельный интерфейс, а не `WorksheetTask`: у листа есть ещё поля, которых в
 * типах бэкенда нет, а нас интересует ровно одно — `skill`.
 */
export interface SkillBearingTask {
  number: number;
  skill?: string | null;
}

/** Снимок заданий формы. */
export function readTaskSkills(tasks: SkillBearingTask[]): Map<number, string> {
  const byNumber = new Map<number, string>();
  for (const task of tasks) {
    if (typeof task.skill !== "string") continue;
    const skill = task.skill.trim();
    // Пустая метка — это «метки нет», а не тема с названием из пробелов.
    if (!skill) continue;
    byNumber.set(Number(task.number), skill);
  }
  return byNumber;
}

export interface RecordAttemptsInput {
  db: D1Database;
  userId: string;
  classId: string;
  formId: string;
  checkedAt: number;
  skillByTask: Map<number, string>;
  answers: GradedAnswerRow[];
  owners: ResponseOwnerRow[];
}

/**
 * Сколько работ разбираем в карточке темы.
 *
 * Потолок, а не «все»: у учителя, который пять лет ведёт один класс, в теме может
 * лежать сорок работ, а карточка показывает разбор по заданиям. Считать все —
 * значит держать в ответе строки, которых учитель не увидит.
 */
const MAX_SCAN_FORMS = 20;

/** id строки попытки: `ska_<12>`. Генерируем здесь, а не в `lib/shortid`. */
function skillAttemptRowId(): string {
  return `ska_${shortId()}`;
}

/**
 * Записать пересчитанные попытки.
 *
 * `id` здесь НЕ участвует в уникальности: строка опознаётся парой
 * «форма + тема + ответ» через UNIQUE-индекс, а пересчёт по этой же работе
 * сносит строки и пишет их заново. Поэтому «три последние проверки» никогда не
 * покажут одну работу дважды.
 */
export async function recordSkillAttempts(input: RecordAttemptsInput): Promise<number> {
  const { db, userId, classId, formId, checkedAt, skillByTask, answers, owners } = input;
  if (skillByTask.size === 0) return 0;

  const ownerByResponse = new Map(owners.map((o) => [o.response_id, o]));

  // Считаем по ответу: сколько заданий этой темы верно и сколько оценено.
  const perResponse = new Map<string, Map<string, { correct: number; total: number }>>();
  for (const answer of answers) {
    const skill = skillByTask.get(Number(answer.task_number));
    if (!skill) continue;
    // Неизвестный вердикт — не «неверно»: иначе процент темы падал бы из-за
    // работы, которую учитель ещё не открыл.
    if (answer.is_correct === null || answer.is_correct === undefined) continue;

    let bySkill = perResponse.get(answer.response_id);
    if (!bySkill) {
      bySkill = new Map();
      perResponse.set(answer.response_id, bySkill);
    }
    const cell = bySkill.get(skill);
    if (cell) {
      cell.total += 1;
      if (answer.is_correct === 1) cell.correct += 1;
    } else {
      bySkill.set(skill, {
        correct: answer.is_correct === 1 ? 1 : 0,
        total: 1,
      });
    }
  }

  const now = Math.floor(Date.now() / 1000);

  // ПЕРЕСЧЁТ, А НЕ ДОЗАПИСЬ: учитель мог поправить отметку в журнале, а мог
  // переименовать тему в листе — и тогда старые строки этой работы стали бы
  // враньём, которое переживёт правку. Сносим работу целиком и пишем заново.
  await db
    .prepare(`DELETE FROM skill_attempts WHERE user_id = ?1 AND class_id = ?2 AND form_id = ?3`)
    .bind(userId, classId, formId)
    .run();

  const batch: D1PreparedStatement[] = [];
  for (const [responseId, bySkill] of perResponse) {
    const owner = ownerByResponse.get(responseId);
    for (const [skill, cell] of bySkill) {
      batch.push(
        db
          .prepare(
            `INSERT INTO skill_attempts
               (id, user_id, class_id, skill, form_id, response_id, student_id,
                checked_at, correct, total, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
          )
          .bind(
            skillAttemptRowId(),
            userId,
            classId,
            skill,
            formId,
            responseId,
            owner?.student_id ?? null,
            checkedAt,
            cell.correct,
            cell.total,
            now,
          ),
      );
    }
  }

  if (batch.length === 0) return 0;
  await db.batch(batch);
  return batch.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Чтение
// ─────────────────────────────────────────────────────────────────────────────

interface AttemptJoinRow {
  skill: string;
  correct: number;
  total: number;
  checked_at: number;
  form_id: string;
  response_id: string;
  student_id: string | null;
  student_name: string | null;
  form_title: string | null;
}

/**
 * Попытки класса по теме (пустая тема — все попытки класса).
 *
 * `user_id` фильтруется ВСЕГДА, даже когда класс уже проверен на владение: лишняя
 * проверка в SQL ничего не стоит, а лишняя утечка стоила бы дорого.
 */
export async function listSkillAttempts(
  db: D1Database,
  userId: string,
  classId: string,
  skill?: string,
): Promise<SkillAttempt[]> {
  const rows = await db
    .prepare(
      `SELECT a.skill, a.correct, a.total, a.checked_at, a.form_id, a.response_id,
              a.student_id, s.name AS student_name, f.title AS form_title
         FROM skill_attempts a
         LEFT JOIN class_students s ON s.id = a.student_id
         LEFT JOIN forms f ON f.id = a.form_id
        WHERE a.user_id = ?1 AND a.class_id = ?2
          AND (?3 IS NULL OR a.skill = ?3)
        ORDER BY a.checked_at DESC, a.response_id ASC`,
    )
    .bind(userId, classId, skill ?? null)
    .all<AttemptJoinRow>();

  return (rows.results ?? []).map((r) => ({
    skill: String(r.skill),
    correct: Number(r.correct ?? 0),
    total: Number(r.total ?? 0),
    checkedAt: Number(r.checked_at ?? 0),
    formId: String(r.form_id),
    responseId: String(r.response_id),
    studentId: r.student_id === null ? null : String(r.student_id),
    studentName: r.student_name ?? null,
    formTitle: r.form_title ?? null,
  }));
}

/**
 * Статистика по заданиям темы прямо из ответов.
 *
 * Считается здесь, а не берётся из `skill_attempts`, потому что строка попытки
 * отвечает на вопрос «как тема в целом», а вопрос учителя в карточке — «какое
 * именно задание провалилось». Это разные группировки одних и тех же ответов.
 *
 * Метка навыка читается из СНИМКА заданий (`payload_json`), как её и правит
 * учитель: отдельной таблицы навыков в проекте нет и не должно быть (AD-1 —
 * две копии на запись рассинхронизируются дороже, чем лишняя колонка).
 */
export async function listTaskStats(
  db: D1Database,
  userId: string,
  classId: string,
  skill: string,
): Promise<TaskStat[]> {
  const forms = await db
    .prepare(
      `SELECT f.id, f.title, f.payload_json
         FROM forms f
        WHERE f.user_id = ?1
          AND EXISTS (SELECT 1 FROM skill_attempts a
                       WHERE a.form_id = f.id AND a.user_id = ?1 AND a.class_id = ?2
                         AND a.skill = ?3)
        ORDER BY f.created_at DESC
        LIMIT ?4`,
    )
    .bind(userId, classId, skill, MAX_SCAN_FORMS)
    .all<{ id: string; title: string; payload_json: string }>();
  if ((forms.results ?? []).length === 0) return [];

  const skillByForm = new Map<string, Map<number, string>>();
  for (const form of forms.results ?? []) {
    try {
      const payload = JSON.parse(form.payload_json) as { tasks?: unknown };
      if (Array.isArray(payload.tasks)) {
        skillByForm.set(form.id, readTaskSkills(payload.tasks as SkillBearingTask[]));
      }
    } catch {
      // Битый снимок — по этой работе разбора не будет, но остальные останутся.
    }
  }

  // Ученик может сдать работу несколько раз. В разборе по заданию он считается
  // ОДИН раз — по последней отправке, ровно как в ведомости: иначе «ошиблись 12
  // человеков» превратилось бы в «14» из-за одного пересдавшего.
  const latest = await db
    .prepare(
      `SELECT sa.student_id, sa.response_id, sa.submitted_at, sa.rowid
         FROM class_student_answers sa
         JOIN class_students s ON s.id = sa.student_id
        WHERE s.class_id = ?1
          AND sa.form_id IN (${(forms.results ?? []).map((_, i) => `?${i + 2}`).join(", ")})`,
    )
    .bind(classId, ...(forms.results ?? []).map((f) => f.id))
    .all<{ student_id: string; response_id: string; submitted_at: number; rowid: number }>();

  const latestByStudent = new Map<string, { response_id: string; submitted_at: number; rowid: number }>();
  for (const row of latest.results ?? []) {
    const prev = latestByStudent.get(String(row.student_id));
    if (
      !prev ||
      Number(row.submitted_at) > Number(prev.submitted_at) ||
      (Number(row.submitted_at) === Number(prev.submitted_at) && Number(row.rowid) > Number(prev.rowid))
    ) {
      latestByStudent.set(String(row.student_id), row);
    }
  }
  // Ключ здесь — ученик, а не работа: пересдача заменяет прежнюю попытку, и в
  // разбор по заданию она не попадает.
  const currentResponses = new Set<string>();
  for (const row of latestByStudent.values()) currentResponses.add(row.response_id);
  if (currentResponses.size === 0) return [];

  const rows = await db
    .prepare(
      // `form_id` лежит в `form_responses`, а не в `form_answers`: ответ хранится
      // рядом со своей попыткой, а не с листом — один и тот же лист учитель может
      // выдать дважды, и ответы к разным работам не должны смешиваться.
      `SELECT a.response_id, r.form_id, a.task_number, a.is_correct,
              f.title AS form_title
         FROM form_answers a
         JOIN form_responses r ON r.id = a.response_id
         JOIN forms f ON f.id = r.form_id
        WHERE f.user_id = ?1
          AND a.response_id IN (${[...currentResponses].map((_, i) => `?${i + 2}`).join(", ")})`,
    )
    .bind(userId, ...currentResponses)
    .all<{
      response_id: string;
      form_id: string;
      task_number: number;
      is_correct: number | null;
      form_title: string;
    }>();

  const promptByFormTask = new Map<string, string>();
  for (const form of forms.results ?? []) {
    let payload: { tasks?: unknown };
    try {
      payload = JSON.parse(form.payload_json) as { tasks?: unknown };
    } catch {
      continue;
    }
    if (!Array.isArray(payload.tasks)) continue;
    for (const raw of payload.tasks) {
      if (!raw || typeof raw !== "object") continue;
      const task = raw as { number?: unknown; text?: unknown };
      if (typeof task.number !== "number" || typeof task.text !== "string") continue;
      promptByFormTask.set(`${form.id}#${task.number}`, task.text);
    }
  }

  const byTask = new Map<string, TaskStat>();
  for (const row of rows.results ?? []) {
    const skills = skillByForm.get(row.form_id);
    if (!skills || skills.get(Number(row.task_number)) !== skill) continue;
    // Вердикта нет — задание ждёт учителя. Считать его «неверным» нельзя: процент
    // темы упал бы из-за работы, которую ещё не посмотрели.
    if (row.is_correct === null || row.is_correct === undefined) continue;

    const key = `${row.form_id}#${row.task_number}`;
    const existing = byTask.get(key);
    if (existing) {
      existing.total += 1;
      if (row.is_correct === 1) existing.correct += 1;
    } else {
      byTask.set(key, {
        formId: row.form_id,
        formTitle: row.form_title ?? null,
        taskNumber: Number(row.task_number),
        prompt: promptByFormTask.get(key) ?? "",
        skill,
        correct: row.is_correct === 1 ? 1 : 0,
        total: 1,
      });
    }
  }

  return [...byTask.values()];
}

/**
 * Пересчитать попытки по темам для ОДНОЙ работы.
 *
 * Вызывается там, где учитель завершает проверку: при исправлении отметки в
 * журнале. Повторная проверка — это и есть «завершение проверки» с точки зрения
 * разбора: до неё процент по теме был бы посчитан по неполным данным.
 *
 * Работа может быть выдана нескольким классам, поэтому пересчёт идёт по КАЖДОМУ
 * классу, который по ней ответил: иначе класс, по которому пересчитали бы
 * последним, получил бы чужие числа.
 *
 * Меток нет — 0 записанных строк, и это НЕ ошибка: старые листы без меток должны
 * выглядеть как раньше (см. ТЗ-27, п. 9).
 */
export async function recomputeFormSkillAttempts(
  db: D1Database,
  userId: string,
  formId: string,
): Promise<number> {
  const form = await db
    .prepare(`SELECT id, payload_json FROM forms WHERE id = ?1 AND user_id = ?2`)
    .bind(formId, userId)
    .first<{ id: string; payload_json: string }>();
  if (!form) return 0;

  let tasks: SkillBearingTask[] = [];
  try {
    const payload = JSON.parse(form.payload_json) as { tasks?: unknown };
    if (Array.isArray(payload.tasks)) tasks = payload.tasks as SkillBearingTask[];
  } catch {
    return 0;
  }
  const skillByTask = readTaskSkills(tasks);
  if (skillByTask.size === 0) return 0;

  const answers = await db
    .prepare(
      `SELECT a.response_id, a.task_number, a.is_correct
         FROM form_answers a
         JOIN form_responses r ON r.id = a.response_id
        WHERE r.form_id = ?1`,
    )
    .bind(formId)
    .all<GradedAnswerRow>();
  if ((answers.results ?? []).length === 0) return 0;

  const owners = await db
    .prepare(
      `SELECT sa.response_id, sa.student_id, s.class_id
         FROM class_student_answers sa
         JOIN class_students s ON s.id = sa.student_id
        WHERE sa.form_id = ?1`,
    )
    .bind(formId)
    .all<ResponseOwnerRow>();
  if ((owners.results ?? []).length === 0) return 0;

  // Дата проверки — по самой свежей отправке работы: «15 октября» должно значить
  // день, когда работу последний раз сдали, а не когда форма была создана.
  const checkedAtRow = await db
    .prepare(`SELECT MAX(submitted_at) AS ts FROM form_responses WHERE form_id = ?1`)
    .bind(formId)
    .first<{ ts: number | null }>();
  const checkedAt = Number(checkedAtRow?.ts ?? Math.floor(Date.now() / 1000));

  const byClass = new Map<string, ResponseOwnerRow[]>();
  for (const owner of owners.results ?? []) {
    const list = byClass.get(owner.class_id);
    if (list) list.push(owner);
    else byClass.set(owner.class_id, [owner]);
  }

  let written = 0;
  for (const [classId, classOwners] of byClass) {
    const classAnswerIds = new Set(classOwners.map((o) => o.response_id));
    written += await recordSkillAttempts({
      db,
      userId,
      classId,
      formId,
      checkedAt,
      skillByTask,
      answers: (answers.results ?? []).filter((a) => classAnswerIds.has(a.response_id)),
      owners: classOwners,
    });
  }
  return written;
}
