/**
 * Приём отчётов CSP (report-only) — находка №10 ревью безопасности 30.10.2026.
 *
 * Что проверяем:
 *   1. отчёт принимается и попадает в лог — иначе политика в report-only
 *      бессмысленна: нарушения некуда деваться, и мы не видим, каких
 *      источников не хватает в политике;
 *   2. в лог НЕ попадает query-строка документа: там живут токены входа и
 *      персональные ссылки учеников (/form/<token>, /play/<token>);
 *   3. чужой текст не может сломать лог переводом строки;
 *   4. битый отчёт и отчёт неприлично большого размера не роняют воркер.
 */

/// <reference types="@cloudflare/vitest-plugin" />
import { env, applyD1Migrations } from "cloudflare:test";
import { describe, it, expect, beforeAll, beforeEach, vi, afterEach } from "vitest";
import schemaSql from "../../src/db/schema.sql?raw";
import { app } from "../../src/index";
import type { Env } from "../../src/env";

beforeAll(async () => {
  await applyD1Migrations(env.DB, [{ name: "csp-report", queries: [schemaSql] }]);
});

beforeEach(async () => {
  await (env as unknown as { DB: D1Database }).DB.prepare(`DELETE FROM rate_limits`).run();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function prodEnv(): Env {
  return {
    ...(env as unknown as Env),
    APP_ENV: "production",
    FRONTEND_URL: "https://uchlist.ru",
    APP_PUBLIC_URL: "https://uchlist.ru",
    ALLOW_DEV_MAGIC_URL: "false",
    ALLOW_DEMO_PAYMENTS: "false",
    ALLOW_INSECURE_MODES: undefined,
  } as Env;
}

async function post(body: string, contentType = "application/csp-report"): Promise<Response> {
  return app.fetch(
    new Request("https://api.test/api/security/csp-report", {
      method: "POST",
      headers: { "Content-Type": contentType },
      body,
    }),
    prodEnv() as never,
  );
}

describe("приём отчётов CSP", () => {
  it("старая форма отчёта: нарушение попадает в лог", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });

    const res = await post(
      JSON.stringify({
        "csp-report": {
          "document-uri": "https://uchlist.ru/constructor",
          "violated-directive": "script-src-elem https://mc.yandex.ru",
          "blocked-uri": "https://example.com/tracker.js",
          "source-file": "https://uchlist.ru/_next/static/chunks/app.js",
          "line-number": 12,
        },
      }),
    );

    expect(res.status).toBe(204);
    const joined = logs.join("\n");
    expect(joined).toContain("mc.yandex.ru");
    expect(joined).toContain("example.com/tracker.js");
  });

  it("токен из пути и из query в лог не попадает — там токены", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });

    const res = await post(
      JSON.stringify({
        "csp-report": {
          "document-uri": "https://uchlist.ru/form/tok_secret_12345?token=tok_secret_12345",
          "violated-directive": "script-src 'self'",
          "blocked-uri": "https://example.com/x.js",
        },
      }),
    );

    expect(res.status).toBe(204);
    const joined = logs.join("\n");
    // Токен стоит и в пути, и в query — в лог не попадает ни то, ни другое.
    expect(joined).not.toContain("tok_secret_12345");
    // Остаётся источник: по нему видно, чья это страница.
    expect(joined).toContain("uchlist.ru");
  });

  it("новая форма отчёта (Reporting API) тоже принимается", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });

    const res = await post(
      JSON.stringify({
        type: "csp-violation",
        body: {
          documentURL: "https://uchlist.ru/dashboard",
          effectiveDirective: "img-src 'self'",
          blockedURL: "https://cdn.example.com/pic.png",
        },
      }),
      "application/reports+json",
    );

    expect(res.status).toBe(204);
    expect(logs.join("\n")).toContain("cdn.example.com/pic.png");
  });

  it("чужой перевод строки не ломает лог", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });

    const res = await post(
      JSON.stringify({
        "csp-report": {
          "document-uri": "https://uchlist.ru/x",
          "violated-directive": "script-src 'self'\n{\"msg\":\"подделка записи\"}",
          "blocked-uri": "https://example.com/y.js",
        },
      }),
    );

    expect(res.status).toBe(204);
    // Каждая запись лога — одна строка: подделки чужой записи не создалось.
    for (const line of logs) {
      expect(line.split("\n").length).toBe(1);
    }
  });

  it("битый отчёт не роняет воркер", async () => {
    const res = await post("{ это не json");

    expect(res.status).toBe(204);
  });

  it("слишком большой отчёт отклоняется", async () => {
    const res = await post(JSON.stringify({ "csp-report": { "blocked-uri": "x".repeat(9000) } }));

    expect(res.status).toBe(413);
  });
});
