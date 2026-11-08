/**
 * Клиент данных `/superpower` (ТЗ-24).
 *
 * ГЛАВНОЕ ПРАВИЛО ЭТОГО ФАЙЛА — НЕ ПОДМЕНЯТЬ СЕТЬ ФИКТУРАМИ
 * ----------------------------------------------------------
 * Раньше страницы кабинета при недоступном бэке молча показывали
 * демонстрационные данные (`src/lib/mock/`). Для админки это недопустимо:
 * человек открыл экран с выручкой, увидел правдоподобные цифры и ушёл думать,
 * что они настоящие. Поэтому здесь НЕТ ни одного запасного значения —
 * если запрос не прошёл, страница показывает «не удалось загрузить», а не
 * выдуманную статистику.
 *
 * Второе правило: ошибка 401/403 — это не «показать пустую страницу», а
 * понятное «нужен вход». Данные всё равно приходят с проверкой роли на
 * сервере, клиент лишь не должен делать вид, что увидел их.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

/** Формат ответа с данными и признаком «не получилось». */
export interface LoadResult<T> {
  data: T | null;
  error: "no-api" | "unauthorized" | "network" | "server" | null;
}

async function load<T>(path: string): Promise<LoadResult<T>> {
  if (!API_URL) return { data: null, error: "no-api" };

  try {
    const res = await fetch(`${API_URL}${path}`, {
      headers: { accept: "application/json" },
      // Сессия живёт в HttpOnly-cookie: здесь её нельзя и не нужно читать,
      // достаточно отправить cookie вместе с запросом.
      credentials: "include",
      cache: "no-store",
    });

    if (res.status === 401 || res.status === 403) {
      return { data: null, error: "unauthorized" };
    }
    if (!res.ok) {
      return { data: null, error: "server" };
    }
    return { data: (await res.json()) as T, error: null };
  } catch {
    return { data: null, error: "network" };
  }
}

/**
 * Баланс кошелька у провайдера (ТЗ-43).
 *
 * `at` — unix-время снимка баланса. Поле необязательное: сервер отдаёт его
 * с 29.10.2026, а фронт может быть выкачен раньше бэка. Без даты снимка
 * экран честно говорит «дата снимка неизвестна» и НЕ придумывает свежесть.
 */
export interface ProviderBalance {
  amountRub: number;
  availableRub: number | null;
  at?: number | null;
}

/** Экран 1 — светофор. */
export interface Overview {
  month: string;
  today: { events: number; generations: number; signups: number };
  last30: { events: number; activeUsers: number; generations: number };
  money: {
    revenueRub: number;
    costRubActual: number | null;
    costRubEstimate: number | null;
    costShare: number | null;
    divergence: number | null;
    divergenceAlert: boolean;
  };
  activeSubscriptions: number;
  providerBalance: ProviderBalance | null;
}

export const loadOverview = (month?: string): Promise<LoadResult<Overview & { ok: true }>> =>
  load<Overview & { ok: true }>(`/api/admin/overview${month ? `?month=${month}` : ""}`);

/** Экран 2 — экраны и воронка. */
export interface Screens {
  days: number;
  events: Array<{ event: string; total: number; byDay: Array<{ date: string; count: number }> }>;
  funnel: Array<{ step: string; label: string; users: number; fromPrev: number | null }>;
  totals: { events: number; byDay: Array<{ date: string; count: number }> };
}

export const loadScreens = (days: number): Promise<LoadResult<Screens & { ok: true }>> =>
  load<Screens & { ok: true }>(`/api/admin/screens?days=${days}`);

/** Экран 3 — генерации. */
export interface Generations {
  days: number;
  totals: { calls: number; failed: number; fallback: number; cached: number; cacheRate: number };
  byTask: Array<{ task: string; calls: number; costRubActual: number | null }>;
  byDay: Array<{ date: string; calls: number; failed: number }>;
}

export const loadGenerations = (days: number): Promise<LoadResult<Generations & { ok: true }>> =>
  load<Generations & { ok: true }>(`/api/admin/generations?days=${days}`);

/** Экран 4 — деньги подробно. */
export interface Money {
  month: string;
  summary: Overview["money"];
  providerBalance: Overview["providerBalance"];
  topups: {
    count: number;
    /**
     * null — снимков баланса за период было меньше двух, и рост кошелька
     * не виден в принципе. Это НЕ «пополнений не было»: один снимок не
     * знает, что было до него.
     */
    totalRub: number | null;
    byDay: Array<{ date: string; amountRub: number }>;
    /** Сколько снимков баланса попало в период. */
    snapshots?: number;
  };
  costByUser: Array<{
    userId: string | null;
    email: string | null;
    plan: string;
    costRub: number;
    revenueRub: number;
    costShare: number | null;
    overAlert: boolean;
  }>;
  payments: Array<{
    id: string;
    user_id: string | null;
    plan: string;
    amount_rub: number;
    status: string;
    created_at: number;
  }>;
  subscriptions: Array<{
    id: string;
    user_id: string | null;
    plan: string;
    status: string;
    period: string;
    auto_renew: number;
    starts_at: number;
    ends_at: number;
  }>;
}

export const loadMoney = (month?: string): Promise<LoadResult<Money & { ok: true }>> =>
  load<Money & { ok: true }>(`/api/admin/money${month ? `?month=${month}` : ""}`);

/**
 * Человеческие тексты ошибок.
 *
 * Отдельная функция, а не константа: формулировки живут рядом с типом ошибки,
 * иначе страницы начинают писать «что-то пошло не так» по пять раз.
 */
export function loadErrorText(error: LoadResult<unknown>["error"]): string {
  switch (error) {
    case "unauthorized":
      return "Нужен вход администратора";
    case "no-api":
      return "Адрес бэкенда не задан — данные недоступны";
    case "network":
      return "Не удалось связаться с сервером";
    case "server":
      return "Сервер ответил ошибкой";
    default:
      return "";
  }
}

/**
 * Форматирование денег для экрана.
 *
 * null → «нет данных», а не «0 ₽». Разница принципиальная: ноль означал бы
 * «потратили ноль», а «нет данных» — «счёт ещё не забирался».
 */
export function formatRub(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "нет данных";
  return `${value.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}\u00A0₽`;
}

/** Проценты: null → «—», потому что «0%» может означать и «нет данных». */
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString("ru-RU")}%`;
}

/** Дата из unix-секунд: `12 октября`. */
export function formatDay(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

/** Время снимка: `03:00`. */
export function formatClock(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

/** Дата и время снимка: `27 октября, 03:00`. */
export function formatSnapshotTime(ts: number): string {
  return `${formatDay(ts)}, ${formatClock(ts)}`;
}

/**
 * Что экран говорит о балансе провайдера (ТЗ-43).
 *
 * ТРИ СОСТОЯНИЯ, И ВСЕ ОНИ РАЗНЫЕ:
 *
 *   • снимка нет вообще        — механизм ещё ни разу не отработал;
 *   • снимок есть, но не за сегодня — механизм работает, но сегодняшнего
 *     снимка ещё нет (крон снимает в 03:00 UTC);
 *   • снимок за сегодня        — цифра свежая.
 *
 * Раньше на экране было одно «Снимков баланса ещё нет» на все три случая, и
 * по нему нельзя было понять: сломался крон или просто ещё не наступило
 * время снятия. Это разные вещи, и владелец должен видеть разные слова.
 */
export function balanceSnapshotText(
  balance: ProviderBalance | null,
  nowMs: number = Date.now(),
): { fresh: boolean; text: string } {
  if (!balance) {
    return {
      fresh: false,
      text: "Сегодня ещё не снимали: снимков баланса пока нет вообще — суточный крон ещё ни разу не отработал.",
    };
  }

  const at = balance.at;
  if (at === undefined || at === null) {
    return {
      fresh: false,
      text: "Снимок есть, но его дата неизвестна: сервер отдаёт баланс без времени снятия.",
    };
  }

  const atMs = at * 1000;
  const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
  if (utcDay(atMs) === utcDay(nowMs)) {
    return { fresh: true, text: `Снято сегодня в ${formatClock(at)}.` };
  }

  const ageHours = Math.floor((nowMs - atMs) / 3_600_000);
  const tail =
    ageHours >= 48 ? " (больше двух суток назад — крон, похоже, не отрабатывает)" : "";
  return {
    fresh: false,
    text: `Сегодня ещё не снимали. Последний снимок — ${formatSnapshotTime(at)}${tail}.`,
  };
}