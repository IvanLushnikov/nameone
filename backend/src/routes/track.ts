/**
 * /api/track — серверный сбор продуктовых событий.
 *
 * ЗАЧЕМ (ТЗ-24)
 * ------------
 * По коду расставлено 35 событий (`trackEvent(...)` в src/) — «открыл
 * конструктор», «перешёл на шаг 2», «нажал сгенерировать», «дошёл до оплаты».
 * До 12.10.2026 они уходили только в консоль браузера и ТОЛЬКО при
 * `NODE_ENV !== "production"` (см. `src/lib/track.ts`), то есть на боевом сайте
 * статистики по экранам не существовало вообще. Этот эндпоинт — конец
 * заглушке: событие теперь попадает в таблицу `events`, откуда берёт данные
 * `/superpower`.
 *
 * ПРЕВРАЩЕНО ЛИ В ЭТОМ ФАЙЛЕ ЗАГЛУШКА В РАБОТУ
 * --------------------------------------------
 * Да. Прежде здесь стоял `501 NOT_IMPLEMENTED`. Роутер подключён ПОСЛЕДНИМ под
 * префиксом /api и его `all("*")` ловит всё, что не совпало с зарегистрированными
 * адресами, поэтому чужие /api/* по-прежнему отвечают 404 — семантика сохранена
 * (см. комментарий от 07.10.2026 в истории файла).
 *
 * БЕЗОПАСНОСТЬ — ГЛАВНОЕ ПРАВИЛО ФАЙЛА
 * ------------------------------------
 * Событие приходит из браузера, то есть от кого угодно. Поэтому:
 *
 *   1. Имя события сверяется с БЕЛЫМ СПИСКОМ. Неизвестное имя отбрасывается с
 *      400, а не пишется в базу: иначе кто угодно налил бы мусор в `events`
 *      и разогнал статистику.
 *   2. Поля события сверяются с БЕЛЫМ СПИСКОМ КЛЮЧЕЙ. Всё, чего в списке нет,
 *      выбрасывается молча. Это защита от персональных данных: если кто-то
 *      добавит в трек `email` или `userName`, оно не дойдёт до базы, даже если
 *      фронт отправит.
 *   3. Значения — только примитивы (строка / число / булево). Ни объектов, ни
 *      массивов: иначе в `data_json` протащили бы произвольную вложенность.
 *   4. Строки режутся до 120 символов — событие не должно съедать память D1.
 *
 * Что в белый список НЕ попало сознательно: `email` (в коде передаётся только
 * `emailDomain` — домен, а не адрес), любые идентификаторы сессий, имена и
 * фамилии. Идентификатор работы (`id`, `formId`, `check_id`) оставлен: он
 * технический, без него нельзя связать событие с объектом, и сам по себе
 * персональных данных не раскрывает.
 *
 * ОТКАЗ — НЕ ОШИБКА
 * ----------------
 * Событие никогда не должно ломать интерфейс учителя. Ответ всегда 204/400,
 * фронт ни на что не влияет (`navigator.sendBeacon`, ошибки не показываются).
 */

import { Hono } from "hono";
import type { AppEnv } from "../types";
import { rateLimitMiddleware } from "../middleware/ratelimit";

/**
 * Белый список событий. Список снят из кода: `grep -rhoE 'trackEvent\("[a-z_]+"' src/`.
 *
 * Новое событие требует строки здесь. Это не бюрократия: без записи оно
 * молча потеряется на 400, и разработчик узнает об этом на стенде, а не через
 * месяц из пустого графика в `/superpower`.
 */
const ALLOWED_EVENTS = new Set([
  "auth_callback_error",
  "auth_callback_success",
  "auth_callback_view",
  "constructor_artifact_restored",
  "constructor_generate_click",
  "constructor_step",
  "constructor_view",
  "dashboard_artifact_downloaded",
  "dashboard_artifact_opened",
  "dashboard_filter_used",
  "dashboard_subsection_entered",
  "dashboard_template_saved",
  "dashboard_use_template",
  "dashboard_view",
  "dev_demo_login",
  "form_csv_downloaded",
  "form_status_changed",
  "interactive_csv_downloaded",
  // Аудит 18.10.2026 (BUG-001): главная шлёт `landing_view` (src/app/page.tsx),
  // а события не было в белом списке — каждая загрузка главной получала
  // `400 UNKNOWN_EVENT`, и источники переходов с главной не писались вообще.
  "landing_view",
  "login_password_failed",
  "login_password_submit",
  "login_password_success",
  "login_submit",
  "login_view",
  "magic_link_failed",
  "magic_link_requested",
  "magic_link_sent",
  "paywall_open",
  "paywall_plan_click",
  "photo_check_done",
  "photo_check_failed",
  "photo_check_manual_marks_saved",
  "photo_check_photo_deleted",
  "share_form_created",
  "share_form_error",
  "worksheet_edit_apply",
  "worksheet_verify_answers",
]);

/** Белый список ключей `data`. Всё остальное выбрасывается. */
const ALLOWED_FIELDS = new Set([
  "action",
  "check_id",
  "emailDomain",
  "error",
  "format",
  "from",
  "grade",
  "hasCode",
  "id",
  "interactiveId",
  "mode",
  "kind",
  "plan",
  "reason",
  "source",
  "subject",
  "subsection",
  "to",
  "total",
  "session",
  "percentage",
]);

/** Длиннее 120 символов в событии хранить нечего. */
const MAX_VALUE_LEN = 120;

/** Больше 20 полей в одном событии — это не событие, а попытка чем-то набить базу. */
const MAX_FIELDS = 20;

/**
 * Оставить только примитивы из белого списка.
 *
 * Возвращает null, если после фильтрации не осталось ничего: пустое событие в
 * базе бесполезно и только раздувает таблицу.
 */
function sanitizeData(input: unknown): Record<string, string | number | boolean> | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;

  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!ALLOWED_FIELDS.has(key)) continue;
    if (Object.keys(out).length >= MAX_FIELDS) break;

    if (typeof value === "string") {
      out[key] = value.length > MAX_VALUE_LEN ? value.slice(0, MAX_VALUE_LEN) : value;
    } else if (typeof value === "number") {
      // Не-конечные числа в JSON не проходят, а NaN в графике — это «NaN» на экране.
      if (Number.isFinite(value)) out[key] = value;
    } else if (typeof value === "boolean") {
      out[key] = value;
    }
    // Всё остальное (объекты, массивы, null, undefined, функции) — не принимаем.
  }

  return Object.keys(out).length > 0 ? out : null;
}

/** Короткий id строки события — по образцу остальных генераторов в проекте. */
function makeEventId(now: number): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `ev_trk_${now.toString(36)}_${rand}`;
}

const trackRouter = new Hono<AppEnv>();

/**
 * POST /api/track — принять одно событие.
 *
 * Сессия здесь НЕ обязательна: анонимные события (открыл конструктор до входа)
 * — половина интереса, именно по ним строится воронка из раздела 7 ТЗ-24.
 */
trackRouter.post(
  "/track",
  rateLimitMiddleware({ limit: 120, windowSec: 3600, bucket: "track" }),
  async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, code: "BAD_JSON", error: "Тело не разобрать" }, 400);
    }

    const name =
      typeof (body as { name?: unknown })?.name === "string"
        ? (body as { name: string }).name.trim()
        : "";
    const data = sanitizeData((body as { data?: unknown })?.data);

    if (!name) {
      return c.json({ ok: false, code: "NO_NAME", error: "Не указано имя события" }, 400);
    }
    if (!ALLOWED_EVENTS.has(name)) {
      // Ответ без перечисления списка: перечисление превращает эндпоинт в
      // справочник по тому, куда писать, а это не нужно ни клиенту, ни врагу.
      return c.json({ ok: false, code: "UNKNOWN_EVENT", error: "Такого события нет" }, 400);
    }

    // Сессия здесь НЕ обязательна: анонимные события (открыл конструктор до
    // входа) — половина интереса, именно по ним строится воронка из раздела 7
    // ТЗ-24. Поэтому НЕ requireAuth(): он бросает 401 на анонима, и анонимные
    // события просто не доходили бы до базы. Берём пользователя мягко —
    // он уже разобран middleware и равен null, если входа не было.
    const user = c.get("user");
    const now = Math.floor(Date.now() / 1000);

    await c.env.DB.prepare(
      `INSERT INTO events (id, user_id, name, data_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
      .bind(makeEventId(now), user?.id ?? null, name, data ? JSON.stringify(data) : null, now)
      .run();

    // 204 без тела: c.json(..., 204) бросает — ответ с null-body статусом
    // не может нести body. Тело трекеру не нужно, достаточно «принято».
    return c.body(null, 204);
  },
);

// Всё прочее под /api — адреса не существует.
// Порядок важен: роутер подключён последним, и этот catch-all закрывает мусор.
trackRouter.all("*", (c) =>
  c.json(
    {
      ok: false,
      code: "NOT_FOUND",
      error: "Такого адреса нет",
      path: c.req.path,
    },
    404,
  ),
);

export { trackRouter, ALLOWED_EVENTS, ALLOWED_FIELDS };