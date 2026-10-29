/**
 * Трассировщик клиентских зависимостей: показывает, кто тянет тяжёлые модули.
 * Служебный инструмент для правки бандла, в сборку не входит.
 *
 *   node scripts/trace-heavy-imports.mjs src/app/page.tsx [src/app/...]
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SRC = path.join(ROOT, "src");
const exts = [".ts", ".tsx", ".js", ".jsx", ".json"];

function resolve(spec, fromFile) {
  let base;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return null;
  for (const e of exts) if (fs.existsSync(base + e)) return base + e;
  for (const e of exts) {
    const p = path.join(base, "index" + e);
    if (fs.existsSync(p)) return p;
  }
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;
  return null;
}

const cache = new Map();
function deps(file) {
  if (cache.has(file)) return cache.get(file);
  const out = new Set();
  let src;
  try {
    src = fs.readFileSync(file, "utf8");
  } catch {
    cache.set(file, out);
    return out;
  }
  const re = /(?:import\s+(?:[\s\S]*?)\s+from\s+|import\s*|require\s*\(\s*)['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    const r = resolve(m[1], file);
    if (r) out.add(r);
  }
  cache.set(file, out);
  return out;
}

const TARGETS = {
  "subjects.ts (~3.8 МБ)": path.join(SRC, "lib/content/subjects.ts"),
  "fgos data.json (3.5 МБ)": path.join(SRC, "lib/content/grade-extensions/fgos-program/data.json"),
};

const seen = new Set();
function dfs(f, trail) {
  if (seen.has(f)) return null;
  seen.add(f);
  for (const [name, t] of Object.entries(TARGETS)) if (f === t) return [...trail, name];
  for (const d of deps(f)) {
    const r = dfs(d, [...trail, path.relative(ROOT, d)]);
    if (r) return r;
  }
  return null;
}

for (const entry of process.argv.slice(2)) {
  const abs = path.resolve(ROOT, entry);
  console.log(`\n===== ${entry}`);
  seen.clear();
  const r = dfs(abs, []);
  if (r) {
    console.log("ЦЕЛЬ:", r[r.length - 1]);
    r.forEach((x, i) => console.log("  " + "  ".repeat(i) + x));
  } else {
    console.log("ТЯЖЁЛОГО НЕТ — чисто");
  }
}
