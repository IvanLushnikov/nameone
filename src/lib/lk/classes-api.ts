"use client";

/**
 * Клиент списка учеников и персональных ссылок (лист 3.1.1).
 *
 * Образец — соседние файлы кабинета (`src/lib/lk/profile-api.ts`,
 * `src/lib/forms/api.ts`): типизированный union результата, `credentials:
 * "include"` + `cache: "no-store"`, разбор статусов по веткам и НИКАКИХ
 * исключений наружу — вызывающий код сужает тип по `ok`.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ГДЕ ЛЕЖИТ ПРАВДА И ПОЧЕМУ УЧЕНИКИ ТОЛЬКО НА СЕРВЕРЕ ────────────────────────
 * Список классов учителя живёт ещё и на устройстве (`uchlist.classes` в
 * profile-api) — это фильтр кабинета, ему сервер не нужен. Здесь иначе: у
 * ученика есть персональный токен, и этот токен — пропуск к его персональной
 * ссылке. Хранить его в localStorage значило бы класть ключ от чужой
 * персональной ссылки в браузер, доступный любому скрипту на странице.
 *
 * Поэтому: без входа в аккаунт класс с учениками и QR не показываются вообще,
 * и интерфейс говорит это прямо — молчаливое «ничего не нашлось» выглядело бы
 * как поломка. Старые учителя без учеников от этого ничего не теряют: их
 * общая ссылка на форму работает как работала.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ИМЯ УЧЕНИКА В ССЫЛКЕ НЕТ ─────────────────────────────────────────────────
 * `buildPersonalLink` собирает `/form/?t=<токен формы>&st=<токен ученика>`.
 * Ни имени, ни класса, ни номера — только случайные строки. Ученик, получивший
 * QR из рук учителя, не узнает своё имя, а чужие тем более: в ссылке их нет,
 * и сервер их по такой ссылке не отдаёт.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

/** Учительские классы и ученики (совпадает с `backend/src/index.ts`). */
const CLASSES_BASE = "/api/classes";

/* ────────────────────────────────────────────────────────────────────────────
 * Пределы сервера — зеркалят `backend/src/db/classes.ts`.
 *
 * Их здесь знаем не для красоты: без них учитель вставил бы список из 300
 * строк, потратил минуту на ожидание и получил «Сервер не ответил как надо».
 * Считаем на устройстве и говорим заранее.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Длина имени ученика. Обрезанное имя — это уже не он, а ошибка в журнале. */
export const MAX_STUDENT_NAME = 120;

/** Сколько строк принимает одна вставка списка. */
export const MAX_STUDENTS_PER_IMPORT = 200;

/** Сколько учеников может быть в одном классе. */
export const MAX_STUDENTS_PER_CLASS = 200;

/* ────────────────────────────────────────────────────────────────────────────
 * Типы
 * ──────────────────────────────────────────────────────────────────────────── */

export interface RosterStudent {
  id: string;
  name: string;
  /** Персональный токен: едет в ссылку, наружу больше никуда. */
  token: string;
  removed: boolean;
  createdAt: number;
}

export interface RosterRemovedStudent extends RosterStudent {
  /** id класса нужен, чтобы вернуть ученика обратно: по названию это не сделать. */
  classId: string;
  className: string;
}

export interface RosterClass {
  id: string;
  name: string;
  createdAt: number;
  students: RosterStudent[];
  /**
   * Короткий код для ссылки класса (ТЗ-28). null у классов, созданных до
   * миграции: код выдаётся при создании, а выдавать его задним числом — значит
   * рисковать чужим кодом. Учитель увидит «Скопировать» только когда код есть.
   */
  classCode: string | null;
}

/** Работа учителя, которой можно раздать персональные QR. */
export interface TeacherForm {
  id: string;
  token: string;
  title: string;
  subject: string;
  grade: number;
  status: string;
  expiresAt: number;
  /**
   * Сколько ответов сервер уже получил по этой работе (`responsesCount` из
   * `GET /api/assignments/forms`).
   *
   * Это единственное настоящее число «сколько сдали» в этом блоке, и оно
   * относится к работе целиком, а не к ученику: кто именно ответил, сервер
   * отдаёт в drill-down формы. Поэтому здесь оно показывается как «ответов
   * получено», без попытки расписать учеников на «сдал» и «ждёт».
   */
  responsesCount: number;
}

export type ClassesApiError =
  | "network"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "validation"
  | "internal";

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: ClassesApiError };

/* ────────────────────────────────────────────────────────────────────────────
 * Запрос
 * ──────────────────────────────────────────────────────────────────────────── */

async function request<T>(
  path: string,
  init: { method: string; body?: string } = { method: "GET" },
): Promise<ApiResult<T>> {
  if (!API_URL) return { ok: false, error: "network" };

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init.method,
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: init.body,
    });
  } catch {
    return { ok: false, error: "network" };
  }

  let body: Record<string, unknown> | null = null;
  try {
    body = (await res.json()) as Record<string, unknown> | null;
  } catch {
    body = null;
  }

  // 403 — отдельная ветка, а не «internal»: чужой класс и «нет такого» —
  // разные вещи, и интерфейс обязан говорить о них разным текстом.
  if (res.status === 401) return { ok: false, error: "unauthorized" };
  if (res.status === 403) return { ok: false, error: "forbidden" };
  if (res.status === 404) return { ok: false, error: "not_found" };
  if (res.status === 409) return { ok: false, error: "conflict" };
  if (res.status === 400) return { ok: false, error: "validation" };
  if (res.status >= 500) return { ok: false, error: "internal" };
  if (!res.ok) return { ok: false, error: "internal" };
  return { ok: true, value: (body ?? {}) as T };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Разбор ответов
 *
 * Всё, что пришло с сервера, проверяется по форме: привет из чужого ответа или
 * подмена полей не должны приводить к «учитель увидел пустого ученика».
 * ──────────────────────────────────────────────────────────────────────────── */

function parseStudent(raw: unknown): RosterStudent | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.name !== "string" || typeof o.token !== "string") return null;
  return {
    id: o.id,
    name: o.name,
    token: o.token,
    removed: o.removed === true,
    createdAt: typeof o.createdAt === "number" ? o.createdAt : 0,
  };
}

function parseClass(raw: unknown): RosterClass | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.name !== "string") return null;
  const students = Array.isArray(o.students)
    ? o.students.map(parseStudent).filter((s): s is RosterStudent => s !== null)
    : [];
  return {
    id: o.id,
    name: o.name,
    createdAt: typeof o.createdAt === "number" ? o.createdAt : 0,
    students,
    classCode: typeof o.classCode === "string" && o.classCode ? o.classCode : null,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Классы и ученики
 * ──────────────────────────────────────────────────────────────────────────── */

export async function loadRoster(): Promise<ApiResult<{ classes: RosterClass[]; removed: RosterRemovedStudent[] }>> {
  const res = await request<{ classes?: unknown; removedStudents?: unknown }>(CLASSES_BASE);
  if (!res.ok) return res;

  const classes = Array.isArray(res.value.classes)
    ? res.value.classes.map(parseClass).filter((c): c is RosterClass => c !== null)
    : [];
  const removed = Array.isArray(res.value.removedStudents)
    ? res.value.removedStudents
        .map((raw) => {
          const student = parseStudent(raw);
          if (!student) return null;
          const extra = raw as Record<string, unknown>;
          const classId = typeof extra.classId === "string" ? extra.classId : "";
          const className = typeof extra.className === "string" ? extra.className : "";
          // Без classId вернуть ученика нечем — не показываем его в списке
          // убранных, чтобы не предлагать кнопку, которая ничего не сделает.
          if (!classId) return null;
          return { ...student, classId, className };
        })
        .filter((s): s is RosterRemovedStudent => s !== null)
    : [];

  return { ok: true, value: { classes, removed } };
}

export async function createRosterClass(name: string): Promise<ApiResult<RosterClass>> {
  const res = await request<{ class?: unknown }>(CLASSES_BASE, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  if (!res.ok) return res;
  const parsed = parseClass(res.value.class);
  return parsed ? { ok: true, value: parsed } : { ok: false, error: "internal" };
}

export async function renameRosterClass(classId: string, name: string): Promise<ApiResult<{ id: string; name: string }>> {
  const res = await request<{ class?: { id?: string; name?: string } }>(
    `${CLASSES_BASE}/${encodeURIComponent(classId)}`,
    { method: "PATCH", body: JSON.stringify({ name }) },
  );
  if (!res.ok) return res;
  const id = res.value.class?.id;
  const value = res.value.class?.name;
  if (typeof id !== "string" || typeof value !== "string") return { ok: false, error: "internal" };
  return { ok: true, value: { id, name: value } };
}

export async function deleteRosterClass(classId: string): Promise<ApiResult<true>> {
  const res = await request(`${CLASSES_BASE}/${encodeURIComponent(classId)}`, { method: "DELETE" });
  return res.ok ? { ok: true, value: true } : res;
}

export async function addRosterStudents(
  classId: string,
  names: string[],
): Promise<ApiResult<{ students: RosterStudent[]; skipped: number }>> {
  const res = await request<{ students?: unknown; skipped?: number }>(
    `${CLASSES_BASE}/${encodeURIComponent(classId)}/students`,
    { method: "POST", body: JSON.stringify({ names }) },
  );
  if (!res.ok) return res;
  const students = Array.isArray(res.value.students)
    ? res.value.students.map(parseStudent).filter((s): s is RosterStudent => s !== null)
    : [];
  return {
    ok: true,
    value: { students, skipped: typeof res.value.skipped === "number" ? res.value.skipped : 0 },
  };
}

export async function renameRosterStudent(
  classId: string,
  studentId: string,
  name: string,
): Promise<ApiResult<{ id: string; name: string }>> {
  const res = await request<{ student?: { id?: string; name?: string } }>(
    `${CLASSES_BASE}/${encodeURIComponent(classId)}/students/${encodeURIComponent(studentId)}`,
    { method: "PATCH", body: JSON.stringify({ name }) },
  );
  if (!res.ok) return res;
  const id = res.value.student?.id;
  const value = res.value.student?.name;
  if (typeof id !== "string" || typeof value !== "string") return { ok: false, error: "internal" };
  return { ok: true, value: { id, name: value } };
}

export async function removeRosterStudent(classId: string, studentId: string): Promise<ApiResult<true>> {
  const res = await request(
    `${CLASSES_BASE}/${encodeURIComponent(classId)}/students/${encodeURIComponent(studentId)}`,
    { method: "DELETE" },
  );
  return res.ok ? { ok: true, value: true } : res;
}

export async function restoreRosterStudent(classId: string, studentId: string): Promise<ApiResult<true>> {
  const res = await request(
    `${CLASSES_BASE}/${encodeURIComponent(classId)}/students/${encodeURIComponent(studentId)}/restore`,
    { method: "POST" },
  );
  return res.ok ? { ok: true, value: true } : res;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Работы учителя — чтобы было что раздать
 *
 * Список форм ведёт соседний бэкенд-роут (`/api/assignments/forms`, лист 3.1.2),
 * поэтому разбор здесь намеренно снисходительный: нам нужны только id, токен и
 * заголовок. Если формат поменяется, учитель получит «не удалось получить
 * список работ», а не пустой выпадающий список с нулевым числом вариантов.
 * ──────────────────────────────────────────────────────────────────────────── */

const TEACHER_FORMS_BASE = "/api/assignments/forms";

export async function loadTeacherForms(): Promise<ApiResult<TeacherForm[]>> {
  const res = await request<{ forms?: unknown }>(TEACHER_FORMS_BASE);
  if (!res.ok) return res;
  if (!Array.isArray(res.value.forms)) return { ok: false, error: "internal" };

  const forms: TeacherForm[] = [];
  for (const raw of res.value.forms) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.token !== "string") continue;
    forms.push({
      id: o.id,
      token: o.token,
      title: typeof o.title === "string" && o.title ? o.title : "Работа без названия",
      subject: typeof o.subject === "string" ? o.subject : "",
      grade: typeof o.grade === "number" ? o.grade : 0,
      status: typeof o.status === "string" ? o.status : "open",
      expiresAt: typeof o.expiresAt === "number" ? o.expiresAt : 0,
      // Счётчик ответов — обычное число с сервера. Если его нет (старый ответ
      // бэка, чужой формат), показываем 0, а не «нет данных»: «нет данных»
      // выглядело бы как поломка и учитель перестал бы доверять счётчику.
      responsesCount: typeof o.responsesCount === "number" && o.responsesCount > 0 ? o.responsesCount : 0,
    });
  }
  return { ok: true, value: forms };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Ссылка и массовый импорт
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Персональная ссылка ученика на работу.
 *
 * Страница ученика — `/form/?t=<токен формы>`, а `st` добавляет «это личный
 * ответ»: сервер по нему подставит имя, а ученик его не увидит.
 *
 * Публичный `origin` передаётся снаружи, а не берётся из `window` здесь: функция
 * остаётся чистой и проверяемой тестом без браузера.
 */
export function buildPersonalLink(origin: string, formToken: string, studentToken: string): string {
  return `${origin.replace(/\/+$/, "")}/form/?t=${encodeURIComponent(formToken)}&st=${encodeURIComponent(studentToken)}`;
}

/**
 * Разобрать список учеников из вставленного текста.
 *
 * Учитель копирует список из журнала или из классного чата, поэтому режем по
 * переводу строки, запятой и точке с запятой, а не только по строкам. Пунктуация
 * вида «1. Иванов И.» не мешает: это имя, а не номер.
 *
 * Точные повторы внутри одной вставки выкидываем — иначе двойной клик по
 * «вставить» даст удвоенных учеников с двумя разными QR.
 *
 * Про длину имён и предел строк знает вызывающий код: здесь только разбор
 * текста, без знания о серверных лимитах.
 */
export function parseRosterPaste(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const piece of raw.split(/[\n\r;]+|,/)) {
    const name = piece.replace(/\s+/g, " ").trim();
    if (!name) continue;
    const key = name.toLocaleLowerCase("ru");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Понятная причина отказа — по одному месту в интерфейсе, без словаря ошибок. */
export function explainError(error: ClassesApiError): string {
  switch (error) {
    case "unauthorized":
      return "Нужен вход в аккаунт: персональные ссылки хранятся на сервере, а не в браузере";
    case "forbidden":
      return "Это класс другого учителя";
    case "not_found":
      return "Класса или ученика нет — возможно, его удалили";
    case "conflict":
      return "Такой класс или ученик уже есть";
    case "validation":
      return "Проверьте написание: пустое или слишком длинное имя сохранить нельзя";
    case "network":
      return "Нет связи с сервером. Проверьте интернет и попробуйте ещё раз";
    default:
      return "Сервер не ответил как надо. Попробуйте ещё раз";
  }
}