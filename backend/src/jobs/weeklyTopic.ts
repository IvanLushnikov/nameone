/**
 * Тема недели: считаем календарь по cron (09.10.2026).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЗАЧЕМ ЭТО НУЖНО
 * ─────────────────────────────────────────────────────────────────────────────
 * Виджет «Тема недели» на главной считался ВО ВРЕМЯ СБОРКИ САЙТА: проект
 * статический (`output: "export"`), серверный компонент выполняется один раз
 * при деплое. Через неделю дата на странице оставалась прежней — учительница
 * видела «Октябрь · 1–2-я недели» в середине октября и справедливо написала
 * «опять эти дроби 5 класс, нахуя не понятно».
 *
 * Варианты были три:
 *
 *   1. Сделать виджет клиентским и считать дату в браузере. Работает, но
 *      тогда КАЖДЫЙ посетитель считает своё, и при смене часового пояса или
 *      правке календаря страница ведёт себя по-разному.
 *   2. Считать в API при каждом запросе. Работает, но на каждый заход главной
 *      — поход в воркер за значением, которое меняется раз в неделю.
 *   3. Cron считает раз в сутки и кладёт результат в D1. Страница спрашивает
 *      у воркера, воркер отдаёт готовое. Сходится с пунктом 1 (клиент
 *      спрашивает), но не зависит от клиента — при отключённом JS тема не
 *      «уезжает».
 *
 * Выбран третий: дешёво, предсказуемо и не тащит вычисления в браузер.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ПОЧЕМУ ЗДЕСЬ НЕТ САМОЙ ТЕМЫ
 * ─────────────────────────────────────────────────────────────────────────────
 * Темы живут во фронтовом контенте (`src/lib/content/weekly-topics.ts`), и бэк
 * их не видит — это другой пакет. Дублировать список здесь значит завести две
 * правды об одном контенте, которые разъедутся при первой же правке: кто-то
 * допишет тему во фронт и забудет про бэк, и виджет начнёт показывать не то.
 *
 * Поэтому здесь только календарь — «сейчас 6-я учебная неделя, сезон
 * autumn-1», — а тему по этим двум числам выбирает фронт из своего списка.
 * Разделение честное: бэк знает про календарь, фронт — про содержание.
 */

/** Сезоны. Должны совпадать с `Season` во фронте (src/lib/content/calendar.ts). */
export type Season = "autumn-1" | "winter" | "spring-1" | "summer";

export interface WeeklyTopicState {
  weekIndex: number;
  season: Season;
  computedAt: number;
}

/**
 * Расписание сезонов внутри учебного года.
 *
 * Даты — границы периодов в пределах учебного года (сентябрь → май).
 * Верхняя граница года считается отдельно: учебный год переходит в следующий
 * календарный, и жёстко зашитый конец мая в декабре дал бы «не ту» неделю.
 *
 * Порядок важен: `getSeason` берёт первое совпавшее.
 */
const SEASONS: { from: [number, number]; to: [number, number]; season: Season }[] = [
  { from: [8, 1], to: [10, 31], season: "autumn-1" }, // сентябрь–октябрь
  { from: [11, 1], to: [12, 31], season: "winter" }, // ноябрь–декабрь
  { from: [0, 1], to: [2, 20], season: "spring-1" }, // январь–февраль
  { from: [2, 21], to: [7, 31], season: "summer" }, // март–август
];

/**
 * Порядковый номер учебной недели с 1 сентября.
 *
 * Нужен, чтобы тема менялась каждую неделю: даты начала учебного года
 * фиксированы, а «неделя номер 1» — нет. Разница в неделях с 1 сентября и есть
 * та самая ротация.
 */
export function getWeekIndex(now: Date = new Date()): number {
  const year = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  const yearStart = new Date(year, 8, 1);
  const diffMs = now.getTime() - yearStart.getTime();
  // +1: первая неделя учебного года — это первая, а не нулевая.
  return Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1;
}

export function getSeason(now: Date = new Date()): Season {
  const month = now.getMonth();
  const day = now.getDate();
  for (const s of SEASONS) {
    const [fromMonth, fromDay] = s.from;
    const [toMonth, toDay] = s.to;
    if (month > fromMonth || (month === fromMonth && day >= fromDay)) {
      if (month < toMonth || (month === toMonth && day <= toDay)) return s.season;
    }
  }
  // За пределами расписания (например, смена года с новым учебным годом) —
  // берём последний сезон, а не падаем: пустой главной страницы из-за
  // календаря быть не должно.
  return SEASONS[SEASONS.length - 1]!.season;
}

export function computeWeeklyTopicState(now: Date = new Date()): WeeklyTopicState {
  return {
    weekIndex: Math.max(1, getWeekIndex(now)),
    season: getSeason(now),
    computedAt: Math.floor(now.getTime() / 1000),
  };
}

/**
 * Записать актуальное состояние. Вызывается из cron.
 *
 * `INSERT OR REPLACE` с фиксированным `id = 1`: состояние одно на весь сайт,
 * истории не нужно — она только для отладки «а когда последний раз считали».
 */
export async function refreshWeeklyTopicState(db: D1Database, now: Date = new Date()): Promise<WeeklyTopicState> {
  const state = computeWeeklyTopicState(now);
  await db
    .prepare(
      `INSERT INTO weekly_topic_state (id, week_index, season, computed_at)
       VALUES (1, ?1, ?2, ?3)
       ON CONFLICT(id) DO UPDATE SET
         week_index = excluded.week_index,
         season = excluded.season,
         computed_at = excluded.computed_at`,
    )
    .bind(state.weekIndex, state.season, state.computedAt)
    .run();
  return state;
}

/**
 * Прочитать состояние.
 *
 * Если cron ещё ни разу не сработал (только что задеплоили) или таблица
 * пуста — считаем на лету. Пустая главная из-за того, что cron не успел
 * отработать, — это заметная поломка ради экономии одного вычисления.
 *
 * Пересчёт на лету также спасает от протухшей строки: если cron по какой-то
 * причине не ходил неделю (воркер был выключен), мы всё равно отдаём верную
 * неделю, а не ту, что была на момент последнего успешного прогона.
 */
export async function readWeeklyTopicState(db: D1Database, now: Date = new Date()): Promise<WeeklyTopicState> {
  const row = await db
    .prepare(`SELECT week_index, season, computed_at FROM weekly_topic_state WHERE id = 1`)
    .first<{ week_index: number; season: string; computed_at: number }>();

  if (!row) return computeWeeklyTopicState(now);

  // Состояние считается раз в сутки, поэтому «свежее» — это меньше двух суток.
  // Всё, что старше, считаем протухшим: лучше пересчитать, чем отдать неделю,
  // которая уже две недели как закончилась.
  const ageSec = Math.floor(now.getTime() / 1000) - row.computed_at;
  if (ageSec > 2 * 24 * 60 * 60) return computeWeeklyTopicState(now);

  return {
    weekIndex: row.week_index,
    season: row.season as Season,
    computedAt: row.computed_at,
  };
}