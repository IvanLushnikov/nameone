/**
 * Приём отчётов CSP — только для режима report-only.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЗАЧЕМ
 *
 * Ревью безопасности 30.10.2026, находка №10: Content-Security-Policy у сайта
 * нет. Это зафиксированное решение владельца от 02.10 — при строгом CSP
 * ломаются Яндекс.Метрика и шрифты, и ломать продакшен ради одной
 * уязвимости не стали.
 *
 * Задача — не сломать это решение, а подготовить следующий безопасный шаг:
 * собрать CSP в режиме `report-only`. В этом режиме браузер НЕ блокирует
 * ничего, но сообщает о каждом нарушении. По этим сообщениям видно, каких
 * источников не хватает в политике, — и только потом можно включать
 * `enforce` (это уже решение владельца).
 *
 * Без приёма отчётов политика в report-only бессмысленна: нарушения просто
 * некуда деваться. Поэтому отчёты принимает этот воркер и пишет их в лог
 * (Cloudflare → `wrangler tail` или дашборд).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО В ЛОГ НЕ ПИШЕТСЯ
 *
 * `document-uri` может содержать токен ученика или входа: на страницах
 * ученика токен стоит В ПУТИ (`/form/<token>`, `/play/<token>`), на странице
 * входа — в query (`?token=...`). Поэтому в лог уходит только источник
 * (origin) документа, а путь и query-строка — никогда.
 *
 * Логи не должны ломаться от чужого текста: переводы строк и управляющие
 * символы вырезаются, длина каждого поля ограничена.
 */
import { Hono } from "hono";
import type { AppEnv } from "../types";
import { rateLimitMiddleware } from "../middleware/ratelimit";

/** Больше этого отчёт не разбираем: это либо мусор, либо попытка засорять лог. */
const MAX_BODY_BYTES = 8 * 1024;

/** Одно поле отчёта в логе. */
const MAX_FIELD = 200;

/**
 * Отчёты прилетают от браузера, а не от живого человека: их может послать
 * кто угодно. Поэтому ограничиваем поток — иначе лог засоряется (это и есть
 * единственная «атака» на эту ручку).
 */
const reportLimit = rateLimitMiddleware({
  limit: 60,
  windowSec: 60,
  bucket: "csp-report",
});

const securityRouter = new Hono<AppEnv>();

/**
 * Убрать из строки всё, чем можно сломать лог, и обрезать по длине.
 *
 * Одной строкой с переводом строки в лог можно замаскировать запись под
 * чужую: поэтому переводы строк и прочие управляющие символы заменяем
 * пробелом, а не вырезаем — так слово не склеивается с соседним.
 */
function sanitize(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const cleaned = String(value)
    // eslint-disable-next-line no-control-regex -- именно эти символы и чистим
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim();
  if (!cleaned) return undefined;
  return cleaned.length > MAX_FIELD ? `${cleaned.slice(0, MAX_FIELD)}…` : cleaned;
}

/**
 * Только источник (origin) документа — без пути и без query.
 *
 * И то и другое может содержать секрет: на страницах ученика токен стоит
 * В ПУТИ (`/form/<token>`, `/play/<token>`), а на странице входа — в query
 * (`?token=...`). Поэтому в лог уходит только `https://uchlist.ru`.
 *
 * Чего не хватает для разбора: на какой странице было нарушение. Этого
 * хватает другого — заблокированного адреса и директивы: они и говорят, что
 * добавлять в политику.
 */
function originOnly(url: unknown): string | undefined {
  const raw = sanitize(url);
  if (!raw) return undefined;
  try {
    return new URL(raw).origin.slice(0, MAX_FIELD);
  } catch {
    return undefined;
  }
}

interface LegacyReport {
  "csp-report"?: {
    "document-uri"?: unknown;
    "violated-directive"?: unknown;
    "blocked-uri"?: unknown;
    "source-file"?: unknown;
    "line-number"?: unknown;
    "column-number"?: unknown;
    "status-code"?: unknown;
  };
}

interface ModernReport {
  type?: unknown;
  body?: {
    documentURL?: unknown;
    effectiveDirective?: unknown;
    blockedURL?: unknown;
    sourceFile?: unknown;
    lineNumber?: unknown;
    columnNumber?: unknown;
    statusCode?: unknown;
  };
}

/** Достать интересные поля из отчёта любого из двух форматов. */
function readReport(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;

  const legacy = (raw as LegacyReport)["csp-report"];
  if (legacy && typeof legacy === "object") {
    return {
      violated: sanitize(legacy["violated-directive"]),
      blocked: sanitize(legacy["blocked-uri"]),
      document: originOnly(legacy["document-uri"]),
      source: sanitize(legacy["source-file"]),
      line: sanitize(legacy["line-number"]),
      column: sanitize(legacy["column-number"]),
      status: sanitize(legacy["status-code"]),
    };
  }

  const modern = (raw as ModernReport);
  if (modern.type === "csp-violation" && modern.body && typeof modern.body === "object") {
    return {
      violated: sanitize(modern.body.effectiveDirective),
      blocked: sanitize(modern.body.blockedURL),
      document: originOnly(modern.body.documentURL),
      source: sanitize(modern.body.sourceFile),
      line: sanitize(modern.body.lineNumber),
      column: sanitize(modern.body.columnNumber),
      status: sanitize(modern.body.statusCode),
    };
  }

  return null;
}

securityRouter.post("/csp-report", reportLimit, async (c) => {
  const declaredLength = Number(c.req.header("content-length") ?? "0");
  if (declaredLength > MAX_BODY_BYTES) {
    return c.json({ ok: false, error: "Report too large" }, 413);
  }

  let raw: unknown = null;
  try {
    // Читаем байтами, а не text(): у отчёта content-type
    // application/csp-report, и text() на таком теле ругается в консоль.
    const buffer = await c.req.arrayBuffer();
    if (buffer.byteLength > MAX_BODY_BYTES) {
      return c.json({ ok: false, error: "Report too large" }, 413);
    }
    const text = new TextDecoder().decode(buffer);
    raw = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    // Битый отчёт — не повод отвечать ошибкой: браузер всё равно ничего
    // не сможет с этим сделать.
    return c.body(null, 204);
  }

  const report = readReport(raw);
  if (report) {
    // Одна строка на нарушение: в логе видно, какой источник и какая
    // директива сработали. Поля с undefined в JSON не попадают.
    // eslint-disable-next-line no-console
    console.warn(JSON.stringify({ msg: "csp: report-only violation", ...report }));
  }

  return c.body(null, 204);
});

export { securityRouter };
