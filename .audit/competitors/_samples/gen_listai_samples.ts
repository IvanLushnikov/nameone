import { generateWorksheet } from "../../../src/lib/mock/generator";
import { writeFileSync } from "fs";

const REQS = [
  { subject: "russian" as const, grade: 5 as const, topic: "imya-suchestvitelnoe", difficulty: "medium" as const, count: 8 },
  { subject: "math" as const, grade: 4 as const, topic: "delenie-mnogoznachnyh-chisel", difficulty: "medium" as const, count: 8 },
  { subject: "english" as const, grade: 5 as const, topic: "past-simple", difficulty: "medium" as const, count: 8 },
];

const out: any[] = [];
for (const r of REQS) {
  const ws = generateWorksheet(r);
  out.push(ws);
}
writeFileSync(__dirname + "/listai_samples.json", JSON.stringify(out, null, 2));
console.log("Saved", out.length, "worksheets");
