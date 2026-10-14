#!/usr/bin/env node
/**
 * Проверка инструмента опроса (`ask-models.mjs`) без траты денег.
 *
 * Зачем: две правки в скрипте нельзя принять «на глаз». Первая — повтор пустого
 * ответа с удвоенным лимитом токенов (модели съедали лимит на размышление и
 * теряли ответы). Вторая — режим `--search-context`. Обе проверяются против
 * подставного провайдера: поднимаем локальный HTTP-сервер, который ведёт себя
 * как Polza, и смотрим, что именно отправил скрипт и что он записал на диск.
 *
 * Настоящий ключ и деньги не используются: сервер локальный, ключ фиктивный.
 *
 *   node scripts/verify-ask-models.mjs tokens   # повтор при пустом ответе
 *   node scripts/verify-ask-models.mjs search   # контекст поиска попадает в промт
 *   node scripts/verify-ask-models.mjs cli      # --list / --dry-run не сломаны
 *   node scripts/verify-ask-models.mjs all
 *
 * Выход: маркер секции в stdout, ненулевой код при провале.
 */

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** Путь к скрипту можно переопределить — на этом держится негативный контроль. */
const SKILL_SCRIPT = process.env.ASK_MODELS_SCRIPT
  ? resolve(process.env.ASK_MODELS_SCRIPT)
  : resolve(process.env.HOME, ".minimax/skills/ai-product-feedback/scripts/ask-models.mjs");

/** Порог, на котором подставной «размышляющий» модель наконец отвечает. */
const REASONING_THRESHOLD = 6000;

/** Модели в подставном каталоге: одна обычная, одна съедает лимит на размышление. */
const STUB_MODELS = ["openai/gpt-5.1", "moonshotai/kimi-k3"];

/**
 * Подставной провайдер.
 *
 * `kimi-k3` отвечает пустотой, пока `max_tokens` меньше порога — ровно так ведут
 * себя Qwen и Kimi из прогона 13.10.2026. `gpt-5.1` отвечает всегда.
 * Каждый запрос пишется в `log`, чтобы проверка утверждала не «ответ пришёл»,
 * а «скрипт поднял лимит и переспросил».
 */
function startStub({ onEmpty = "empty" } = {}) {
  const log = [];

  const server = createServer((req, res) => {
    const url = req.url ?? "";

    if (url.endsWith("/models")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: STUB_MODELS.map((id) => ({ id })) }));
      return;
    }

    if (url.endsWith("/chat/completions")) {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const body = JSON.parse(raw || "{}");
        const id = body.model ?? "?";
        const maxTokens = body.max_tokens ?? 0;
        const prompt = body.messages?.[0]?.content ?? "";
        log.push({ id, maxTokens, prompt });

        const isReasoningModel = id.startsWith("moonshotai/");
        const starved = isReasoningModel && maxTokens < REASONING_THRESHOLD;

        if (starved && onEmpty === "empty") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              model: id,
              choices: [{ message: { content: "" }, finish_reason: "length" }],
              usage: { completion_tokens: maxTokens, cost_rub: 0 },
            }),
          );
          return;
        }

        const content = `Ответ модели ${id}. В выдаче поиска: ${/uchlist\.ru/.test(prompt) ? "есть uchlist.ru" : "нет uchlist.ru"}. Цена в выдаче: ${/249/.test(prompt) ? "249" : "не указана"}.`;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            model: id,
            choices: [{ message: { content }, finish_reason: "stop" }],
            usage: { completion_tokens: 120, cost_rub: 0.01 },
          }),
        );
      });
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end("{}");
  });

  return new Promise((ok) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      ok({ server, log, baseUrl: `http://127.0.0.1:${port}/v1`, close: () => server.close() });
    });
  });
}

/**
 * Гоняет скрипт скилла против подставного провайдера.
 *
 * Именно async, а НЕ spawnSync: подставной сервер живёт в этом же процессе, а
 * spawnSync замирает на всё время дочернего процесса — цикл событий перестаёт
 * крутиться, сервер не отвечает, и проверка висит насмерть.
 */
function runAskModels({ baseUrl, outDir, extraArgs = [], env = {} }) {
  return new Promise((ok) => {
    const child = spawn(
      process.execPath,
      [SKILL_SCRIPT, "--out", outDir, "--max-tokens", "2500", ...extraArgs],
      {
        env: {
          ...process.env,
          POLZA_API_KEY: "stub-key-not-a-real-secret",
          POLZA_BASE_URL: baseUrl,
          ...env,
        },
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("close", (status) => ok({ status, stdout, stderr }));
  });
}

/**
 * Читает ответы прогона.
 *
 * Скрипт кладёт их не прямо в `--out`, а в подпапку прогона с меткой времени
 * (`<время>__<промты>/answers`), поэтому ищем её на один уровень глубже.
 */
function readAnswers(outDir) {
  const runDir = readdirSync(outDir, { withFileTypes: true }).find((e) => e.isDirectory());
  if (!runDir) return [];
  const answersDir = join(outDir, runDir.name, "answers");
  if (!existsSync(answersDir)) return [];
  return readdirSync(answersDir).map((f) => ({
    file: f,
    body: readFileSync(join(answersDir, f), "utf8"),
  }));
}

function fail(problems, marker) {
  for (const p of problems) console.error(`ПРОВАЛ: ${p}`);
  console.error(`${marker} НЕ ПРОЙДЕНА`);
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Проверка 1: пустой ответ добирается повтором с удвоенным лимитом
// ─────────────────────────────────────────────────────────────────────────────

async function checkTokens() {
  const problems = [];
  const marker = "REASONING_RETRY_RECOVERED";

  if (!existsSync(SKILL_SCRIPT)) fail([`не найден скрипт скилла: ${SKILL_SCRIPT}`], marker);

  const outDir = mkdtempSync(join(tmpdir(), "uchlist-verify-tokens-"));
  const stub = await startStub();

  try {
    const res = await runAskModels({
      baseUrl: stub.baseUrl,
      outDir,
      extraArgs: ["--prompt", "first", "--models", "moonshot"],
    });

    if (res.status !== 0) {
      problems.push(`скрипт упал (код ${res.status}): ${(res.stderr || res.stdout || "").slice(0, 400)}`);
    }

    const kimiCalls = stub.log.filter((c) => c.id.startsWith("moonshotai/"));
    if (kimiCalls.length < 2) {
      problems.push(`к «размышляющей» модели сделано ${kimiCalls.length} запросов — повтор не случился`);
    } else {
      const first = kimiCalls[0]?.maxTokens ?? 0;
      const last = kimiCalls[kimiCalls.length - 1]?.maxTokens ?? 0;
      if (last <= first) {
        problems.push(`лимит не вырос: было ${first}, стало ${last}`);
      }
      if (last < REASONING_THRESHOLD) {
        problems.push(`лимит ${last} ниже порога ${REASONING_THRESHOLD} — ответ всё равно был бы пустым`);
      }
    }

    const answers = readAnswers(outDir);
    const kimiAnswer = answers.find((a) => a.file.startsWith("moonshot__"));
    if (!kimiAnswer) {
      problems.push("нет файла ответа moonshot__first.md");
    } else if (kimiAnswer.body.includes("**Ошибка:**")) {
      problems.push(`ответ записан как ошибка: ${kimiAnswer.body.split("\n").slice(0, 6).join(" ")}`);
    } else if (!kimiAnswer.body.includes("Ответ модели moonshotai/kimi-k3")) {
      problems.push("в файле ответа нет текста модели");
    } else if (!/пустых ответов до этого: [1-9]/.test(kimiAnswer.body)) {
      problems.push("в шапке ответа не зафиксировано, что были пустые ответы");
    }
  } finally {
    stub.close();
    rmSync(outDir, { recursive: true, force: true });
  }

  if (problems.length) fail(problems, marker);
  console.log(marker);
}

// ─────────────────────────────────────────────────────────────────────────────
// Проверка 2: контекст поиска попадает в промт и в шапку ответа
// ─────────────────────────────────────────────────────────────────────────────

const SEARCH_FIXTURE = `Запрос: «УчЛист что это»

1. https://uchlist.ru/ — УчЛист: рабочие листы по ФГОС. Тарифы: Базовый 249 ₽/мес, Оптимальный 499 ₽/мес, Плюс 999 ₽/мес. 3 бесплатные генерации.
2. https://uchlist.ru/pricing/ — Тарифы — 3 бесплатные генерации, дальше от 249 ₽/мес.
`;

async function checkSearch() {
  const problems = [];
  const marker = "SEARCH_CONTEXT_INJECTED";

  const outDir = mkdtempSync(join(tmpdir(), "uchlist-verify-search-"));
  const ctxPath = join(outDir, "serp.md");
  writeFileSync(ctxPath, SEARCH_FIXTURE, "utf8");
  const stub = await startStub();

  try {
    const res = await runAskModels({
      baseUrl: stub.baseUrl,
      outDir,
      extraArgs: ["--prompt", "first", "--models", "openai", "--search-context", ctxPath],
    });

    if (res.status !== 0) {
      problems.push(`скрипт упал (код ${res.status}): ${(res.stderr || res.stdout || "").slice(0, 400)}`);
    }

    const call = stub.log.find((c) => c.id.startsWith("openai/"));
    if (!call) {
      problems.push("модель не была опрошена");
    } else {
      if (!call.prompt.includes("=== РЕЗУЛЬТАТЫ ПОИСКА ===")) {
        problems.push("в промт не попал заголовок блока выдачи");
      }
      if (!call.prompt.includes("Базовый 249 ₽/мес")) {
        problems.push("текст выдачи не попал в промт");
      }
      if (!call.prompt.includes("Я репетитор и нашла сайт")) {
        problems.push("исходный вопрос потерялся — выдача его заменила");
      }
    }

    const answers = readAnswers(outDir);
    const answer = answers.find((a) => a.file.startsWith("openai__"));
    if (!answer) problems.push("нет файла ответа openai__first.md");
    else {
      if (!answer.body.includes("с выдачей поиска")) problems.push("в шапке нет отметки про режим с поиском");
      if (!answer.body.includes(ctxPath)) problems.push("в шапке нет пути к файлу выдачи");
    }

    // Негативный контроль того же кода: БЕЗ флага выдача в промт не попадает.
    const outDir2 = mkdtempSync(join(tmpdir(), "uchlist-verify-nosearch-"));
    try {
      const stub2 = await startStub();
      try {
        await runAskModels({
          baseUrl: stub2.baseUrl,
          outDir: outDir2,
          extraArgs: ["--prompt", "first", "--models", "openai"],
        });
        const call2 = stub2.log.find((c) => c.id.startsWith("openai/"));
        if (call2 && call2.prompt.includes("249 ₽/мес")) {
          problems.push("без --search-context выдача всё равно попала в промт — флаг не работает");
        }
      } finally {
        stub2.close();
      }
    } finally {
      rmSync(outDir2, { recursive: true, force: true });
    }
  } finally {
    stub.close();
    rmSync(outDir, { recursive: true, force: true });
  }

  if (problems.length) fail(problems, marker);
  console.log(marker);
}

// ─────────────────────────────────────────────────────────────────────────────
// Проверка 3: прежние режимы не сломались, ключ не утекает
// ─────────────────────────────────────────────────────────────────────────────

async function checkCli() {
  const problems = [];
  const marker = "CLI_REGRESSION_CLEAN";

  if (!existsSync(SKILL_SCRIPT)) fail([`не найден скрипт скилла: ${SKILL_SCRIPT}`], marker);

  const stub = await startStub();
  try {
    const list = await new Promise((ok) => {
      const child = spawn(process.execPath, [SKILL_SCRIPT, "--list"], {
        env: { ...process.env, POLZA_API_KEY: "stub-key-not-a-real-secret", POLZA_BASE_URL: stub.baseUrl },
      });
      let stdout = "";
      child.stdout.on("data", (c) => (stdout += c));
      child.on("close", (status) => ok({ status, stdout }));
    });
    if (list.status !== 0) problems.push(`--list упал (код ${list.status})`);
    if (!list.stdout.includes("Что выберет опрос по умолчанию")) problems.push("--list не напечатал выбор моделей");
    if (list.stdout.includes("stub-key-not-a-real-secret")) problems.push("--list напечатал ключ");

    const outDir = mkdtempSync(join(tmpdir(), "uchlist-verify-cli-"));
    try {
      const dry = await runAskModels({ baseUrl: stub.baseUrl, outDir, extraArgs: ["--prompt", "all", "--dry-run"] });
      if (dry.status !== 0) problems.push(`--dry-run упал (код ${dry.status}): ${(dry.stderr || "").slice(0, 300)}`);
      if (!dry.stdout.includes('промт "first"')) problems.push("--dry-run не показал промт first");
      if (!dry.stdout.includes('промт "critique"')) problems.push("--dry-run не показал промт critique");
      if (dry.stdout.includes("stub-key-not-a-real-secret")) problems.push("--dry-run напечатал ключ");
      if (stub.log.some((c) => c.prompt)) problems.push("--dry-run всё-таки отправил запросы");
      if (existsSync(join(outDir, "answers"))) problems.push("--dry-run создал папку ответов");
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  } finally {
    stub.close();
  }

  if (problems.length) fail(problems, marker);
  console.log(marker);
}

const MODE = process.argv[2] ?? "all";
if (MODE === "tokens" || MODE === "all") await checkTokens();
if (MODE === "search" || MODE === "all") await checkSearch();
if (MODE === "cli" || MODE === "all") await checkCli();