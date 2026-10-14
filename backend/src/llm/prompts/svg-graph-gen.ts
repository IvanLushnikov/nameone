/**
 * Схема графика по заданию листа (лист 2.1.8).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЗАЧЕМ ОТДЕЛЬНЫЙ ВЫЗОВ, А НЕ ПОЛЕ В ОСНОВНОМ ПРОМПТЕ
 * ─────────────────────────────────────────────────────────────────────────────
 * График нужен не всякому листу: в биологии, истории или русском языке его быть
 * не может, а в математике — не обязан быть. Описание схемы в основном промпте
 * стоило бы ~500 входных токенов на КАЖДЫЙ лист (они платные), ради поля,
 * которое в девяти листах из десяти останется пустым.
 *
 * Поэтому схема запрашивается вторым коротким вызовом и только когда в тексте
 * задания есть прямой просьба нарисовать: «постройте график», «изобразите
 * схему», «нарисуйте». Нет такой просьбы — нет вызова, нет токенов, нет
 * записи в `llm_logs`. Решение принимает `tasksNeedingGraph` ниже, до сети.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ГДЕ СХЕМА ПОПАДАЕТ В ОТВЕТ ЛИСТА
 * ─────────────────────────────────────────────────────────────────────────────
 * Тем же путём, что `text_latex`: дополнительным полем ЗАДАНИЯ. Ответ модели
 * — это объект с `tasks`, каждое задание кладётся в ответ API как есть (лишние
 * ключи не срезаются: `filterAndReport` в `llm/index.ts` делает
 * `{ ...task }` и `filterTasks` не пересобирает объекты). Фронт отдаёт
 * `data.worksheet` клиенту без пересборки, поэтому поле доезжает тем же
 * путём, что и все остальные поля задания.
 *
 * ⚠️ ШОВ (файл принадлежит другому листу). В `generateWorksheet`
 * (`llm/index.ts`) нужны ДВЕ строки — рядом с местом, где уже зовётся
 * `sanitizeTextLatex` для `text_latex`:
 *
 *   // 1) вместо текущего блока разбора:
 *   const graph = await attachChartSpecs({
 *     tasks: primaryFiltered.tasks,
 *     subject: request.subject,
 *     grade: request.grade,
 *     topic: request.topic,
 *     env,
 *   });
 *   // 2) и дальше собирать лист из `graph.tasks`, а не из primaryParsed.tasks
 *
 * Основной промпт при этом НЕ трогается: ни system, ни user. Схема приходит
 * отдельным коротким вызовом, поэтому кэш system-промпта у «Плюса» не
 * сбрасывается (см. предупреждение в шапке `prompts/worksheet-gen.ts`).
 */

import type { Env } from "../../env";
import { callWithFallback, pickModel } from "../router";
import { logLlmEvent } from "../log";
import {
  formatIssues,
  validateChartSpec,
  type ChartType,
  type ValidChartSpec,
} from "../svg-validate";

/**
 * Предметы, где график вообще имеет смысл.
 *
 * Тот же список, что у фильтра качества (`validation/quality-filter.ts`,
 * MATH_SUBJECTS), но без chemistry: лист про химию — это структурные формулы
 * и уравнения реакций, а не графики, и шаблон chemistry живёт отдельно.
 *
 * Список продублирован строкой, потому что оригинал приватный модульной
 * переменной. Расхождение ловит тест `svgGraphGen.test.ts`: он сверяет наш
 * список с экспортированным поведением фильтра.
 */
export const GRAPH_SUBJECTS: ReadonlySet<string> = new Set([
  "math",
  "algebra",
  "geometry",
  "informatics",
  "physics",
]);

/** Типы, которые мы ПРОСИМ у модели. Валидатор понимает и остальные. */
export const REQUESTED_CHART_TYPES = [
  "bar",
  "line",
  "pie",
  "number_line",
  "geometry",
] as const;

/**
 * Сколько графиков на один лист.
 *
 * Два — не «сколько влезет», а граница смысла: лист из десяти заданий с
 * пятью графиками перестаёт быть рабочим листом. Заодно это потолок денег —
 * каждый график это 150–250 выходных токенов.
 */
export const MAX_GRAPHS_PER_SHEET = 2;

// ─────────────────────────────────────────────────────────────────────────────
// Когда график вообще нужен
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Маркеры просьбы нарисовать.
 *
 * ⚠️ `\b` в JS работает по `[A-Za-z0-9_]` и по кириллице НЕ работает: между
 * двумя русскими буквами «граница слова» есть всегда, и `\bграфик\b` совпал бы
 * с «графиками» через каждые букву. Поэтому пишем префиксы и явные классы.
 */
const GRAPH_MARKERS: readonly RegExp[] = [
  /график/i, // график, графика, графику, графиком — префикс покрывает всё
  /нарисуй|нарисуйте/i,
  /изобрази схем|изобразите схем/i,
  /построй график|постройте график|построить график/i,
  /координатн[а-яё]+ прямая/i,
  /нумеров[а-яё]+ прямая/i,
  /проведи прямую|проведите прямую/i,
];

/** Задание в том виде, в каком оно лежит в ответе модели. */
export interface RawSheetTask {
  number?: unknown;
  text?: unknown;
  [key: string]: unknown;
}

/** Задание, по которому точно нужен рисунок. */
export interface GraphCandidate {
  number: number;
  text: string;
}

/**
 * Выбрать задания, где без графика задание бессмысленно.
 *
 * Решение детерминированное и бесплатное: по предмету + по тексту задания.
 * Именно здесь экономия — дальше по коду вызова модели нет ни одного вызова,
 * если список пуст.
 *
 * Номера заданий без номера (модель их не выдала) пропускаем: без номера схему
 * не привязать к заданию, а привязать «к первой подходящей» — угадывание.
 *
 * Ложные срабатывания допускаются намеренно: задание, где «график» упомянут
 * вскользь, стоит одного короткого вызова и одного пустого ответа. Обратная
 * ошибка — молча пропущенный график к заданию «постройте график» — учителю
 * дороже.
 */
export function tasksNeedingGraph(
  tasks: readonly RawSheetTask[],
  subject: string,
  limit = MAX_GRAPHS_PER_SHEET,
): GraphCandidate[] {
  if (!GRAPH_SUBJECTS.has(subject)) return [];
  const out: GraphCandidate[] = [];
  for (const task of tasks) {
    if (out.length >= limit) break;
    if (!task || typeof task !== "object") continue;
    const text = typeof task.text === "string" ? task.text : "";
    if (text === "") continue;
    if (!GRAPH_MARKERS.some((re) => re.test(text))) continue;
    if (typeof task.number !== "number" || !Number.isInteger(task.number)) continue;
    out.push({ number: task.number, text: text.slice(0, 400) });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Промпт
// ─────────────────────────────────────────────────────────────────────────────

/**
 * System промпт второго вызова.
 *
 * Короткий намеренно: он уходит на каждый вызов и не кэшируется, а схема
 * нужна часто (каждый лист математики с графиком). Описание типов — в
 * пределах, которые рисовалка на фронте всё равно отбрасывает.
 */
export const SVG_GRAPH_SYSTEM = `Ты — методист, который описывает график для школьного задания структурированными данными. Рисует не ты: по твоим данным фронт сам строит SVG. Твоя задача — вернуть числа и подписи, из которых рисунок получится осмысленным.

ФОРМАТ ОТВЕТА — СТРОГО JSON:
{"charts": [{"task_number": <номер задания из запроса>, "chart_spec": { ...одна схема... }}]}

ДОСТУПНЫЕ ТИПЫ (только они):
1. bar — столбчатая диаграмма: {"type":"bar","title":"...","x_label":"...","y_label":"...","data":{"labels":["..."],"values":[12,7]}}
   2–12 подписей, значений столько же, все значения ≥ 0, хотя бы одно > 0.
2. line — график зависимости, 1–3 серии: {"type":"line","title":"...","data":{"labels":["x1","x2"],"series":[{"name":"y = 2x","values":[2,4]}]}}
   2–20 подписей, в каждой серии значений ровно столько же, сколько подписей.
3. pie — круговая диаграмма: {"type":"pie","title":"...","data":{"labels":["..."],"values":[30,70]}}
   2–12 секторов, значения ≥ 0, хотя бы одно > 0.
4. number_line — координатная прямая: {"type":"number_line","title":"...","range":[-3,5],"step":1,"points":[{"value":-2,"label":"A","color":"highlight"}]}
   range — два числа, первое меньше второго, размах не больше 100. Точки строго внутри range, максимум 10. step — положительное число.
5. geometry — фигура: {"type":"geometry","shape":"triangle","title":"...","measurements":{"sides":[{"id":"AB","value":5,"unit":"см"}],"angles":[{"id":"C","value":60}]}}
   shape: triangle | rectangle | square | parallelogram | circle | trapezoid.

ЖЁСТКИЕ ПРАВИЛА:
- Ровно одна схема на каждое задание из запроса и не больше, чем там заданий. Два графика на одно задание — брак.
- Числа — те, что относятся к ЗАДАНИЮ. Не выдумывай данные: график должен показывать то, о чём задание спрашивает, иначе учитель получит картинку, противоречащую тексту.
- Никаких координат в миллионах, никаких NaN, никаких дробей в виде строк — только числа.
- В подписях (<= 30 символов) и заголовке (<= 100) ЗАПРЕЩЕНЫ символы < и >. Это текст подписей, а не разметка.
- Никаких полей сверх перечисленных. Никаких id и createdAt.
- Если схему для задания построить нельзя (в условии нет данных для графика) — пропусти это задание. Лучше лист без графика, чем график из выдуманных чисел.

БЕЗ MARKDOWN. Один JSON-объект.`;

/** Собрать промпт второго вызова по отобранным заданиям. */
export function buildSvgGraphPrompt(args: {
  subject: string;
  grade: number;
  topic: string;
  tasks: readonly GraphCandidate[];
}): { system: string; user: string } {
  const user = JSON.stringify(
    {
      задача:
        "Опиши график для этих заданий листа. Данные бери из текста задания.",
      параметры: {
        subject: args.subject,
        grade: args.grade,
        topic: args.topic,
      },
      задания: args.tasks.map((t) => ({ task_number: t.number, текст: t.text })),
      требования: {
        одна_схема_на_задание: true,
        не_выдумывать_данные:
          "График должен показывать то, о чём задание. Нет данных — пропусти задание.",
        без_сложных_символов: "В подписях и заголовке не использовать < и >.",
      },
      верни: 'JSON: {"charts": [{"task_number": N, "chart_spec": {...}}]}',
    },
    null,
    2,
  );

  return { system: SVG_GRAPH_SYSTEM, user };
}

// ─────────────────────────────────────────────────────────────────────────────
// Разбор и проверка ответа
// ─────────────────────────────────────────────────────────────────────────────

/** Схема, прошедшая проверку, с привязкой к номеру задания. */
export interface ChartAttachment {
  taskNumber: number;
  type: ChartType;
  spec: ValidChartSpec;
}

/** Почему задание осталось без графика. Уходит в лог, не учителю. */
export interface ChartDrop {
  taskNumber: number;
  reasons: string;
}

export interface GraphGenReport {
  /** Номера заданий, по которым реально спросили модель. */
  asked: number[];
  /** Что привязалось к заданиям. */
  attached: { taskNumber: number; type: ChartType }[];
  /** Что спросили, но не привязалось. */
  dropped: ChartDrop[];
  /** null — модель не звали. */
  model: string | null;
  costUsd: number;
  /** Причина, по которой графика не будет, если его не будет. */
  skipped: string | null;
}

/** Потолок ответа: два графика по ~250 токенов — больше уже не схема, а мусор. */
const MAX_CHARTS_IN_RESPONSE = MAX_GRAPHS_PER_SHEET;

/**
 * Разобрать ответ модели в список схем по заданиям.
 *
 * Разбор и проверка разнесены: сначала достаём «номер задания + сырая схема»,
 * потом каждую схему проверяет `validateChartSpec`. Так причина отказа
 * доезжает до лога, а не теряется в try/catch.
 *
 * ⚠️ НИКОГДА не бросает: ответ внешней системы, а учитель должен получить лист.
 */
export function collectCharts(
  content: string,
  candidates: readonly GraphCandidate[],
  limit = MAX_CHARTS_IN_RESPONSE,
): { charts: ChartAttachment[]; dropped: ChartDrop[] } {
  const charts: ChartAttachment[] = [];
  const dropped: ChartDrop[] = [];
  const wanted = new Set(candidates.map((c) => c.number));

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { charts, dropped: [...wanted].map((n) => ({ taskNumber: n, reasons: "bad-json: ответ не JSON" })) };
  }

  const rawCharts =
    parsed && typeof parsed === "object" && Array.isArray((parsed as { charts?: unknown }).charts)
      ? ((parsed as { charts: unknown[] }).charts ?? [])
      : null;

  if (!rawCharts) {
    return {
      charts,
      dropped: [...wanted].map((n) => ({
        taskNumber: n,
        reasons: "no-charts: в ответе нет поля charts",
      })),
    };
  }

  const accepted = new Map<number, ChartAttachment>();
  /** Задания, где схем уже две: ни одну не привязываем. */
  const poisoned = new Set<number>();
  for (const item of rawCharts) {
    if (!item || typeof item !== "object") continue;
    const entry = item as { task_number?: unknown; chart_spec?: unknown };
    const taskNumber = entry.task_number;
    if (typeof taskNumber !== "number" || !Number.isInteger(taskNumber)) {
      // Номер 0 в листе не встречается (нумерация с 1) — по нему видно, что
      // это «запись без задания», а не отказ по конкретному номеру.
      dropped.push({ taskNumber: 0, reasons: "bad-task-number: не целое число" });
      continue;
    }
    if (!wanted.has(taskNumber)) {
      dropped.push({ taskNumber, reasons: "unknown-task: такого задания в листе нет" });
      continue;
    }
    if (poisoned.has(taskNumber)) {
      // Третий и последующие — тоже отказ, но причину уже записали.
      continue;
    }
    if (accepted.has(taskNumber)) {
      // Два графика на одно задание. Брать первый — угадывание: по условию не
      // видно, какой из них к нему относится. Не привязываем НИ ОДНОГО, поэтому
      // первый тоже снимаем — иначе на лист уедет именно тот, который мы не
      // выбирали.
      accepted.delete(taskNumber);
      poisoned.add(taskNumber);
      dropped.push({ taskNumber, reasons: "multiple-charts: два графика на одно задание" });
      continue;
    }

    if (accepted.size >= limit) {
      dropped.push({ taskNumber, reasons: `limit: больше ${limit} графиков на лист` });
      continue;
    }

    const validation = validateChartSpec(entry.chart_spec);
    if (!validation.ok || !validation.spec) {
      dropped.push({
        taskNumber,
        reasons: validation.issues.length > 0 ? formatIssues(validation.issues) : "invalid-spec",
      });
      continue;
    }
    // Вырезанные неизвестные поля — не повод терять график, но повод его
    // записать в лог: модель начала выдумывать формат.
    if (validation.issues.length > 0) {
      logLlmEvent("warn", "svg-graph-gen: неизвестные поля вырезаны", {
        taskNumber,
        reasons: formatIssues(validation.issues),
      });
    }
    accepted.set(taskNumber, {
      taskNumber,
      type: validation.spec.type,
      spec: validation.spec,
    });
  }

  charts.push(...accepted.values());

  for (const candidate of candidates) {
    if (accepted.has(candidate.number)) continue;
    // Отказ по «двум графикам» уже записан в цикле выше — второй раз в лог не
    // пишем, иначе одно и то же отвержение будет двумя строками.
    if (poisoned.has(candidate.number)) continue;
    dropped.push({ taskNumber: candidate.number, reasons: "missing: модель пропустила задание" });
  }

  return { charts, dropped };
}

// ─────────────────────────────────────────────────────────────────────────────
// Основной вход
// ─────────────────────────────────────────────────────────────────────────────

export interface AttachChartArgs {
  tasks: readonly RawSheetTask[];
  subject: string;
  grade: number;
  topic: string;
  env: Env;
  limit?: number;
}

export interface AttachChartResult {
  /** Те же задания, но у нужных добавлено `chart_spec`. Исходный массив НЕ мутируется. */
  tasks: RawSheetTask[];
  report: GraphGenReport;
}

/**
 * Дописать к заданиям схемы графика — или честно не дописать.
 *
 * НИКОГДА не бросает и никогда не роняет генерацию листа: нет ключа, нет
 * сети, провайдер лёг 500, модель вернула мусор — учитель в любом случае
 * получает лист. Единственное, что меняется, — рисуется картинка или нет.
 *
 * Подмена заготовки на «тихо» не проходит: каждый отказ уходит в `logLlmEvent`,
 * то есть виден в `wrangler tail` и в отчёте по генерациям. Молчаливая
 * подмена — это ровно тот дефект, который этот лист и закрывает.
 */
export async function attachChartSpecs(args: AttachChartArgs): Promise<AttachChartResult> {
  const limit = args.limit ?? MAX_GRAPHS_PER_SHEET;
  const candidates = tasksNeedingGraph(args.tasks, args.subject, limit);

  const report: GraphGenReport = {
    asked: candidates.map((c) => c.number),
    attached: [],
    dropped: [],
    model: null,
    costUsd: 0,
    skipped: null,
  };

  // Нет кандидатов — самый частый случай (биология, история, математика без
  // «постройте график»). Здесь конвейец обрывается ДО сети: ноль токенов,
  // ноль записей в llm_logs, ноль строк в логе.
  if (candidates.length === 0) {
    report.skipped = "no-candidates: ни одно задание не просит рисунок";
    return { tasks: args.tasks.slice(), report };
  }

  const decision = pickModel("svg-graph-gen", args.env);
  if (!decision.primary) {
    report.skipped = "no-key: POLZA_API_KEY не задан";
    logLlmEvent("warn", "svg-graph-gen: график не запрошен, нет ключа провайдера", {
      asked: report.asked,
      subject: args.subject,
    });
    return { tasks: args.tasks.slice(), report };
  }

  const { system, user } = buildSvgGraphPrompt({
    subject: args.subject,
    grade: args.grade,
    topic: args.topic,
    tasks: candidates,
  });

  let content = "";
  try {
    const result = await callWithFallback(
      {
        model: decision.primary.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        responseFormat: "json",
        // Ниже, чем у генерации листа: схема должна повторять одни и те же
        // числа из условия, а не варьироваться при попытке.
        temperature: 0.3,
        maxTokens: 1200,
      },
      decision,
      args.env,
      { task: "svg-graph-gen" },
    );
    content = result.response.content;
    report.model = result.model;
    report.costUsd = result.response.costUsd;
  } catch (e) {
    // Провайдер упал целиком. Лист отдаём без графика — это ровно то, за что
    // отвечает fallback = [] в роутере.
    report.skipped = `provider-error: ${e instanceof Error ? e.message : String(e)}`;
    logLlmEvent("warn", "svg-graph-gen: провайдер не ответил, лист без графика", {
      asked: report.asked,
      subject: args.subject,
      error: report.skipped,
    });
    return { tasks: args.tasks.slice(), report };
  }

  const { charts, dropped } = collectCharts(content, candidates, limit);
  report.attached = charts.map((c) => ({ taskNumber: c.taskNumber, type: c.type }));
  report.dropped = dropped;

  for (const drop of dropped) {
    logLlmEvent("warn", "svg-graph-gen: схема отброшена, задание осталось текстом", {
      taskNumber: drop.taskNumber,
      reasons: drop.reasons,
      subject: args.subject,
    });
  }
  if (charts.length === 0) {
    logLlmEvent("warn", "svg-graph-gen: ни одна схема не прошла проверку", {
      asked: report.asked,
      dropped: dropped.length,
      model: report.model,
      content: content.slice(0, 200),
    });
  } else {
    logLlmEvent("info", "svg-graph-gen: схемы привязаны к заданиям", {
      asked: report.asked,
      attached: report.attached,
      dropped: dropped.length,
      model: report.model,
      costUsd: report.costUsd,
    });
  }

  const byNumber = new Map(charts.map((c) => [c.taskNumber, c.spec]));
  // Номера заданий у модели могут повторяться (дозапрос, ретрай). Схему
  // ставим на ПЕРВОЕ такое задание: иначе один график напечатается на листе
  // дважды, и учитель получит две картинки к одному условию.
  const attachedTo = new Set<number>();
  const tasks = args.tasks.map((task) => {
    if (!task || typeof task !== "object") return task;
    const number = task.number;
    if (typeof number !== "number" || attachedTo.has(number)) return task;
    const spec = byNumber.get(number);
    if (!spec) return task;
    attachedTo.add(number);
    // Поле кладём рядом с остальными полями задания — так же, как
    // `text_latex` кладёт `sanitizeTextLatex` в том же месте конвейера.
    return { ...task, chart_spec: spec };
  });

  return { tasks, report };
}