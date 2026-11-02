/**
 * Offline Gen wave1: dump buildWorksheetPrompt for matrix cases.
 * Run: cd backend && ./node_modules/.bin/tsx ../docs/qa/offline-gen/wave1-worksheet/dump-prompts.ts
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildWorksheetPrompt } from "../../../../backend/src/llm/prompts/worksheet-gen.ts";
import type { GenerationRequest } from "../../../../backend/src/types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CASES = [
  {
    id: "W1",
    subject: "math",
    grade: 5,
    topicRequested: "Обыкновенные дроби",
    topicUsed: "Обыкновенные дроби",
    count: 12,
  },
  {
    id: "W2",
    subject: "biology",
    grade: 7,
    topicRequested: "Клетка",
    topicUsed: "Клеточное строение организмов",
    count: 12,
  },
  {
    id: "W3",
    subject: "english",
    grade: 9,
    topicRequested: "Present Perfect",
    topicUsed: "Present Perfect",
    count: 10,
  },
  {
    id: "W4",
    subject: "russian",
    grade: 8,
    topicRequested: "Причастие",
    topicUsed: "Причастие. Причастный оборот",
    count: 10,
  },
  {
    id: "W5",
    subject: "physics",
    grade: 7,
    topicRequested: "Скорость. Путь. Время",
    topicUsed: "Механическое движение. Скорость",
    count: 10,
  },
  {
    id: "W6a",
    subject: "math",
    grade: 5,
    topicRequested: "Обыкновенные дроби",
    topicUsed: "Обыкновенные дроби",
    count: 12,
  },
  {
    id: "W6b",
    subject: "math",
    grade: 5,
    topicRequested: "Обыкновенные дроби",
    topicUsed: "Обыкновенные дроби",
    count: 12,
  },
  {
    id: "W6c",
    subject: "math",
    grade: 5,
    topicRequested: "Обыкновенные дроби",
    topicUsed: "Обыкновенные дроби",
    count: 12,
  },
] as const;

function baseReq(c: (typeof CASES)[number]): GenerationRequest {
  return {
    subject: c.subject as GenerationRequest["subject"],
    grade: c.grade,
    topic: c.topicUsed,
    difficulty: "medium",
    count: c.count,
    type: "worksheet",
    withAnswers: true,
    withExplanations: true,
  };
}

for (const c of CASES) {
  const dir = path.join(__dirname, c.id);
  fs.mkdirSync(dir, { recursive: true });
  const { system, user } = buildWorksheetPrompt(baseReq(c));
  fs.writeFileSync(path.join(dir, "prompt.system.txt"), system, "utf8");
  fs.writeFileSync(path.join(dir, "prompt.user.txt"), user, "utf8");
  const meta = {
    id: c.id,
    subject: c.subject,
    grade: c.grade,
    topic: c.topicUsed,
    topicRequested: c.topicRequested,
    topicUsed: c.topicUsed,
    taskCount: c.count,
    difficulty: "mixed",
    difficultyInRequest: "medium",
    language: c.subject === "english" ? "en" : "ru",
    model: "composer-2.5",
    stage: "raw-model",
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2) + "\n", "utf8");
  console.log("ok", c.id, system.length, user.length);
}
