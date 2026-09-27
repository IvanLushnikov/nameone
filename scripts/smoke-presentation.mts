// Smoke-скрипт: генерирует презентацию и проверяет, что PPTX собирается в ненулевой Blob.
import { generatePresentation } from "../src/lib/mock/presentation";
import { generatePptx } from "../src/lib/utils/pptx";
import { writeFile } from "node:fs/promises";

const req = {
  subject: "math" as const,
  grade: 5,
  topic: "drobi-obyknovennye",
  difficulty: "medium" as const,
  count: 10,
  type: "presentation" as const,
  withAnswers: false,
  withExplanations: false,
  slideCount: 10 as const,
};

const pres = await generatePresentation(req);
console.log("[smoke] slides:", pres.slides.length, "topic:", pres.topic, "title:", pres.title);
console.log("[smoke] first kind:", pres.slides[0].kind, "last kind:", pres.slides[pres.slides.length - 1].kind);

const blob = await generatePptx(pres);
console.log("[smoke] PPTX blob:", blob.size, "bytes, type:", blob.type);
if (blob.size < 2000) throw new Error("PPTX suspiciously small");

// Сохраняем в tmp для ручной проверки через LibreOffice
const buf = Buffer.from(await blob.arrayBuffer());
await writeFile("/tmp/presentation-smoke.pptx", buf);
console.log("[smoke] saved /tmp/presentation-smoke.pptx");
