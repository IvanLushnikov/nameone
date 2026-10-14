/**
 * Лист 2.1.8: схема графика от модели → поле в задании → проверка до отрисовки.
 *
 * Тесты БЕЗ ключа LLM и без единого реального запроса: сеть подменена через
 * `vi.stubGlobal("fetch", …)`, ровно как в
 * `tests/integration/polza-cost-regression.test.ts`. Деньги не тратятся,
 * провайдер не знает, что мы существуем.
 *
 * Что здесь проверяется и что — нет:
 *   · ПРОВЕРЯЕМ: модель позвана только когда нужен график; схема доезжает до
 *     задания тем же полем, что и `text_latex`; мусор (пустой объект,
 *     координаты в миллионах, injection-строка, два графика на задание, обрыв
 *     JSON) не доезжает до листа; отказ виден в логе.
 *   · НЕ ПРОВЕРЯЕМ: что реальная модель нарисует осмысленный график. Это
 *     проверяется только живым прогоном с ключом (LIVE=1), здесь мы гоняем
 *     заранее заданные ответы.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  GRAPH_SUBJECTS,
  MAX_GRAPHS_PER_SHEET,
  attachChartSpecs,
  buildSvgGraphPrompt,
  collectCharts,
  tasksNeedingGraph,
} from "../../src/llm/prompts/svg-graph-gen";
import { CHART_TYPES, validateChartSpec } from "../../src/llm/svg-validate";
import { looksLikeForeignMath } from "../../src/llm/validation/quality-filter";
import { _resetPolzaSingleton } from "../../src/llm/providers/polza";
import type { Env } from "../../src/env";

const FAKE_ENV = {
  DB: {} as D1Database,
  PDFS: {} as R2Bucket,
  APP_ENV: "test",
  APP_BASE_URL: "http://localhost:8787",
  FRONTEND_URL: "http://localhost:3000",
  JWT_SECRET: "test-secret",
  POLZA_API_KEY: "test-key",
} as unknown as Env;

const ENV_NO_KEY = { ...FAKE_ENV, POLZA_API_KEY: undefined } as unknown as Env;

/** Ответ polza (OpenAI-совместимый) с заданным телом от модели. */
function polzaReply(content: string): unknown {
  return {
    model: "openai/gpt-6-luna",
    choices: [{ message: { content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 400, completion_tokens: 180, total_tokens: 580 },
  };
}

/** Подменить сеть: ни одного настоящего запроса. */
function stubModel(content: string) {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify(polzaReply(content)), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Задания листа, где второе задание просит график. */
function sheetTasks() {
  return [
    { number: 1, text: "Сократите дробь 8/12.", type: "computation", points: 1 },
    {
      number: 2,
      text: "Постройте график функции y = 2x и назовите его свойства.",
      type: "short-answer",
      points: 2,
    },
    { number: 3, text: "Найдите площадь прямоугольника 4 × 5.", type: "computation", points: 1 },
  ];
}

const GOOD_LINE = {
  charts: [
    {
      task_number: 2,
      chart_spec: {
        type: "line",
        title: "График y = 2x",
        x_label: "x",
        y_label: "y",
        data: {
          labels: ["-1", "0", "1", "2"],
          series: [{ name: "y = 2x", values: [-2, 0, 2, 4] }],
        },
      },
    },
  ],
};

/** Перехватить структурный лог: подмена заготовки обязана быть видна. */
function captureLogs() {
  const lines: string[] = [];
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  vi.spyOn(console, "info").mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  return lines;
}

beforeEach(() => {
  _resetPolzaSingleton();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  _resetPolzaSingleton();
});

// ─────────────────────────────────────────────────────────────────────────────
describe("когда график нужен (экономия токенов)", () => {
  it("предмет не из математики — модель не зовётся вообще", async () => {
    const fetchMock = stubModel(JSON.stringify(GOOD_LINE));
    const logs = captureLogs();
    const tasks = [{ number: 1, text: "Изобразите схему дыхания растения.", type: "short-answer" }];

    const result = await attachChartSpecs({
      tasks,
      subject: "biology",
      grade: 6,
      topic: "Дыхание",
      env: FAKE_ENV,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.report.asked).toEqual([]);
    expect(result.report.skipped).toMatch(/no-candidates/);
    expect(logs.join("\n")).not.toMatch(/svg-graph-gen: схема/);
  });

  it("в математике без просьбы нарисовать модель не зовётся", async () => {
    const fetchMock = stubModel(JSON.stringify(GOOD_LINE));

    const result = await attachChartSpecs({
      tasks: sheetTasks().filter((t) => t.number !== 2),
      subject: "math",
      grade: 5,
      topic: "Дроби",
      env: FAKE_ENV,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.report.asked).toEqual([]);
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks[0]).not.toHaveProperty("chart_spec");
  });

  it("просьба «постройте график» — модель зовётся один раз и только по этому заданию", async () => {
    const fetchMock = stubModel(JSON.stringify(GOOD_LINE));
    captureLogs();

    const result = await attachChartSpecs({
      tasks: sheetTasks(),
      subject: "math",
      grade: 7,
      topic: "Линейная функция",
      env: FAKE_ENV,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.report.asked).toEqual([2]);
    expect(result.tasks[1]).toHaveProperty("chart_spec");
    expect(result.tasks[0]).not.toHaveProperty("chart_spec");
    expect(result.tasks[2]).not.toHaveProperty("chart_spec");
  });

  it("больше двух графиков на лист не просим", async () => {
    const many = [1, 2, 3, 4].map((n) => ({
      number: n,
      text: "Постройте график функции.",
      type: "short-answer",
    }));
    expect(tasksNeedingGraph(many, "physics")).toHaveLength(MAX_GRAPHS_PER_SHEET);
  });

  it("без ключа провайдера — лист собирается, графика нет, и это видно в логе", async () => {
    const fetchMock = stubModel(JSON.stringify(GOOD_LINE));
    const logs = captureLogs();

    const result = await attachChartSpecs({
      tasks: sheetTasks(),
      subject: "math",
      grade: 7,
      topic: "Линейная функция",
      env: ENV_NO_KEY,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.report.skipped).toMatch(/no-key/);
    expect(result.tasks[1]).not.toHaveProperty("chart_spec");
    expect(logs.join("\n")).toMatch(/svg-graph-gen/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("схема доезжает в ответ листа", () => {
  it("проверенная схема ложится в задание тем же полем, что и text_latex", async () => {
    stubModel(JSON.stringify(GOOD_LINE));
    captureLogs();

    const result = await attachChartSpecs({
      tasks: sheetTasks(),
      subject: "math",
      grade: 7,
      topic: "Линейная функция",
      env: FAKE_ENV,
    });

    const spec = (result.tasks[1] as { chart_spec?: { type?: string; title?: string } }).chart_spec;
    expect(spec).toBeDefined();
    expect(spec?.type).toBe("line");
    expect(spec?.title).toBe("График y = 2x");
    // Остальные поля задания не пострадали — спред собирает копию, а не
    // переписывает объект.
    expect(result.tasks[1]).toMatchObject({ number: 2, points: 2, type: "short-answer" });
    expect(result.report.attached).toEqual([{ taskNumber: 2, type: "line" }]);
  });

  it("исходный массив заданий не мутируется", async () => {
    stubModel(JSON.stringify(GOOD_LINE));
    captureLogs();
    const tasks = sheetTasks();

    await attachChartSpecs({
      tasks,
      subject: "math",
      grade: 7,
      topic: "Линейная функция",
      env: FAKE_ENV,
    });

    expect(tasks[1]).not.toHaveProperty("chart_spec");
  });

  it("промпт просит ровно то, что проверяет валидатор", () => {
    const { system, user } = buildSvgGraphPrompt({
      subject: "math",
      grade: 7,
      topic: "Линейная функция",
      tasks: [{ number: 2, text: "Постройте график функции y = 2x." }],
    });

    expect(user).toContain('"task_number": 2');
    for (const type of ["bar", "line", "pie", "number_line", "geometry"]) {
      expect(system).toContain(type);
    }
    // Biology/chemistry в этот вызов не просим: лист этого листа — математика
    // и физика, остальные шаблоны живут в своей задаче.
    expect(system).not.toContain("plant-cell");
    expect(user).toContain("y = 2x");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("G4: модель не справилась — лист цел, графика нет", () => {
  it("провайдер упал: без исключения, без графика, отказ в логе", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("upstream boom", { status: 500 })),
    );
    const logs = captureLogs();

    const result = await attachChartSpecs({
      tasks: sheetTasks(),
      subject: "math",
      grade: 7,
      topic: "Линейная функция",
      env: FAKE_ENV,
    });

    expect(result.report.skipped).toMatch(/provider-error/);
    expect(result.tasks).toHaveLength(3);
    expect(result.tasks[1]).not.toHaveProperty("chart_spec");
    expect(logs.join("\n")).toMatch(/svg-graph-gen: провайдер не ответил/);
  });

  it("модель вернула обрыв вместо JSON — лист цел, причина в логе", async () => {
    stubModel('{"charts": [{"task_number": 2, "chart_spec": {"type": "li');
    const logs = captureLogs();

    const result = await attachChartSpecs({
      tasks: sheetTasks(),
      subject: "math",
      grade: 7,
      topic: "Линейная функция",
      env: FAKE_ENV,
    });

    expect(result.tasks[1]).not.toHaveProperty("chart_spec");
    expect(result.report.dropped.map((d) => d.reasons).join(" ")).toMatch(/bad-json/);
    expect(logs.join("\n")).toMatch(/svg-graph-gen: ни одна схема не прошла проверку/);
  });

  it("модель вернула пустой объект — не рисуем и не выдумываем", async () => {
    stubModel("{}");
    const logs = captureLogs();

    const result = await attachChartSpecs({
      tasks: sheetTasks(),
      subject: "math",
      grade: 7,
      topic: "Линейная функция",
      env: FAKE_ENV,
    });

    expect(result.tasks[1]).not.toHaveProperty("chart_spec");
    expect(result.report.dropped.map((d) => d.reasons).join(" ")).toMatch(/no-charts/);
    expect(logs.join("\n")).toMatch(/svg-graph-gen/);
  });

  it("модель вообще ничего не вернула про график — лист цел", async () => {
    stubModel(JSON.stringify({ charts: [] }));
    captureLogs();

    const result = await attachChartSpecs({
      tasks: sheetTasks(),
      subject: "math",
      grade: 7,
      topic: "Линейная функция",
      env: FAKE_ENV,
    });

    expect(result.report.attached).toEqual([]);
    expect(result.tasks).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("краевые случаи ответа модели", () => {
  const candidates = [{ number: 2, text: "Постройте график функции y = 2x." }];

  it("координаты в миллионах — отказ по absurd-value", () => {
    const { charts, dropped } = collectCharts(
      JSON.stringify({
        charts: [
          {
            task_number: 2,
            chart_spec: {
              type: "bar",
              title: "Диаграмма",
              data: { labels: ["a", "b"], values: [3000000, 4] },
            },
          },
        ],
      }),
      candidates,
    );

    expect(charts).toHaveLength(0);
    expect(dropped[0]?.reasons).toMatch(/absurd-value/);
  });

  it("пустой объект вместо схемы — missing-type", () => {
    const { charts, dropped } = collectCharts(
      JSON.stringify({ charts: [{ task_number: 2, chart_spec: {} }] }),
      candidates,
    );
    expect(charts).toHaveLength(0);
    expect(dropped[0]?.reasons).toMatch(/missing-type/);
  });

  it("два графика вместо одного — ни один не рисуем", () => {
    const { charts, dropped } = collectCharts(
      JSON.stringify({
        charts: [
          { task_number: 2, chart_spec: { type: "bar", title: "A", data: { labels: ["a", "b"], values: [1, 2] } } },
          { task_number: 2, chart_spec: { type: "pie", title: "B", data: { labels: ["a", "b"], values: [1, 2] } } },
        ],
      }),
      candidates,
    );
    expect(charts).toHaveLength(0);
    expect(dropped.map((d) => d.reasons).join(" ")).toMatch(/multiple-charts/);
  });

  it("массив схем вместо объекта — multiple-charts", () => {
    const { charts, dropped } = collectCharts(
      JSON.stringify({
        charts: [
          {
            task_number: 2,
            chart_spec: [{ type: "bar", title: "A", data: { labels: ["a", "b"], values: [1, 2] } }],
          },
        ],
      }),
      candidates,
    );
    expect(charts).toHaveLength(0);
    expect(dropped[0]?.reasons).toMatch(/multiple-charts/);
  });

  it("injection-строка в подписи — отказ, а не картинка с разметкой", () => {
    const { charts, dropped } = collectCharts(
      JSON.stringify({
        charts: [
          {
            task_number: 2,
            chart_spec: {
              type: "bar",
              title: '"><script>alert(1)</script>',
              data: { labels: ["<img src=x onerror=alert(1)>", "b"], values: [1, 2] },
            },
          },
        ],
      }),
      candidates,
    );
    expect(charts).toHaveLength(0);
    expect(dropped[0]?.reasons).toMatch(/bad-text/);
  });

  it("подписи и значения разной длины — mismatch, а не «рисуем что есть»", () => {
    const { charts, dropped } = collectCharts(
      JSON.stringify({
        charts: [
          {
            task_number: 2,
            chart_spec: {
              type: "bar",
              title: "Диаграмма",
              data: { labels: ["a", "b", "c"], values: [1, 2] },
            },
          },
        ],
      }),
      candidates,
    );
    expect(charts).toHaveLength(0);
    expect(dropped[0]?.reasons).toMatch(/mismatched-length/);
  });

  it("все значения нулевые — пустые оси не рисуем", () => {
    const { charts, dropped } = collectCharts(
      JSON.stringify({
        charts: [
          {
            task_number: 2,
            chart_spec: {
              type: "bar",
              title: "Диаграмма",
              data: { labels: ["a", "b"], values: [0, 0] },
            },
          },
        ],
      }),
      candidates,
    );
    expect(charts).toHaveLength(0);
    expect(dropped[0]?.reasons).toMatch(/empty-axis/);
  });

  it("график для задания, которого в листе нет, — отказ", () => {
    const { charts, dropped } = collectCharts(
      JSON.stringify({
        charts: [
          { task_number: 99, chart_spec: { type: "bar", title: "A", data: { labels: ["a", "b"], values: [1, 2] } } },
        ],
      }),
      candidates,
    );
    expect(charts).toHaveLength(0);
    expect(dropped[0]?.reasons).toMatch(/unknown-task/);
  });

  it("неизвестное поле вырезается, график остаётся", () => {
    const { charts, dropped } = collectCharts(
      JSON.stringify({
        charts: [
          {
            task_number: 2,
            chart_spec: {
              type: "bar",
              title: "Диаграмма",
              data: { labels: ["a", "b"], values: [1, 2] },
              id: "chart-42",
              createdAt: "2025-03-08T00:00:00Z",
            },
          },
        ],
      }),
      candidates,
    );
    expect(charts).toHaveLength(1);
    expect(charts[0]?.spec).not.toHaveProperty("id");
    expect(charts[0]?.spec).not.toHaveProperty("createdAt");
    expect(dropped).toHaveLength(0);
  });

  it("точка числовой прямой вне шкалы — отказ", () => {
    const { charts } = collectCharts(
      JSON.stringify({
        charts: [
          {
            task_number: 2,
            chart_spec: {
              type: "number_line",
              title: "Прямая",
              range: [-3, 5],
              points: [{ value: 42 }],
            },
          },
        ],
      }),
      candidates,
    );
    expect(charts).toHaveLength(0);
  });

  it("потолок держится, даже если модель ответила графиками на все задания", () => {
    // Регресс: лимит считался по `charts.length`, который в цикле разбора ещё
    // всегда был нулём, — то есть потолок не срабатывал никогда.
    const many = [2, 3, 4, 5].map((n) => ({ number: n, text: "Постройте график функции." }));
    const { charts, dropped } = collectCharts(
      JSON.stringify({
        charts: many.map((t) => ({
          task_number: t.number,
          chart_spec: { type: "bar", title: "X", data: { labels: ["a", "b"], values: [1, 2] } },
        })),
      }),
      many,
      MAX_GRAPHS_PER_SHEET,
    );
    expect(charts).toHaveLength(MAX_GRAPHS_PER_SHEET);
    expect(dropped.filter((d) => /limit/.test(d.reasons)).length).toBe(
      many.length - MAX_GRAPHS_PER_SHEET,
    );
  });
});

describe("один график — одно задание", () => {
  it("при повторяющемся номере схема встаёт на первое задание, а не на оба", async () => {
    // Модель в дозапросе иногда повторяет номер. Раньше схема копировалась в
    // оба задания, и учитель получал две картинки к одному условию.
    stubModel(JSON.stringify(GOOD_LINE));
    captureLogs();

    const result = await attachChartSpecs({
      tasks: [
        { number: 2, text: "Постройте график функции y = 2x.", type: "short-answer" },
        { number: 2, text: "Постройте график функции y = 2x (дозапрос).", type: "short-answer" },
      ],
      subject: "math",
      grade: 7,
      topic: "Линейная функция",
      env: FAKE_ENV,
    });

    expect(result.tasks[0]).toHaveProperty("chart_spec");
    expect(result.tasks[1]).not.toHaveProperty("chart_spec");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("валидатор: контракт с рисовалкой на фронте", () => {
  it("типы графиков совпадают с фронтовым svg-spec.ts", () => {
    // Сверка строк, а не импорт: бэк — отдельный npm-проект. Полный список
    // типов и лимиты проверяет scripts/check-svg-graph-gen.mjs (G2), здесь
    // достаточно того, что набор типов не пустой и осмысленный.
    expect(CHART_TYPES).toContain("bar");
    expect(CHART_TYPES).toContain("number_line");
    expect(CHART_TYPES).toContain("geometry");
    expect(new Set(CHART_TYPES).size).toBe(CHART_TYPES.length);
  });

  it("наш список предметов совпадает с.math-семейством фильтра качества", () => {
    // MATH_SUBJECTS в quality-filter приватный. Сверяем по его ПУБЛИЧНОМУ
    // поведению: для предмета из нашего списка чужая математика не выводится.
    for (const subject of GRAPH_SUBJECTS) {
      expect(looksLikeForeignMath("Решите уравнение 2x + 5 = 11.", subject), subject).toBe(false);
    }
    // И наоборот: у предмета вне списка график мы не просим.
    expect(GRAPH_SUBJECTS.has("history")).toBe(false);
    expect(GRAPH_SUBJECTS.has("chemistry")).toBe(false);
  });

  it("валидатор не бросает ни на одном мусоре", () => {
    const junk: unknown[] = [
      null,
      undefined,
      42,
      "bar",
      [],
      [{}, {}],
      {},
      { type: "banana", data: {} },
      { type: "bar" },
      { type: "bar", title: "X", data: { labels: ["a"], values: [1, 2] } },
      { type: "line", title: "X", data: { labels: ["a", "b"], series: [] } },
      { type: "geometry", shape: "hexagon", title: "X" },
      { type: "chemistry", diagram: "molecule", atoms: [{ id: "a", symbol: "<b" }] },
    ];
    for (const value of junk) {
      expect(() => validateChartSpec(value)).not.toThrow();
      expect(validateChartSpec(value).ok).toBe(false);
    }
  });
});