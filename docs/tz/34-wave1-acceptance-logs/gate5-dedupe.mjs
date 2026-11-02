/**
 * Гейт 5: частота дублей по боевой базе УчЛиста.
 *
 * Данные: /tmp/qa-wave1/ws-raw.json — выгрузка worksheets.payload_json
 * (174 листа) из боевой D1 через wrangler.
 *
 * Граница волны 1: 2026-10-29T19:44:00Z (момент выката волны 1 на бою).
 */
import { readFileSync } from "node:fs";

const rows = JSON.parse(readFileSync("/tmp/qa-wave1/ws-raw.json", "utf8"))[0].results;
const DEPLOY = Math.floor(Date.parse("2026-10-29T19:44:00Z") / 1000);

const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^а-яa-z0-9]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ");

const items = rows.map((r) => {
  const p = JSON.parse(r.payload_json);
  return {
    id: r.id,
    subject: r.subject,
    grade: r.grade,
    topic: r.topic,
    count: r.count,
    key: [r.subject, r.grade, r.topic, r.difficulty, r.count].join("|"),
    texts: (p.tasks || []).map((t) => norm(t.text)),
    types: (p.tasks || []).map((t) => t.type),
    created: r.created_at,
  };
});

function stats(list, label) {
  if (!list.length) {
    console.log(`\n${label}\n   — нет данных`);
    return;
  }

  // 1. ПОЛНЫЕ дубли: полностью совпадающий набор текстов заданий.
  const byText = new Map();
  for (const it of list) {
    const sig = it.texts.join("~");
    if (!sig) continue;
    if (!byText.has(sig)) byText.set(sig, []);
    byText.get(sig).push(it);
  }
  const groups = [...byText.values()].filter((g) => g.length > 1);
  const dupSheets = groups.reduce((s, g) => s + g.length, 0);

  // 2. СЕРИЯ ОДИНАКОВЫХ ФОРМ: текст задания встречается в базе >= 2 раз.
  const textCount = new Map();
  for (const it of list) for (const t of it.texts) textCount.set(t, (textCount.get(t) ?? 0) + 1);
  let tot = 0;
  let rep = 0;
  let sheetsRep = 0;
  for (const it of list) {
    let r = 0;
    for (const t of it.texts) {
      tot++;
      if ((textCount.get(t) ?? 0) >= 2) {
        rep++;
        r++;
      }
    }
    if (r > 0) sheetsRep++;
  }

  console.log(`\n${label}`);
  console.log(
    `   листов: ${list.length} | групп-дублей: ${groups.length} | листов в группах: ${dupSheets} (${pct(dupSheets, list.length)}%)`,
  );
  console.log(
    `   заданий: ${tot} | встречаются >=2 раз: ${rep} (${pct(rep, tot)}%) | листов с повтором: ${sheetsRep} (${pct(sheetsRep, list.length)}%)`,
  );
  for (const g of groups) {
    const ts = g.map((x) => x.created).sort((a, b) => a - b);
    console.log(
      `     группа ${g.length} шт | key=${g[0].key} | уник. наборов текстов: ${new Set(g.map((x) => x.texts.join("~"))).size} | ${new Date(ts[0] * 1000).toISOString().slice(0, 16)} → ${new Date(ts[ts.length - 1] * 1000).toISOString().slice(0, 16)}`,
    );
  }
}

const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) : "0.0");

console.log("ГЕЙТ 5. ДУБЛИ И СЕРИИ ОДИНАКОВЫХ ФОРМ (боевая база)");
console.log(`волна 1 выкачена: ${new Date(DEPLOY * 1000).toISOString()}`);

stats(items, "ВСЯ БАЗА");
stats(
  items.filter((i) => i.created < DEPLOY),
  "ДО ВОЛНЫ 1 (до 29.10 19:44 UTC)",
);
stats(
  items.filter((i) => i.created >= DEPLOY),
  "ПОСЛЕ ВОЛНЫ 1 (29.10 19:44 UTC → 30.10)",
);

// Распределение по дням.
const byDay = {};
for (const it of items) {
  const d = new Date(it.created * 1000).toISOString().slice(0, 10);
  byDay[d] = (byDay[d] ?? 0) + 1;
}
console.log("\nлистов по дням:");
console.log(
  JSON.stringify(
    Object.fromEntries(Object.entries(byDay).sort((a, b) => (a[0] < b[0] ? -1 : 1))),
    null,
    0,
  ),
);
