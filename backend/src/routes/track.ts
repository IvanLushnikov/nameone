/**
 * /api/track — заглушка.
 *
 * Серверный event-tracker для фронтовых trackEvent() вызовов.
 * Сейчас фронт пишет события только локально (см. src/lib/track.ts), поэтому
 * эндпоинт не активен. Вернёт 501 если кто-то всё-таки дёрнет напрямую.
 */

import { Hono } from "hono";
import type { Env } from "../env";

const trackRouter = new Hono<{ Bindings: Env }>();

trackRouter.all("*", (c) =>
  c.json(
    {
      ok: false,
      code: "NOT_IMPLEMENTED",
      error: "Server-side tracking ещё не реализован",
    },
    501,
  ),
);

export { trackRouter };