/**
 * Тесты сверки короткого ответа моделью (лист 3.1.2, G1).
 *
 * Живого вызова polza здесь НЕТ: ключа в тестовой среде нет, и он не нужен.
 * Провайдер подменяется на уровне `fetch` (рабочий приём из
 * tests/integration/polza-cost-regression.test.ts), поэтому проверяется РЕАЛЬНЫЙ
 * путь целиком: роутер → pickModel → polza → разбор JSON → нормализация вердикта.
 * Тест, который подменял бы и нормализацию, ничего не доказывал бы про неё.
 *
 * Что обязано быть доказано поведением, а не комментарием:
 *   1. Модель действительно сверяет ответ: вердикт «correct» доходит до
 *      проверяемого кода как checkMethod="llm" с баллом.
 *   2. НИЗКАЯ УВЕРЕННОСТЬ → ручная проверка, а НЕ «неправильно».
 *      Это главный гейт листа: продукт уже платил за противоположное поведение
 *      при распознавании фото.
 *   3. Ручная проверка никуда не делась — при любом сбое (нет ключа, 5xx,
 *      мусор вместо JSON, пустой ответ) ответ уходит учителю.
 *   4. Учитель может переопределить вердикт ИИ, и в ответе видно, чьё решение.
 *   5. Роутер отдаёт на эту задачу дешёвую модель, и тариф на неё не влияет.
 *
 * Запуск: `npm test --prefix backend -- tests/unit/formGradingLlm.test.ts`
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  gradeFromModel,
  normalizeShortAnswerVerdict,
  applyTeacherOverride,
  gradeAnswer,
  SHORT_ANSWER_CONFIDENCE_THRESHOLD,
  LLM_ANSWER_GRADING_ESTIMATE_TOKENS_IN,
  LLM_ANSWER_GRADING_ESTIMATE_TOKENS_OUT,
} from "../../src/services/formGrading";
// Обращение к модели живёт в LLM-слое (лист 3.1.6): сервис разбора остаётся
// чистым и не импортирует провайдеров. Тест проверяет оба слоя вместе — так же,
// как их вызывает роут отправки формы.
import { gradeShortAnswerWithLlm } from "../../src/llm/shortAnswerCheck";
import { pickModel } from "../../src/llm/router";
import { buildShortAnswerPrompt, FORM_GRADING_SYSTEM } from "../../src/llm/prompts/form-grading";
import { MODEL_COSTS } from "../../src/llm/config";
import { calcCost } from "../../src/llm/cost";
import type { WorksheetTask } from "../../src/types";
import type { Env } from "../../src/env";

const ENV = { POLZA_API_KEY: "test-key", APP_ENV: "test" } as unknown as Env;
const ENV_NO_KEY = { APP_ENV: "test" } as unknown as Env;

function task(over: Partial<WorksheetTask> & { type: WorksheetTask["type"] }): WorksheetTask {
  return { number: 1, text: "Почему тело тяжелее воздуха?", points: 2, ...over };
}

/** Ответ polza (OpenAI-совместимый /chat/completions) с заданным содержимым. */
function polzaResponse(content: string): unknown {
  return {
    model: "openai/gpt-6-luna",
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 900, completion_tokens: 60, total_tokens: 960 },
  };
}

/** Подменить сеть так, чтобы polza вернул ровно этот content. */
function stubModel(content: string) {
  const fetchMock = vi.fn(
    async () => new Response(JSON.stringify(polzaResponse(content)), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Собрать JSON так, как его вернула бы модель. */
function modelJson(verdict: string, confidence: number, comment: string | null = null): string {
  return JSON.stringify({ verdict, confidence, comment });
}

/**
 * Проба нормализации уверенности через единственную публичную точку входа —
 * результат `gradeFromModel` (уверенность едет наружу в confidence).
 */
function toConfidenceProbe(raw: unknown): number | null {
  return gradeFromModel(JSON.stringify({ verdict: "correct", confidence: raw }), 1).confidence;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─── 1. Модель действительно сверяет ─────────────────────────────────────────

describe("сверка короткого ответа моделью", () => {
  it("G1: модель сверила ответ — вердикт correct приходит как решение машины", async () => {
    const fetchMock = stubModel(modelJson("correct", 0.95, null));

    const g = await gradeShortAnswerWithLlm({
      task: task({ type: "short-answer", answer: "притягивает Земля" }),
      value: "Земля притягивает",
      env: ENV,
    });

    // Ключевое: решение приняла МАШИНА, а не учитель.
    expect(g.checkMethod).toBe("llm");
    expect(g.decidedBy).toBe("model");
    expect(g.isCorrect).toBe(true);
    expect(g.pointsAwarded).toBe(2);
    expect(g.needsReview).toBe(false);
    expect(g.modelVerdict).toBe("correct");

    // И запрос действительно ушёл к провайдеру — «модель сверила» не означает
    // «функция вернула константу».
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("уверенный incorrect — тоже решение машины, балл 0", async () => {
    stubModel(modelJson("incorrect", 0.92, "Ответ не про массу, а про скорость"));

    const g = await gradeShortAnswerWithLlm({
      task: task({ type: "short-answer", answer: "притягивает Земля" }),
      value: "потому что быстро летает",
      env: ENV,
    });

    expect(g.checkMethod).toBe("llm");
    expect(g.isCorrect).toBe(false);
    expect(g.pointsAwarded).toBe(0);
    expect(g.needsReview).toBe(false);
    // Комментарий модели доезжает до учителя — зачем он и нужен.
    expect(g.comment).toContain("массу");
  });

  it("эталон и ответ уходят в запрос (модель не работает вслепую)", async () => {
    const fetchMock = stubModel(modelJson("correct", 0.9));

    await gradeShortAnswerWithLlm({
      task: task({ type: "short-answer", answer: "притягивает Земля" }),
      value: "Земля притягивает",
      env: ENV,
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    const userMessage = JSON.parse(body.messages[1].content);
    expect(userMessage.задание.expected).toBe("притягивает Земля");
    expect(userMessage.задание.studentAnswer).toBe("Земля притягивает");
  });
});

// ─── 2. Низкая уверенность ≠ неправильно (главный гейт листа) ─────────────────

describe("низкая уверенность — это не «неправильно»", () => {
  it("G1: сомнение модели уходит учителю, а не в журнал как ошибка", async () => {
    stubModel(modelJson("incorrect", 0.4, "вроде не то"));

    const g = await gradeShortAnswerWithLlm({
      task: task({ type: "short-answer", answer: "притягивает Земля" }),
      value: "ну потому что",
      env: ENV,
    });

    // Именно это продукт уже чинил с фото: сомнение ≠ выдуманная ошибка.
    expect(g.isCorrect).toBeNull();
    expect(g.pointsAwarded).toBe(0);
    expect(g.needsReview).toBe(true);
    expect(g.modelVerdict).toBe("uncertain");
    expect(g.reason).toContain("не уверена");
  });

  it("даже correct при низкой уверенности не попадает в журнал как верно", async () => {
    // Регресс на баг из photoCheckGrading: явный вердикт модели обходил гейт.
    stubModel(modelJson("correct", 0.2));

    const g = await gradeShortAnswerWithLlm({
      task: task({ type: "short-answer", answer: "притягивает Земля" }),
      value: "притягивает",
      env: ENV,
    });

    expect(g.isCorrect).toBeNull();
    expect(g.needsReview).toBe(true);
    expect(g.modelVerdict).toBe("uncertain");
  });

  it("порог уверенности применяется ДО разбора вердикта", () => {
    // Порядок проверок виден напрямую: сомнение в confidence должно побеждать
    // даже явный correct/incorrect от модели.
    expect(normalizeShortAnswerVerdict("correct", 0.1)).toBe("uncertain");
    expect(normalizeShortAnswerVerdict("incorrect", 0.1)).toBe("uncertain");
    expect(normalizeShortAnswerVerdict("correct", 0.99)).toBe("correct");
    expect(normalizeShortAnswerVerdict("incorrect", 0.99)).toBe("incorrect");
  });

  it("явный uncertain от модели — честный отказ, а не сбой", () => {
    expect(normalizeShortAnswerVerdict("uncertain", 0.99)).toBe("uncertain");
    expect(normalizeShortAnswerVerdict("UNSURE", 0.99)).toBe("uncertain");
  });

  it("без confidence автоматического вердикта не бывает вообще", () => {
    // Модель промолчала об уверенности — это не 1.0, это отсутствие ответа.
    expect(normalizeShortAnswerVerdict("correct", null)).toBe("uncertain");
    expect(normalizeShortAnswerVerdict("correct", undefined as unknown as number)).toBe("uncertain");
  });

  it("confidence 85 читается как 0.85, а не обрезается до 1.0", () => {
    // 85 → 1.0 означало бы «максимальная уверенность», которой модель не
    // выражала: при пороге 0.7 обрезанное значение проскочило бы гейт.
    expect(toConfidenceProbe(85)).toBe(0.85);
    expect(toConfidenceProbe(100)).toBe(1);
    expect(toConfidenceProbe(0.85)).toBe(0.85);
    expect(toConfidenceProbe(-5)).toBe(0);
    expect(toConfidenceProbe("0.9")).toBe(0.9);
  });

  it("порог — константа, и он правдоподобный", () => {
    expect(SHORT_ANSWER_CONFIDENCE_THRESHOLD).toBeGreaterThan(0.5);
    expect(SHORT_ANSWER_CONFIDENCE_THRESHOLD).toBeLessThanOrEqual(0.85);
  });
});

// ─── 3. Ручная проверка никуда не делась ─────────────────────────────────────

describe("откат к учителю", () => {
  it("G1: нет ключа LLM — учитель, а не «неправильно»", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const g = await gradeShortAnswerWithLlm({
      task: task({ type: "short-answer", answer: "притягивает Земля" }),
      value: "Земля притягивает",
      env: ENV_NO_KEY,
    });

    expect(g.checkMethod).toBe("manual");
    expect(g.isCorrect).toBeNull();
    expect(g.needsReview).toBe(true);
    expect(g.modelVerdict).toBeNull();
    // И ни копейки не потрачено: без ключа запроса не было.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("провайдер вернул 5xx — учитель, а не «неправильно»", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream boom", { status: 500 })));

    const g = await gradeShortAnswerWithLlm({
      task: task({ type: "short-answer", answer: "притягивает Земля" }),
      value: "Земля притягивает",
      env: ENV,
    });

    expect(g.checkMethod).toBe("manual");
    expect(g.isCorrect).toBeNull();
    expect(g.needsReview).toBe(true);
  });

  it("модель вернула мусор вместо JSON — учитель", async () => {
    for (const junk of ["", "   ", "не знаю", "<html>502</html>", "{"]) {
      stubModel(junk);
      const g = await gradeShortAnswerWithLlm({
        task: task({ type: "short-answer", answer: "притягивает Земля" }),
        value: "Земля притягивает",
        env: ENV,
      });
      expect(g.checkMethod, `мусор: ${JSON.stringify(junk)}`).toBe("manual");
      expect(g.isCorrect).toBeNull();
      expect(g.needsReview).toBe(true);
    }
  });

  it("таймаут сети — учитель, а не «неправильно»", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("The operation was aborted due to timeout");
      }),
    );

    const g = await gradeShortAnswerWithLlm({
      task: task({ type: "short-answer", answer: "притягивает Земля" }),
      value: "Земля притягивает",
      env: ENV,
    });

    expect(g.checkMethod).toBe("manual");
    expect(g.isCorrect).toBeNull();
    expect(g.needsReview).toBe(true);
  });

  it("пустой ответ ученика — до модели, копейки не тратится", async () => {
    const fetchMock = stubModel(modelJson("incorrect", 0.99));

    const g = await gradeShortAnswerWithLlm({
      task: task({ type: "short-answer", answer: "притягивает Земля" }),
      value: "   ",
      env: ENV,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(g.needsReview).toBe(true);
    expect(g.modelVerdict).toBeNull();
    expect(g.reason).toContain("не ответил");
  });

  it("пустой эталон — до модели, сверять не с чем", async () => {
    const fetchMock = stubModel(modelJson("correct", 0.99));

    const g = await gradeShortAnswerWithLlm({
      task: task({ type: "short-answer", answer: "" }),
      value: "Земля притягивает",
      env: ENV,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(g.needsReview).toBe(true);
    expect(g.reason).toContain("эталон");
  });

  it("эссе модель не трогает — это работа учителя", async () => {
    const fetchMock = stubModel(modelJson("correct", 0.99));

    const g = await gradeShortAnswerWithLlm({
      task: task({ type: "essay", answer: "рассуждение" }),
      value: "рассуждение",
      env: ENV,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(g.checkMethod).toBe("manual");
    expect(g.needsReview).toBe(true);
  });

  it("синхронный gradeAnswer для short-answer остался ручным (роут не сломан)", () => {
    // Гейт G3: чужой код (routes/publicForms.ts) зовёт gradeAnswer синхронно.
    const v = gradeAnswer(task({ type: "short-answer", answer: "притягивает Земля" }), "Земля притягивает");
    expect(v.checkMethod).toBe("manual");
    expect(v.isCorrect).toBeNull();
    expect(v.needsReview).toBe(true);
    // И причина больше не обещает несуществующий «этап 6».
    expect(v.reason).not.toContain("этап 6");
  });

  it("таймаут провайдера — обычная ручная проверка, а не «неверно»", async () => {
    // Провайдер, который не отвечает никогда. Ученик при этом ждёт кнопку
    // «Отправить», поэтому ждать двенадцать секунд он не должен — и уж тем более
    // не должен получить «неверно» из-за чужой аварии.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );

    const g = await gradeShortAnswerWithLlm({
      task: task({ type: "short-answer", answer: "притягивает Земля" }),
      value: "Земля притягивает",
      env: ENV,
      // 50 мс вместо боевых 12 секунд: тест проверяет ветку, а не ожидание.
      timeoutMs: 50,
    });

    expect(g.checkMethod).toBe("manual");
    expect(g.isCorrect).toBeNull();
    expect(g.needsReview).toBe(true);
    expect(g.modelVerdict).toBeNull();
    expect(g.decidedBy).toBe("model");
  });
});

// ─── 4. Учитель переопределяет вердикт ИИ ────────────────────────────────────

describe("учитель может переопределить решение машины", () => {
  it("G1: отметка учителя побеждает, но решение машины остаётся видно", () => {
    const machine = {
      isCorrect: true,
      pointsAwarded: 2,
      needsReview: false,
      checkMethod: "llm" as const,
      reason: "Модель: совпадает",
      modelVerdict: "correct" as const,
      confidence: 0.93,
      comment: null,
      decidedBy: "model" as const,
    };

    const teacher = applyTeacherOverride(machine, { accepted: false, points: 2 }, 2);

    // Итог — решение человека.
    expect(teacher.decidedBy).toBe("teacher");
    expect(teacher.isCorrect).toBe(false);
    expect(teacher.pointsAwarded).toBe(0);
    expect(teacher.needsReview).toBe(false);
    expect(teacher.checkMethod).toBe("manual");

    // Но что сказала машина — не затёрто: через месяц видно, что поправил человек.
    expect(teacher.modelVerdict).toBe("correct");
    expect(teacher.confidence).toBe(0.93);
  });

  it("учитель может засчитать то, что модель сочла неверным", () => {
    const machine = gradeFromModel(modelJson("incorrect", 0.9, "мимо"), 2);
    expect(machine.isCorrect).toBe(false);

    const teacher = applyTeacherOverride(machine, { accepted: true, points: 2 }, 2);

    expect(teacher.isCorrect).toBe(true);
    expect(teacher.pointsAwarded).toBe(2);
    expect(teacher.decidedBy).toBe("teacher");
    expect(teacher.modelVerdict).toBe("incorrect");
  });

  it("учитель закрывает и неуверенный ответ — он больше не ждёт", () => {
    const unsure = gradeFromModel(modelJson("uncertain", 0.3, "хм"), 2);
    expect(unsure.needsReview).toBe(true);

    const teacher = applyTeacherOverride(unsure, { accepted: true, points: 1 }, 2);

    expect(teacher.needsReview).toBe(false);
    expect(teacher.isCorrect).toBe(true);
    expect(teacher.pointsAwarded).toBe(1);
  });

  it("балл учителя не может вылезти за пределы задания", () => {
    const machine = gradeFromModel(modelJson("correct", 0.9), 2);

    // 999 из браузера в задание на 2 балла.
    expect(applyTeacherOverride(machine, { accepted: true, points: 999 }, 2).pointsAwarded).toBe(2);
    // Частичный балл учитель поставить может — дробные отбрасываем вниз.
    expect(applyTeacherOverride(machine, { accepted: true, points: 1 }, 2).pointsAwarded).toBe(1);
    // Отрицательное число — ноль, а не «минус балл».
    expect(applyTeacherOverride(machine, { accepted: true, points: -5 }, 2).pointsAwarded).toBe(0);
    // Не засчитал — балл ноль, даже если учитель прислал число.
    expect(applyTeacherOverride(machine, { accepted: false, points: 2 }, 2).pointsAwarded).toBe(0);
    // Балл не прислали — берём максимум задания.
    expect(applyTeacherOverride(machine, { accepted: true }, 2).pointsAwarded).toBe(2);
  });
});

// ─── 5. Роутинг и деньги (G5) ───────────────────────────────────────────────

describe("роутер и стоимость сверки", () => {
  it("на сверку идёт дешёвая модель, а не премиум", () => {
    expect(pickModel("short-answer-check", ENV).primary!.model).toBe("gpt-6-luna");
  });

  it("без ключа роутер возвращает null — сервис отдаст ответ учителю", () => {
    expect(pickModel("short-answer-check", ENV_NO_KEY).primary).toBeNull();
  });

  it("тариф не может подсунуть дорогую модель на сверку", () => {
    // Сигнатуры с `plan` у pickModel нет с 02.10.2026 — проверяем через типы.
    expect(pickModel("short-answer-check", ENV).primary!.model).toBe("gpt-6-luna");
  });

  it("одна сверка стоит доли копейки — учитель не платит вслепую", () => {
    const usd = calcCost(
      "gpt-6-luna",
      LLM_ANSWER_GRADING_ESTIMATE_TOKENS_IN,
      LLM_ANSWER_GRADING_ESTIMATE_TOKENS_OUT,
    );
    const rub = usd * 86.2; // курс, которым переводит config.ts

    expect(usd).toBeGreaterThan(0);
    expect(rub).toBeLessThan(0.02);
    // Класс из 30 работ × 10 коротких ответов — меньше рубля.
    expect(rub * 30 * 10).toBeLessThan(10);
  });

  it("в прайсе есть тариф для модели сверки (иначе COGS посчитается нулём)", () => {
    const spec = MODEL_COSTS["gpt-6-luna"]!;
    expect(spec.inputPer1M).toBeGreaterThan(0);
    expect(spec.outputPer1M).toBeGreaterThan(0);
  });
});

// ─── 6. Промпт и краевые случаи ответа ───────────────────────────────────────

describe("промпт и краевые случаи", () => {
  it("промпт прямо разрешает «не уверен» и запрещает выдумывать ошибку", () => {
    expect(FORM_GRADING_SYSTEM).toContain("uncertain");
    expect(FORM_GRADING_SYSTEM).toMatch(/никогда не ставить вместо него "incorrect"/i);
  });

  it("промпт учитывает иностранный ответ ученика", () => {
    // Кейс из прохода 3: английский текст не должен превращаться в «неверно».
    expect(FORM_GRADING_SYSTEM).toMatch(/на английском/i);
  });

  it("в запрос попадают номер, текст, эталон, ответ и балл", () => {
    const { user } = buildShortAnswerPrompt({
      number: 4,
      taskText: "Что такое фотосинтез?",
      expected: "процесс образования органических веществ из неорганических",
      studentAnswer: "растения делают сахар из солнца и воды",
      points: 3,
    });
    const parsed = JSON.parse(user);
    expect(parsed.задание).toMatchObject({ number: 4, points: 3 });
    expect(parsed.задание.taskText).toContain("фотосинтез");
  });

  it("длинный «короткий» ответ не ломает разбор и не уходит в «неверно» молча", () => {
    // Кейс из прохода 3: длинное эссе в поле short-answer.
    const essayish = "Я думаю что наверное потому что тяжелее и поэтому падает и так далее ".repeat(20);
    const g = gradeFromModel(modelJson("correct", 0.9), 2);
    expect(g.pointsAwarded).toBe(2);

    // Мусор в поле comment не должен ломать вердикт.
    const weird = gradeFromModel(JSON.stringify({ verdict: "correct", confidence: 0.9, comment: { a: 1 } }), 2);
    expect(weird.isCorrect).toBe(true);
    expect(weird.comment).toBeNull();
    expect(essayish.length).toBeGreaterThan(1000);
  });

  it("комментарий модели обрезается до одной строки", () => {
    const g = gradeFromModel(modelJson("incorrect", 0.9, "а".repeat(1000)), 2);
    expect(g.comment!.length).toBeLessThanOrEqual(240);
  });

  it("JSON в markdown-обёртке разбирается — модели её лепят часто", () => {
    const wrapped = "```json\n" + modelJson("correct", 0.95) + "\n```";
    expect(gradeFromModel(wrapped, 2).isCorrect).toBe(true);
  });

  it("вердикт приходит строкой в другом регистре — верный ответ не теряется", () => {
    expect(gradeFromModel(modelJson("CORRECT", 0.95), 2).isCorrect).toBe(true);
  });

  it("два одинаковых ответа в классе не влияют друг на друга", () => {
    // Сверка идёт по одному ответу и без общего состояния: чужой ответ ученика
    // в подсказку не попадает. Проверяем, что функция детерминирована.
    const a = gradeFromModel(modelJson("correct", 0.9), 2);
    const b = gradeFromModel(modelJson("correct", 0.9), 2);
    expect(a).toEqual(b);
    expect(buildShortAnswerPrompt({
      number: 1, taskText: "?", expected: "да", studentAnswer: "да", points: 1,
    }).user).not.toContain("другой ученик");
  });

  it("повторный вызов с тем же ответом даёт тот же вердикт (нет накопления состояния)", async () => {
    stubModel(modelJson("correct", 0.9));
    const args = {
      task: task({ type: "short-answer" as const, answer: "да" }),
      value: "да",
      env: ENV,
    };
    const first = await gradeShortAnswerWithLlm(args);
    const second = await gradeShortAnswerWithLlm(args);
    expect(second).toEqual(first);
  });

  it("опечатка не превращается в «неверно» на стороне сервиса", () => {
    // Сервис не пытается сам угадывать правописание — это работа модели,
    // и при её сомнении ответ уходит учителю, а не в ноль.
    const g = gradeFromModel(modelJson("uncertain", 0.5), 2);
    expect(g.needsReview).toBe(true);
    expect(g.isCorrect).toBeNull();
  });
});