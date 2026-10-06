/// <reference types="@cloudflare/vitest-pool-workers" />
/**
 * POST /api/llm/verify — главное свойство: ПОДСТАВНОГО ОТВЕТА НЕТ НИКОГДА.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ЛОВИТ ЭТОТ ТЕСТ
 * ─────────────────────────────────────────────────────────────────────────────
 * До 10.10.2026 проверка жила в отдельном воркере `worker-self-verify/`, у
 * которого не было POLZA_API_KEY, и код при отсутствии ключа возвращал
 *
 *     { verified: true, answer: <expectedAnswer>, model: "mock", mock: true }
 *
 * Для учителя это неотличимо от настоящей проверки: работа помечалась проверенной
 * по эталону, который модель не решала. Ответ на такой запрос решает, зачтена
 * ли ученику работа, поэтому подмена здесь недопустима ни при каких условиях.
 *
 * Тест фиксирует ровно это свойство: без ключа эндпоинт НЕ отвечает 200 и НЕ
 * содержит поля `verified` — он отвечает ошибкой 503. Фронт (src/lib/llm/
 * self-verify.ts) превращает её в `verified: null` и рисует «— не проверено».
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО НЕ ПОКРЫТО
 * ─────────────────────────────────────────────────────────────────────────────
 * Ветка «ключ есть, провайдер упал» и «модель вернула не-JSON» здесь не
 * проверяется: для неё нужен настоящий вызов polza.ai, а в тестах его быть
 * не должно (это платный API и зависимость от сети). Эти ветки закрыты
 * конструкцией кода — вызов идёт через callWithFallback, который бросает
 * ошибку, а парсер возвращает null → 502 (см. verifySelfTask в src/llm/index.ts).
 * Живой интеграционный тест с ключом — отдельная задача.
 */

import { env, applyD1Migrations } from "cloudflare:test";
import { Hono } from "hono";
import { describe, it, expect, beforeAll } from "vitest";
import type { Env } from "../../src/env";
import type { AppEnv } from "../../src/types";
import { llmRouter } from "../../src/routes/llm";
import { errorMiddleware } from "../../src/middleware/error";
import { verifySelfTask } from "../../src/llm";
import { ApiError } from "../../src/lib/errors";

/**
 * Ровно та таблица, которую трогает rateLimitMiddleware на этом роуте.
 * workerd не умеет fs.readFileSync, поэтому схема зашита руками (как в
 * publicForms.test.ts); полный schema.sql тут не нужен.
 */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS rate_limits (
  id            TEXT PRIMARY KEY,
  key           TEXT NOT NULL UNIQUE,
  count         INTEGER NOT NULL,
  window_start  INTEGER NOT NULL
);
`;

/**
 * Роут поднимается ЛОКАЛЬНО, а не через SELF: так можно подсунуть env без
 * POLZA_API_KEY. Через SELF взялся бы env из wrangler.toml, и при наличии
 * секрета тест ушёл бы в реальный платный вызов LLM.
 */
function testApp() {
  const app = new Hono<AppEnv>();
  app.route("/api/llm", llmRouter);
  app.onError(errorMiddleware);
  return app;
}

/** POST на /api/llm/verify с ЗАДАВАЕМЫМ env — так можно подсунуть отсутствие ключа. */
async function postVerify(testEnv: Env, body: unknown): Promise<Response> {
  return testApp().request(
    "/api/llm/verify",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    testEnv,
  );
}

/** Окружение без POLZA_API_KEY — ровно то состояние, которое ломало проверку. */
const envWithoutKey = { ...env, POLZA_API_KEY: undefined } as unknown as Env;

const VALID_BODY = {
  subject: "math",
  grade: 5,
  topic: "drobi",
  task: { text: "Сколько будет 1/2 + 1/3?", expectedAnswer: "5/6" },
};

/** Дождаться ошибки и вернуть её — успешный резолв здесь считаем падением теста. */
async function captureError(promise: Promise<unknown>): Promise<ApiError> {
  let caught: unknown;
  try {
    await promise;
  } catch (e) {
    caught = e;
  }
  if (caught === undefined) {
    throw new Error("verifySelfTask должен был бросить ошибку, но отработал успешно");
  }
  return caught as ApiError;
}

describe("POST /api/llm/verify · нет подставного ответа", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, [{ name: "self-verify", queries: [SCHEMA_SQL] }]);
  });

  it("без POLZA_API_KEY отвечает 503, а не 200 с verified", async () => {
    const res = await postVerify(envWithoutKey, VALID_BODY);

    expect(res.status).toBe(503);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(false);
    // Главное утверждение теста: `verified` в теле ответа НЕТ вообще.
    // Ни true, ни false, ни null — ответа модели не было, значит и вердикта нет.
    expect(body).not.toHaveProperty("verified");
    expect(body).not.toHaveProperty("answer");
  });

  it("ошибка без ключа называет код LLM_UNAVAILABLE ( фронт по нему логирует)", async () => {
    const res = await postVerify(envWithoutKey, VALID_BODY);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("LLM_UNAVAILABLE");
  });

  it("битое тело → 400, а не 200", async () => {
    const res = await postVerify(envWithoutKey, { subject: "math" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("verified");
  });
});

describe("verifySelfTask · слой LLM", () => {
  it("без ключа бросает 503 ДО сетевого вызова", async () => {
    // Ключа нет → pickModel отдаёт primary: null → вызов не делается вовсе.
    // Поэтому тесту не нужны ни сеть, ни ключ, ни провайдер.
    await expect(
      verifySelfTask(
        {
          task: {
            subject: "math",
            grade: 5,
            topic: "drobi",
            text: "Сколько будет 1/2 + 1/3?",
            expectedAnswer: "5/6",
          },
          userId: null,
          plan: "free",
        },
        envWithoutKey,
        env.DB,
      ),
    ).rejects.toBeInstanceOf(ApiError);

    const error = await captureError(
      verifySelfTask(
        {
          task: {
            subject: "math",
            grade: 5,
            topic: "drobi",
            text: "Сколько будет 1/2 + 1/3?",
            expectedAnswer: "5/6",
          },
          userId: null,
          plan: "free",
        },
        envWithoutKey,
        env.DB,
      ),
    );

    expect(error.status).toBe(503);
    expect(error.code).toBe("LLM_UNAVAILABLE");
  });

  it("эталон из запроса не попадает в сообщение об ошибке", async () => {
    // Эталон — это ответ, который ученик не должен видеть. В тексте ошибки он
    // не нужен: фронт всё равно показывает «не проверено».
    const error = await captureError(
      verifySelfTask(
        {
          task: {
            subject: "math",
            grade: 5,
            topic: "drobi",
            text: "Сколько будет 1/2 + 1/3?",
            expectedAnswer: "СЕКРЕТНЫЙ_ЭТАЛОН_42",
          },
          userId: null,
          plan: "free",
        },
        envWithoutKey,
        env.DB,
      ),
    );

    expect(error.message).not.toContain("СЕКРЕТНЫЙ_ЭТАЛОН_42");
  });
});

describe("разбор ответов модели (чистые функции)", () => {
  it("эталонный формат solve-текста даёт число, а не всю строку", async () => {
    const { extractSelfVerifyAnswer } = await import("../../src/llm");
    const text = "Шаг 1: складываем дроби\nШаг 2: общий знаменатель 6\nОтвет: 5/6";
    expect(extractSelfVerifyAnswer(text)).toBe("5/6");
  });

  it("verify-JSON в обрамлении ```json всё равно разбирается", async () => {
    const { parseSelfVerifyJson } = await import("../../src/llm");
    const raw = 'Вот результат:\n```json\n{"verified": false, "reason": "Ответ неверный"}\n```';
    expect(parseSelfVerifyJson(raw)).toEqual({
      verified: false,
      reason: "Ответ неверный",
    });
  });

  it("не-JSON и JSON без verified → null, а не догадка «true»", async () => {
    const { parseSelfVerifyJson } = await import("../../src/llm");
    expect(parseSelfVerifyJson("модель уверен, что всё верно")).toBeNull();
    expect(parseSelfVerifyJson('{"reason": "ok"}')).toBeNull();
  });

  it("пустой solve-текст даёт пустой ответ, а не строку-обрывок", async () => {
    // На этом значении verifySelfTask отвечает 502 «модель не вернула ответ»,
    // а не отправляет проверяющему пустоту.
    const { extractSelfVerifyAnswer } = await import("../../src/llm");
    expect(extractSelfVerifyAnswer("")).toBe("");
    expect(extractSelfVerifyAnswer("   \n\n  ")).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ЭТАЛОН В ПЕРВОМ ПРОХОДЕ ЗАПРЕЩЁН
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Параметр `expectedAnswer` удалён из типа SOLVE_PROMPT не «на всякий случай»:
 * если он вернётся (кто-то добавит поле «для улучшения точности»), тест ниже
 * упадёт. Это единственная защита от тихого возврата поломки, которую нельзя
 * поймать обычным тестом на результат: проверяется сам механизм проверки.
 */
describe("SOLVE_PROMPT не видит эталон", () => {
  const TASK = {
    subject: "math",
    grade: 5,
    topic: "drobi",
    taskText: "Сколько будет 3/8 + 1/8?",
  };

  it("текст решающего промпта не содержит подсказки с ответом", async () => {
    const { SOLVE_PROMPT } = await import("../../src/llm/prompts/self-verify");
    const text = SOLVE_PROMPT(TASK);
    expect(text).not.toContain("42");
    expect(text).not.toMatch(/подсказк/i);
    expect(text).not.toMatch(/известный ответ/i);
    expect(text).not.toMatch(/эталон/i);
  });

  it("тип SOLVE_PROMPT не принимает expectedAnswer (компиляция это ловит)", async () => {
    const { SOLVE_PROMPT } = await import("../../src/llm/prompts/self-verify");
    // @ts-expect-error параметр намеренно отсутствует: передача — ошибка компиляции.
    const text = SOLVE_PROMPT({ ...TASK, expectedAnswer: "42" });
    // На уровне рантайма лишний ключ просто игнорируется и в текст не попадает.
    expect(text).not.toContain("42");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VERIFY_PROMPT: правило проверки должно быть однозначным
// ─────────────────────────────────────────────────────────────────────────────
describe("VERIFY_PROMPT сравнивает ответ с эталоном", () => {
  it("передаёт извлечённый ответ отдельной строкой и требует обоих значений при расхождении", async () => {
    const { VERIFY_PROMPT } = await import("../../src/llm/prompts/self-verify");
    const text = VERIFY_PROMPT({
      subject: "math",
      grade: 5,
      taskText: "Сколько будет 3/8 + 1/8?",
      proposedAnswer: "1/2",
      expectedAnswer: "42",
    });
    expect(text).toContain("Ответ решения");
    expect(text).toContain("1/2");
    expect(text).toContain("Эталонный ответ из банка задач: 42");
    // Правило расхождения обязано требовать оба значения, иначе модель пишет
    // «неверно» вообще и непонятно, что именно не сошлось.
    expect(text).toContain("Расходятся");
    expect(text).toContain("Оба значения обязательны");
    // Эквивалентные записи — явными примерами, а не «сравни аккуратно».
    expect(text).toContain("4/8 и 1/2");
    expect(text).toContain("42 и 1/2");
    expect(text).toContain('{"verified": true | false, "reason"');
  });

  it("без эталона просит проверять корректность решения, а не искать эталон", async () => {
    const { VERIFY_PROMPT } = await import("../../src/llm/prompts/self-verify");
    const text = VERIFY_PROMPT({
      subject: "math",
      grade: 5,
      taskText: "Сколько будет 3/8 + 1/8?",
      proposedAnswer: "1/2",
    });
    expect(text).toContain("Эталона нет");
    expect(text).toContain("нормальный случай");
    expect(text).not.toContain("Эталонный ответ из банка задач");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ДЕТЕРМИНИРОВАННАЯ СВЕРКА — обе стороны
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Сверка нужна потому, что правку промпта нечем проверить тестом: модель может
 * в любой момент ответить «верно» на что угодно. Здесь видно главное свойство —
 * расхождение с эталоном не может остаться «верно» — и обратное свойство,
 * без которого сверка опасна: эквивалентные записи не считаются расхождением.
 */
describe("детерминированная сверка ответа с эталоном", () => {
  it("модель сказала «верно», а ответ не сходится с эталоном → НЕ верно", async () => {
    const { reconcileSelfVerifyVerdict } = await import("../../src/llm/validation/answer-check");
    const verdict = reconcileSelfVerifyVerdict({
      modelVerified: true,
      proposedAnswer: "1/2",
      expectedAnswer: "42",
    });
    expect(verdict.verified).toBe(false);
    expect(verdict.overridden).toBe(true);
    // Пояснение обязано называть оба значения — по нему учитель понимает вердикт.
    expect(verdict.note).toContain("1/2");
    expect(verdict.note).toContain("42");
  });

  it("эталон совпадает с решением → остаётся «верно»", async () => {
    const { reconcileSelfVerifyVerdict } = await import("../../src/llm/validation/answer-check");
    expect(
      reconcileSelfVerifyVerdict({ modelVerified: true, proposedAnswer: "1/2", expectedAnswer: "1/2" }),
    ).toEqual({ verified: true, overridden: false, note: null });
  });

  it("модель сказала «неверно», а ответы совпали → неверность остаётся (сверка не выдаёт «верно»)", async () => {
    const { reconcileSelfVerifyVerdict } = await import("../../src/llm/validation/answer-check");
    expect(
      reconcileSelfVerifyVerdict({ modelVerified: false, proposedAnswer: "1/2", expectedAnswer: "1/2" }),
    ).toEqual({ verified: false, overridden: false, note: null });
  });

  it("эквивалентные записи — совпадение, а не расхождение (ложных срабатываний нет)", async () => {
    const { reconcileSelfVerifyVerdict } = await import("../../src/llm/validation/answer-check");
    const equal: Array<[string, string]> = [
      ["4/8", "1/2"],
      ["4 / 8", "1/2"],
      ["2/4", "0.50"],
      ["1 1/2", "3/2"],
      ["42", "42."],
      ["42", "**42**"],
      ["42", " 42 "],
      ["5 см", "5см"],
      ["0,5", "0.5"],
      ["-1 1/2", "-3/2"],
    ];
    for (const [proposed, expected] of equal) {
      const verdict = reconcileSelfVerifyVerdict({ modelVerified: true, proposedAnswer: proposed, expectedAnswer: expected });
      expect(
        verdict,
        `«${proposed}» и «${expected}» — один ответ, сверка не должна его оспаривать`,
      ).toEqual({ verified: true, overridden: false, note: null });
    }
  });

  it("явно разные ответы ловятся даже при почти одинаковой записи", async () => {
    const { classifyAnswerMatch } = await import("../../src/llm/validation/answer-check");
    expect(classifyAnswerMatch("42", "1/2")).toBe("mismatch");
    expect(classifyAnswerMatch("5/6", "5/7")).toBe("mismatch");
    expect(classifyAnswerMatch("12", "21")).toBe("mismatch");
    expect(classifyAnswerMatch("5 м", "5 см")).toBe("mismatch");
    expect(classifyAnswerMatch("4/8", "1/2")).toBe("match");
    expect(classifyAnswerMatch("42", "42")).toBe("match");
  });

  it("неразрешимые пары не превращаются в расхождение — решение остаётся за моделью", async () => {
    const { classifyAnswerMatch, reconcileSelfVerifyVerdict } = await import(
      "../../src/llm/validation/answer-check"
    );
    // Дробь против десятичной записи той же величины: 1/3 ≠ 0.33 численно,
    // но разница = точность записи, а не другой ответ.
    expect(classifyAnswerMatch("1/3", "0.33")).toBe("incomparable");
    expect(classifyAnswerMatch("1/3", "0.333")).toBe("incomparable");
    // А вот 0.34 — это уже не округление 1/3, а другое число.
    expect(classifyAnswerMatch("1/3", "0.34")).toBe("mismatch");
    // Словарный ответ и ответ без единицы измерения.
    expect(classifyAnswerMatch("синий", "синий")).toBe("incomparable");
    expect(classifyAnswerMatch("5 см", "5")).toBe("incomparable");
    const verdict = reconcileSelfVerifyVerdict({
      modelVerified: true,
      proposedAnswer: "1/3",
      expectedAnswer: "0.33",
    });
    expect(verdict).toEqual({ verified: true, overridden: false, note: null });
  });

  it("без эталона сверка молчит — это нормальный случай, а не провал", async () => {
    const { reconcileSelfVerifyVerdict } = await import("../../src/llm/validation/answer-check");
    expect(reconcileSelfVerifyVerdict({ modelVerified: true, proposedAnswer: "1/2" })).toEqual({
      verified: true,
      overridden: false,
      note: null,
    });
    expect(
      reconcileSelfVerifyVerdict({ modelVerified: true, proposedAnswer: "1/2", expectedAnswer: "   " }),
    ).toEqual({ verified: true, overridden: false, note: null });
  });
});
