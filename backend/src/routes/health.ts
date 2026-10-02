/**
 * /healthz, /readyz — liveness + readiness для Cloudflare Workers / мониторинга.
 *
 *   GET /healthz  → 200 always (даже если DB упала — нам важно знать, что worker жив).
 *   GET /readyz   → 200 если D1 отвечает, 503 если нет.
 */

import { Hono } from "hono";
import type { Env } from "../env";

const healthRouter = new Hono<{ Bindings: Env }>();

healthRouter.get("/healthz", (c) =>
  c.json({
    ok: true,
    // Имя окружения наружу не отдаём. Отдельная метка окружения на публичном
    // эндпоинте — это подсказка атакующему (в dev сюда обычно не долезть,
    // а в prod там другие настройки). Для мониторинга хватает `ok`.
    timestamp: Date.now(),
    version: "0.1.0",
  }),
);

healthRouter.get("/readyz", async (c) => {
  try {
    await c.env.DB.prepare("SELECT 1 AS one").first<{ one: number }>();
    return c.json({ ok: true, db: "ok" });
  } catch (e) {
    // Текст ошибки уходит в лог, а не в ответ. `String(e)` у D1 может
    // содержать детали схемы и текст запроса — это не то, что нужно
    // показывать всем, кто дёрнет /readyz.
    // eslint-disable-next-line no-console
    console.error("[readyz] D1 недоступна:", e);
    return c.json({ ok: false, db: "down" }, 503);
  }
});

export { healthRouter };
