/**
 * /api/assignments — F-06: photo-check. Заглушка.
 *
 * Будет: POST /:id/photo-check (распознавание фото-ответа школьника).
 * Сейчас: 501 на любом пути.
 */

import { Hono } from "hono";
import type { Env } from "../env";

const f06Router = new Hono<{ Bindings: Env }>();

f06Router.all("*", (c) =>
  c.json(
    {
      ok: false,
      code: "NOT_IMPLEMENTED",
      error: "F-06 photo-check ещё не реализован",
    },
    501,
  ),
);

export { f06Router };