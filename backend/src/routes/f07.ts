/**
 * /api/assignments — F-07: CRUD + public + responses. Заглушка.
 *
 * Будет: домашние задания, публичные ссылки, сбор ответов учеников.
 * Сейчас: 501 на любом пути.
 */

import { Hono } from "hono";
import type { Env } from "../env";

const f07Router = new Hono<{ Bindings: Env }>();

f07Router.all("*", (c) =>
  c.json(
    {
      ok: false,
      code: "NOT_IMPLEMENTED",
      error: "F-07 assignments ещё не реализованы",
    },
    501,
  ),
);

export { f07Router };