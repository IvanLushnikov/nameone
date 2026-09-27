/**
 * Smoke-скрипт для ручной проверки DOCX-экспорта плана урока.
 * Запуск: `npx tsx scripts/smoke-lesson-plan.ts`
 *
 * Генерирует план урока для math/5/drobi-obyknovennye и пишет DOCX в /tmp,
 * чтобы родитель мог открыть файл в LibreOffice / Word и проверить вёрстку.
 */
import { writeFileSync } from "node:fs";
import { generateLessonPlan } from "../src/lib/mock/lesson-plan";
import { generateLessonPlanDocx } from "../src/lib/utils/lesson-plan-docx";

async function main() {
  const plan = await generateLessonPlan({
    subject: "math",
    grade: 5,
    topic: "drobi-obyknovennye",
    difficulty: "medium",
    count: 5,
    type: "lesson-plan",
    withAnswers: false,
    withExplanations: false,
  });

  const totalMin = plan.stages.reduce((s, st) => s + st.durationMin, 0);
  console.log("=== Plan summary ===");
  console.log("Title:", plan.title);
  console.log("Stages:", plan.stages.length, `(${totalMin} min)`);
  console.log("Goals: educational =", plan.goals.educational.length,
              "developmental =", plan.goals.developmental.length,
              "nurturing =", plan.goals.nurturing.length);
  console.log("Equipment:", plan.equipment.length, "items");
  console.log("Homework alternatives:", plan.homework.alternatives?.length ?? 0);

  const blob = await generateLessonPlanDocx(plan);
  const buf = Buffer.from(await blob.arrayBuffer());
  const path = "/tmp/lesson-plan-smoke.docx";
  writeFileSync(path, buf);
  console.log(`\nDOCX written: ${path} (${buf.length} bytes)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});