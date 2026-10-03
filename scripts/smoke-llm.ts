/**
 * Smoke-тест LLM-слоя.
 * Без API-ключей в .env.local — skip-логика, ничего не падает.
 * С ключами — реальные вызовы по каждой роли: gen, validate, embed, image-gen.
 *
 * Запуск: npm run smoke
 * или:   npx tsx scripts/smoke-llm.ts
 */

import { generateWorksheet, validateWorksheet, embed, generateImage, isImageGenAvailable } from "../src/lib/llm";
import { availableModels } from "../src/lib/llm/router";
import { ENV_KEYS } from "../src/lib/llm/config";
import type { GenerationRequest } from "../src/lib/types";

const REQUEST: GenerationRequest = {
  subject: "math",
  grade: 5,
  topic: "Площадь треугольника",
  difficulty: "medium",
  count: 4,
  type: "worksheet",
  withAnswers: true,
  withExplanations: true,
};

const TOPICS = ["Площадь треугольника", "Площадь треугольника 5 класс", "Интегралы методом Симпсона"];

type Outcome = "skip" | "ok" | "fail";
interface Check {
  name: string;
  outcome: Outcome;
  latencyMs?: number;
  cost?: number;
  error?: string;
  note?: string;
}

const checks: Check[] = [];

function record(c: Check) {
  checks.push(c);
  const tag = c.outcome === "ok" ? "✅" : c.outcome === "skip" ? "⏭️ " : "❌";
  const tail = c.error ? ` | ${c.error}` : c.note ? ` | ${c.note}` : "";
  console.log(`${tag} ${c.name}${c.latencyMs ? ` | ${c.latencyMs}ms` : ""}${c.cost != null ? ` | $${c.cost.toFixed(5)}` : ""}${tail}`);
}

function hasKey(name: keyof typeof ENV_KEYS): boolean {
  return !!process.env[ENV_KEYS[name]];
}

async function checkGeneration(plan: "free" | "plus"): Promise<{ worksheet?: unknown }> {
  const name = `Generation (plan=${plan})`;
  const need = ["openai", plan === "plus" ? "anthropic" : null].filter(Boolean);
  const missing = need.filter((n) => !hasKey(n as keyof typeof ENV_KEYS));
  if (missing.length > 0) {
    record({ name, outcome: "skip", note: `нет ключа: ${missing.join(", ")}` });
    return {};
  }
  try {
    const r = await generateWorksheet({ request: REQUEST, bypassCache: true });
    if (!r.worksheet.tasks.length) {
      record({ name, outcome: "fail", error: "пустой tasks[]" });
      return {};
    }
    record({
      name,
      outcome: "ok",
      latencyMs: r.meta.latencyMs,
      cost: r.meta.costUsd,
      note: `${r.worksheet.tasks.length} задач, model=${r.meta.model}`,
    });
    return { worksheet: r.worksheet };
  } catch (e) {
    record({ name, outcome: "fail", error: String(e).slice(0, 200) });
    return {};
  }
}

async function checkValidation(worksheet: unknown) {
  const name = "Validation (DeepSeek V4 Flash)";
  if (!hasKey("deepseek") && !hasKey("openai")) {
    record({ name, outcome: "skip", note: "нет DEEPSEEK_API_KEY / OPENAI_API_KEY" });
    return;
  }
  if (!worksheet) {
    record({ name, outcome: "skip", note: "нет результата генерации" });
    return;
  }
  try {
    const r = await validateWorksheet({ worksheet: worksheet as never, context: { subject: REQUEST.subject, grade: REQUEST.grade, topic: REQUEST.topic } });
    record({ name, outcome: "ok", cost: r.meta.costUsd, note: `score=${r.score.toFixed(2)} issues=${r.issues.length}` });
  } catch (e) {
    record({ name, outcome: "fail", error: String(e).slice(0, 200) });
  }
}

async function checkEmbeddings() {
  const name = "Embeddings";
  if (!hasKey("openai") && !hasKey("dashscope")) {
    record({ name, outcome: "skip", note: "нет ключей для embeddings" });
    return;
  }
  try {
    const r = await embed([...TOPICS]);
    if (r.vectors.length !== TOPICS.length) {
      record({ name, outcome: "fail", error: `вернулось ${r.vectors.length}/${TOPICS.length}` });
      return;
    }
    record({ name, outcome: "ok", cost: r.costUsd, note: `${TOPICS.length} vectors, dim=${r.vectors[0].length}, model=${r.model}` });
  } catch (e) {
    record({ name, outcome: "fail", error: String(e).slice(0, 200) });
  }
}

async function checkSemanticCache() {
  const name = "Semantic cache";
  if (!hasKey("openai") && !hasKey("dashscope")) {
    record({ name, outcome: "skip", note: "нет ключей для embeddings" });
    return;
  }
  try {
    const r = await embed([...TOPICS]);
    const cos = (a: number[], b: number[]) => {
      let dot = 0, na = 0, nb = 0;
      const len = Math.min(a.length, b.length);
      for (let i = 0; i < len; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
      return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
    };
    const sim01 = cos(r.vectors[0], r.vectors[1]);
    const sim02 = cos(r.vectors[0], r.vectors[2]);
    const ok = sim01 > sim02 && sim01 > 0.7;
    record({
      name,
      outcome: ok ? "ok" : "fail",
      note: `sim(0,1)=${sim01.toFixed(3)}, sim(0,2)=${sim02.toFixed(3)} — ${ok ? "кэш сработает" : "семантика слабая"}`,
    });
  } catch (e) {
    record({ name, outcome: "fail", error: String(e).slice(0, 200) });
  }
}

async function checkImageGen() {
  const name = "Image gen (FLUX / Mercury)";
  if (!isImageGenAvailable()) {
    record({ name, outcome: "skip", note: "нет REPLICATE_API_TOKEN / INCEPTION_API_KEY" });
    return;
  }
  try {
    const r = await generateImage({
      prompt: "Простой чертёж треугольника со сторонами a, b, c и высотой h — для рабочего листа по математике, чёрно-белый, A4",
      size: { width: 800, height: 600 },
    });
    if (!r.url || !r.url.startsWith("http")) {
      record({ name, outcome: "fail", error: "нет URL" });
      return;
    }
    record({ name, outcome: "ok", cost: r.costUsd, note: `${r.model} via ${r.provider} | ${r.url.slice(0, 60)}…` });
  } catch (e) {
    record({ name, outcome: "fail", error: String(e).slice(0, 200) });
  }
}

async function main() {
  console.log("╭───────────────────────────────────────────╮");
  console.log("│   УчЛист — LLM smoke-тест        │");
  console.log("╰───────────────────────────────────────────╯");

  const models = availableModels();
  if (models.length === 0) {
    console.log("\n⚠  Ни одна модель не доступна — все проверки skip.");
    console.log("   Положи ключи в `.env.local` (см. `.env.example`), потом `npm run smoke`.\n");
  } else {
    console.log(`\n🔑 Доступны модели: ${models.join(", ")}\n`);
  }

  const { worksheet } = await checkGeneration("free");
  await checkValidation(worksheet);
  await checkEmbeddings();
  await checkSemanticCache();
  await checkImageGen();

  console.log("\n────────── summary ──────────");
  const ok = checks.filter((c) => c.outcome === "ok").length;
  const skip = checks.filter((c) => c.outcome === "skip").length;
  const fail = checks.filter((c) => c.outcome === "fail").length;
  const totalCost = checks.reduce((s, c) => s + (c.cost ?? 0), 0);
  console.log(`${ok} ok · ${skip} skip · ${fail} fail · $${totalCost.toFixed(5)} total`);
  if (skip > 0) console.log("💡 Если тестов-«skip» слишком много — добавь ключи в `.env.local`.");
  console.log("");

  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
