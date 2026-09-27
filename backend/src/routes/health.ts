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
    env: c.env.APP_ENV ?? "development",
    timestamp: Date.now(),
    version: "0.1.0",
  }),
);

healthRouter.get("/readyz", async (c) => {
  try {
    await c.env.DB.prepare("SELECT 1 AS one").first<{ one: number }>();
    return c.json({ ok: true, db: "ok" });
  } catch (e) {
    return c.json(
      { ok: false, db: "down", error: String(e).slice(0, 200) },
      503,
    );
  }
});

export { healthRouter };
