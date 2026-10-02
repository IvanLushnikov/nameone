/**
 * /api/turnstile/* — проверка капчи Cloudflare Turnstile.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЗАЧЕМ ЭТОТ ФАЙЛ
 * ─────────────────────────────────────────────────────────────────────────────
 * Антифрод (lib/antifraud.ts) умеет сказать «этот отпечаток стоит проверить»,
 * и generation-роут отдаёт на это 409 TURNSTILE_REQUIRED. Фронт в ответ грузит
 * НЕВИДИМЫЙ виджет Turnstile и повторяет тот же запрос, приложив токен в
 * заголовке `cf-turnstile-response`.
 *
 * Здесь сервер проверяет, что токен настоящий, и запоминает отпечаток как
 * доверенный на 30 дней (TRUST_WINDOW_SECONDS).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * fail-open ПРИ НЕДОСТУПНОСТИ CLOUDFLARE
 * ─────────────────────────────────────────────────────────────────────────────
 * Если сам Cloudflare не отвечает или отвечает ошибкой — мы НЕ блокируем.
 * Учитель, у которого сломался интернет на пять минут посреди урока, не должен
 * за это терять доступ к генератору. Недоступность стороннего сервиса —
 * наша проблема, а не его.
 *
 * Недоступность ≠ ошибка ответа: если Cloudflare ответил `success: false`
 * (токен невалидный или протух) — это честный отрицательный ответ, и он
 * приводит к отказу. Разница принципиальная.
 */

import { Hono } from "hono";
import type { AppEnv } from "../types";
import { BadRequestError } from "../lib/errors";
import {
  fingerprintHash,
  markChallengePassed,
  type CfObject,
} from "../lib/antifraud";
import { logLlmEvent } from "../llm/log";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
/** Не ждём Cloudflare вечно: 10 секунд — предел, при котором не мешаем уроку. */
const TIMEOUT_MS = 10_000;

const turnstileRouter = new Hono<AppEnv>();

/** Ответ siteverify. Интересуют два поля, остальное игнорируем. */
interface SiteverifyResponse {
  success: boolean;
  "error-codes"?: string[];
  challenge_ts?: string;
  hostname?: string;
}

export type VerifyOutcome =
  | { status: "ok"; token: string; hostname: string | null }
  | { status: "invalid"; errorCodes: string[] }
  | { status: "unavailable"; reason: string };

/**
 * Проверить токен Turnstile. Чистая функция поверх fetch — её можно тестировать
 * без сети, подсунув свой fetch.
 */
export async function verifyTurnstileToken(
  secret: string,
  token: string,
  remoteip: string | null,
  doFetch: typeof fetch = fetch,
): Promise<VerifyOutcome> {
  const body = new FormData();
  body.set("secret", secret);
  body.set("response", token);
  if (remoteip) body.set("remoteip", remoteip);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await doFetch(SITEVERIFY_URL, { method: "POST", body, signal: controller.signal });
  } catch (e) {
    return {
      status: "unavailable",
      reason: e instanceof Error ? e.message : String(e),
    };
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    return { status: "unavailable", reason: `HTTP ${res.status}` };
  }

  let data: SiteverifyResponse;
  try {
    data = (await res.json()) as SiteverifyResponse;
  } catch (e) {
    return { status: "unavailable", reason: `bad json: ${String(e)}` };
  }

  if (!data.success) {
    return { status: "invalid", errorCodes: data["error-codes"] ?? ["unknown"] };
  }
  return { status: "ok", token, hostname: data.hostname ?? null };
}

turnstileRouter.post("/verify", async (c) => {
  const token = c.req.header("cf-turnstile-response")?.trim();
  if (!token) throw new BadRequestError("Нет токена капчи (заголовок cf-turnstile-response)");

  const secret = c.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // Секрет не настроен: проверять нечем. Считаем успехом и идём дальше —
    // иначе продукт был бы полностью заблокирован одной переменной окружения.
    logLlmEvent("warn", "turnstile: secret not configured, fail-open", { token: "present" });
    return c.json({ ok: true, checked: false, reason: "not_configured" });
  }

  const ip = c.get("ip") ?? null;
  const outcome = await verifyTurnstileToken(secret, token, ip);

  if (outcome.status === "unavailable") {
    logLlmEvent("warn", "turnstile: siteverify unavailable, fail-open", {
      reason: outcome.reason.slice(0, 200),
    });
    return c.json({ ok: true, checked: false, reason: "unavailable" });
  }

  if (outcome.status === "invalid") {
    logLlmEvent("info", "turnstile: token rejected", {
      errorCodes: outcome.errorCodes,
      hostname: undefined,
    });
    return c.json(
      { ok: false, checked: true, errorCodes: outcome.errorCodes },
      400,
    );
  }

  // Токен настоящий — запоминаем отпечаток как доверенный.
  const fingerprint = await fingerprintHash(
    {
      ip: ip ?? "0.0.0.0",
      userAgent: c.get("userAgent") ?? "",
      cf: (c.req.raw as Request & { cf?: CfObject }).cf,
    },
    c.env.FINGERPRINT_SALT ?? "dev-fingerprint-salt",
  );
  await markChallengePassed(c.env.DB, fingerprint);

  return c.json({ ok: true, checked: true, hostname: outcome.hostname });
});

/**
 * Конфигурация для фронта: задан ли sitekey.
 *
 * Фронт — статический экспорт, поэтому NEXT_PUBLIC_TURNSTILE_SITE_KEY вшивается
 * в бандл на этапе сборки. Этот эндпоинт существует, чтобы фронт мог узнать,
 * стоит ли вообще грузить скрипт: при пустом sitekey виджет не нужен.
 */
turnstileRouter.get("/config", (c) => {
  const siteKey = c.env.TURNSTILE_SECRET_KEY ? "server-configured" : null;
  return c.json({
    ok: true,
    enabled: siteKey != null,
    siteKey: siteKey,
  });
});

export { turnstileRouter };
