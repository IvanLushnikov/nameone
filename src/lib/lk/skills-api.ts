"use client";

/**
 * Клиент разбора по темам (ТЗ-27, куски B и C).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ОТДЕЛЬНЫЙ ФАЙЛ, А НЕ ДОБАВЛЕНИЕ В `classes-api.ts`
 * ────────────────────────────────────────────────────────────────────────────
 * `classes-api.ts` — список классов, учеников и персональных ссылок; его читает
 * кабинет ещё до ведомости. Здесь — ответ на вопрос ПОСЛЕ проверки, и он живёт
 * по другому префиксу (`/api/journal`, см. `backend/src/routes/journal.ts`).
 * Смешать их в одном файле значило бы, что блок «тем, где просели» пришёл из
 * classes-эндпоинтов, а ручки живут в журнале — и через полгода никто не
 * вспомнит почему.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ЧТО ПРОВЕРЯЕТСЯ НА КЛИЕНТЕ, А ЧТО НЕТ
 * ────────────────────────────────────────────────────────────────────────────
 * Тип ответа проверяется по форме (`parseSkillRow` и соседи), как в
 * `classes-api.ts`: привет от чужого ответа или подмена полей не должны
 * приводить к строке «0 из 0», которую учитель примет за провал темы.
 * Порядок строк при этом НЕ сортируется здесь: худшая тема сверху приходит с
 * сервера (AD-3), и пересортировка в браузере означала бы второй источник
 * правды о том, что провалилось.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * КОНСТРУКТОР: ССЫЛКА С ТЕМОЙ И КЛАССОМ
 * ────────────────────────────────────────────────────────────────────────────
 * `buildTopicPracticeLink` собирает ровно те параметры, которые конструктор уже
 * умеет читать на монтеже (`?subject=&grade=&topic=` — см.
 * `src/app/constructor/page.tsx`), поэтому шаг выбора темы пропускается сам.
 * Отдельный маршрут конструктора под «проверочную по теме» заводить не нужно:
 * это тот же конструктор с подставленными параметрами, а не второй вход.
 */

import type {
  ClassSkillRow,
  SkillDetailData,
  SkillRecentCheck,
  SkillTaskRow,
  StrugglingStudent,
} from "@/lib/journal/types";
import type { ClassesApiError } from "@/lib/lk/classes-api";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

/** Совпадает с `backend/src/routes/journal.ts`. */
const BASE = "/api/journal";

export type SkillApiResult<T> = { ok: true; value: T } | { ok: false; error: ClassesApiError };

/**
 * Растёт ли процент. Возвращает знак, а не готовый текст: слова про «вырос» или
 * «упал» живут в компоненте, где их видно учителю вместе с числом.
 */
export function trendWord(percent: number): "вырос" | "упал" | "не изменился" {
  if (percent > 0) return "вырос";
  if (percent < 0) return "упал";
  return "не изменился";
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null;
}

function parseNumber(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
}

function parsePercent(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function parseSkillRow(raw: unknown): ClassSkillRow | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.skill !== "string" || !raw.skill.trim()) return null;
  return {
    skill: raw.skill,
    correct: parseNumber(raw.correct),
    total: parseNumber(raw.total),
    attempts: parseNumber(raw.attempts),
    percent: parsePercent(raw.percent),
    lastCheckedAt: parseNumber(raw.lastCheckedAt),
  };
}

function parseRecentCheck(raw: unknown): SkillRecentCheck | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.formId !== "string" || typeof raw.title !== "string") return null;
  return {
    formId: raw.formId,
    title: raw.title,
    checkedAt: parseNumber(raw.checkedAt),
    percent: parsePercent(raw.percent),
  };
}

function parseStruggling(raw: unknown): StrugglingStudent | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.studentId !== "string" || typeof raw.studentName !== "string") return null;
  // Даты — единственное, ради чего список вообще читают. Без них строка
  // превращается в утверждение без основания, а такое хуже, чем пустого списка.
  if (!Array.isArray(raw.dates)) return null;
  const dates = raw.dates.filter((d): d is string => typeof d === "string" && d.length > 0);
  if (dates.length === 0) return null;
  return { studentId: raw.studentId, studentName: raw.studentName, dates };
}

function parseTaskRow(raw: unknown): SkillTaskRow | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.formId !== "string") return null;
  return {
    formId: raw.formId,
    taskNumber: parseNumber(raw.taskNumber),
    prompt: typeof raw.prompt === "string" ? raw.prompt : "",
    correct: parseNumber(raw.correct),
    total: parseNumber(raw.total),
  };
}

async function request<T>(
  path: string,
  init: { method: string } = { method: "GET" },
): Promise<SkillApiResult<T>> {
  if (!API_URL) return { ok: false, error: "network" };

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init.method,
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
  } catch {
    return { ok: false, error: "network" };
  }

  if (res.status === 401) return { ok: false, error: "unauthorized" };
  if (res.status === 403) return { ok: false, error: "forbidden" };
  if (res.status === 404) return { ok: false, error: "not_found" };
  if (res.status === 400) return { ok: false, error: "validation" };
  if (!res.ok) return { ok: false, error: "internal" };

  try {
    return { ok: true, value: (await res.json()) as T };
  } catch {
    return { ok: false, error: "internal" };
  }
}

/** GET /api/journal/classes/:id/skills — блок «Темы, где просели». */
export async function loadClassSkills(classId: string): Promise<SkillApiResult<ClassSkillRow[]>> {
  const res = await request<{ skills?: unknown }>(
    `${BASE}/classes/${encodeURIComponent(classId)}/skills`,
  );
  if (!res.ok) return res;
  const rows = Array.isArray(res.value.skills)
    ? res.value.skills.map(parseSkillRow).filter((s): s is ClassSkillRow => s !== null)
    : [];
  return { ok: true, value: rows };
}

/** GET /api/journal/classes/:id/skills/:skill — карточка темы. */
export async function loadSkillDetail(
  classId: string,
  skill: string,
): Promise<SkillApiResult<SkillDetailData>> {
  const res = await request<Record<string, unknown>>(
    `${BASE}/classes/${encodeURIComponent(classId)}/skills/${encodeURIComponent(skill)}`,
  );
  if (!res.ok) return { ok: false, error: res.error };
  const body = res.value;
  if (typeof body.skill !== "string") return { ok: false, error: "internal" };

  return {
    ok: true,
    value: {
      skill: body.skill,
      recent: Array.isArray(body.recent)
        ? body.recent.map(parseRecentCheck).filter((c): c is SkillRecentCheck => c !== null)
        : [],
      struggling: Array.isArray(body.struggling)
        ? body.struggling.map(parseStruggling).filter((s): s is StrugglingStudent => s !== null)
        : [],
      tasks: Array.isArray(body.tasks)
        ? body.tasks.map(parseTaskRow).filter((t): t is SkillTaskRow => t !== null)
        : [],
      trend: isRecord(body.trend)
        ? {
            previous: parseNumber(body.trend.previous),
            latest: parseNumber(body.trend.latest),
            percent: parseNumber(body.trend.percent),
          }
        : null,
    },
  };
}

/**
 * POST /api/journal/forms/:id/recheck — пересчитать разрез после правки отметок.
 *
 * Нужно учителю после того, как он поправил машину: без пересчёта блок «тем, где
 * просели» продолжал бы показывать процент, который он уже изменил глазами.
 */
export async function recheckFormSkills(
  formId: string,
): Promise<SkillApiResult<{ recorded: number }>> {
  const res = await request<{ recorded?: unknown }>(
    `${BASE}/forms/${encodeURIComponent(formId)}/recheck`,
    { method: "POST" },
  );
  if (!res.ok) return res;
  return { ok: true, value: { recorded: parseNumber(res.value.recorded) } };
}

/**
 * Ссылка в конструктор с подставленными темой и классом.
 *
 * Тема идёт параметром `topic`, класс — `grade`: конструктор на монтеже читает
 * их и пропускает шаг выбора темы (см. комментарий у `?subject=&grade=&topic=`
 * в `constructor/page.tsx`). Название работы учитель пишет сам — мы не
 * придумываем за него «Контрольная №4».
 */
export function buildTopicPracticeLink(input: {
  skill: string;
  subject: string;
  grade: number;
}): string {
  const params = new URLSearchParams();
  if (input.subject) params.set("subject", input.subject);
  if (input.grade > 0) params.set("grade", String(input.grade));
  params.set("topic", input.skill);
  return `/constructor?${params.toString()}`;
}