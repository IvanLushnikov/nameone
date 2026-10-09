/**
 * GET /api/weekly-topic — календарь «темы недели» для главной (09.10.2026).
 *
 * Отдаёт `{ weekIndex, season }`: на какой неделе учебного года мы находимся
 * и в каком сезоне. Саму тему выбирает фронт из своего контента — так список
 * тем остаётся в одном месте, а не дублируется на бэке.
 *
 * Кэширование на стороне Cloudflare (`Cache-Control`) на сутки — значение
 * меняется раз в неделю, а спрашивают его все посетители главной.
 */
import { Hono } from "hono";
import { readWeeklyTopicState } from "../jobs/weeklyTopic";
import type { AppEnv } from "../types";

const weeklyTopicRouter = new Hono<AppEnv>();

weeklyTopicRouter.get("/", async (c) => {
  const state = await readWeeklyTopicState(c.env.DB);
  // Сутки: значение меняется раз в неделю, а меняться чаще нечему.
  // `stale-while-revalidate` — если фоновое обновление идёт долго, посетитель
  // получит прошлую (всё ещё верную) неделю вместо ожидания.
  c.header("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
  return c.json({
    ok: true,
    weekIndex: state.weekIndex,
    season: state.season,
    computedAt: state.computedAt,
  });
});

export { weeklyTopicRouter };