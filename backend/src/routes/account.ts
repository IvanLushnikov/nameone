/**
 * /api/account/* — заглушка.
 *
 * Будущий личный кабинет + управление magic-link сессиями.
 * magic-link auth уже живёт в /api/auth (см. routes/auth.ts), этот роутер — место
 * для account-self-service эндпоинтов. Пока отвечает 501.
 */

import { Hono } from "hono";
import type { Env } from "../env";

const accountRouter = new Hono<{ Bindings: Env }>();

accountRouter.all("*", (c) =>
  c.json(
    {
      ok: false,
      code: "NOT_IMPLEMENTED",
      error: "Account API ещё не реализован",
    },
    501,
  ),
);

export { accountRouter };