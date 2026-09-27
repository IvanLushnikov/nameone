/**
 * Тесты для self-verify клиента.
 *
 * Edge cases — то, что DoD просит покрыть:
 *   1. Worker недоступен (ECONNREFUSED) → verified: null, генерация не падает
 *   2. Таймаут (aborted) → verified: null
 *   3. HTTP 500 → verified: null
 *   4. Битый JSON → verified: null
 *   5. Успешный ответ → verified передаётся как есть
 *
 * Mock fetch через vi.stubGlobal.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { selfVerifyTask } from "../self-verify";

const okResponse = (body: unknown) =>
  ({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
  }) as unknown as Response;

const failResponse = (status: number, statusText: string) =>
  ({
    ok: false,
    status,
    statusText,
    json: async () => ({}),
  }) as unknown as Response;

describe("selfVerifyTask — graceful fallback", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("returns null verified when Worker is unreachable (ECONNREFUSED)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed"))
    );

    const r = await selfVerifyTask({
      subject: "math",
      grade: 5,
      topic: "test",
      text: "2 + 2 = ?",
      expectedAnswer: "4",
    });

    expect(r.verified).toBeNull();
    expect(r.answer).toBe("");
    expect(typeof r.explanation).toBe("string");
  });

  it("returns null verified on HTTP 500", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(failResponse(500, "Internal Server Error")));

    const r = await selfVerifyTask({
      subject: "math",
      grade: 5,
      topic: "test",
      text: "x",
    });

    expect(r.verified).toBeNull();
  });

  it("returns null verified on broken JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => {
        throw new Error("invalid json");
      },
    } as unknown as Response));

    const r = await selfVerifyTask({
      subject: "math",
      grade: 5,
      topic: "test",
      text: "x",
    });

    expect(r.verified).toBeNull();
  });

  it("returns null verified on timeout (AbortError)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        () =>
          new Promise((_, reject) => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          })
      )
    );

    const r = await selfVerifyTask({
      subject: "math",
      grade: 5,
      topic: "test",
      text: "x",
    });

    expect(r.verified).toBeNull();
    expect(r.explanation).toContain("Таймаут");
  });
});

describe("selfVerifyTask — success path", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("propagates verified=true from Worker response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        okResponse({
          verified: true,
          answer: "4",
          explanation: "OK",
          model: "gpt-6-luna",
          latency_ms: 1234,
        })
      )
    );

    const r = await selfVerifyTask({
      subject: "math",
      grade: 5,
      topic: "test",
      text: "2 + 2 = ?",
      expectedAnswer: "4",
    });

    expect(r.verified).toBe(true);
    expect(r.answer).toBe("4");
    expect(r.explanation).toBe("OK");
    expect(r.model).toBe("gpt-6-luna");
    expect(r.latency_ms).toBe(1234);
  });

  it("propagates verified=false (Worker says task is wrong)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        okResponse({
          verified: false,
          answer: "5",
          explanation: "Должно быть 4, а не 5",
        })
      )
    );

    const r = await selfVerifyTask({
      subject: "math",
      grade: 5,
      topic: "test",
      text: "2 + 2 = ?",
      expectedAnswer: "4",
    });

    expect(r.verified).toBe(false);
    expect(r.explanation).toContain("4");
  });

  it("treats non-boolean verified as null (defensive)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        okResponse({
          verified: "yes", // не boolean
          answer: "4",
        })
      )
    );

    const r = await selfVerifyTask({
      subject: "math",
      grade: 5,
      topic: "test",
      text: "x",
    });

    expect(r.verified).toBeNull();
  });
});