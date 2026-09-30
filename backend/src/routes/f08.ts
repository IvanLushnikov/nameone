/**
 * /api/worksheets/:id/edit — F-08: инлайн-редактирование листа. Заглушка.
 *
 * Будет: teacher редактирует сгенерированный лист и сохраняет новую версию.
 * Сейчас: 501 на любом пути.
 */

import { Hono } from "hono";
import type { Env } from "../env";

const f08Router = new Hono<{ Bindings: Env }>();

f08Router.all("*", (c) =>
  c.json(
    {
      ok: false,
      code: "NOT_IMPLEMENTED",
      error: "F-08 worksheet edit ещё не реализован",
    },
    501,
  ),
);

export { f08Router };