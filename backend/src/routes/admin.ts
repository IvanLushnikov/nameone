/**
 * /api/admin/* — заглушка.
 *
 * Будет реализовано в admin-эпике (см. docs/BACKEND_REPORT.md, TBD).
 * Сейчас все эндпоинты отвечают 501, чтобы фронт мог детектировать "фича не готова"
 * и не падать в 404 / 500. Никакой бизнес-логики, никакого доступа к БД.
 */

import { Hono } from "hono";
import type { Env } from "../env";

const adminRouter = new Hono<{ Bindings: Env }>();

adminRouter.all("*", (c) =>
  c.json(
    {
      ok: false,
      code: "NOT_IMPLEMENTED",
      error: "Admin API ещё не реализован",
    },
    501,
  ),
);

export { adminRouter };