/**
 * Разовый дамп примеров для ручной вычитки (аудит качества заданий).
 * Пишет по одному файлу на предмет в /tmp/ul-audit/<subject>.txt
 * и сводку /tmp/ul-audit/_all.txt
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { subjects } from "../src/lib/content/subjects";

const OUT = "/tmp/ul-audit";
mkdirSync(OUT, { recursive: true });

let total = 0;
const summary: string[] = [];

for (const s of subjects) {
  const lines: string[] = [];
  let n = 0;
  for (const g of s.grades) {
    lines.push(`## КЛАСС ${g.num}`);
    for (const t of g.topics) {
      lines.push(`### [${t.slug}] ${t.title}  (ФГОС: ${t.fgosRef ?? "—"})`);
      t.examples.forEach((e, i) => {
        n += 1;
        lines.push(
          `#${n} (${g.num}кл / ${t.slug} / ex${i + 1})`,
          `  Q: ${e.text}`,
          `  A: ${e.answer ?? "<<ПУСТО>>"}`,
          e.hint ? `  H: ${e.hint}` : "",
          "",
        );
      });
    }
    lines.push("");
  }
  writeFileSync(`${OUT}/${s.slug}.txt`, lines.join("\n"));
  total += n;
  summary.push(`${s.slug}\t${s.grades.length}кл\t${n} примеров`);
  console.log(`${s.slug}: ${n}`);
}

writeFileSync(`${OUT}/_all.txt`, summary.join("\n"));
console.log(`TOTAL: ${total}`);
