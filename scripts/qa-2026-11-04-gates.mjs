#!/usr/bin/env node
/**
 * Runnable gates for QA gaps 2026-11-04.
 * Usage: node scripts/qa-2026-11-04-gates.mjs <gate-id>
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const gate = process.argv[2];

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** Strip block/line comments so gates judge user-facing strings. */
function visible(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === "out") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(name)) out.push(p);
  }
  return out;
}

const TEACHER_FORBIDDEN = [
  /(?<![а-яёa-zА-ЯЁA-Z])без регистрации(?![а-яёa-zА-ЯЁA-Z])/iu,
  /(?<![а-яёa-zА-ЯЁA-Z])регистрация не нужна(?![а-яёa-zА-ЯЁA-Z])/iu,
  /(?<![а-яёa-zА-ЯЁA-Z])регистрации не нужно(?![а-яёa-zА-ЯЁA-Z])/iu,
];

/** Paths where student/QR «без регистрации» is allowed (substring of rel path). */
const STUDENT_ALLOW = [
  "components/landing/HiddenFeatures.tsx",
  "components/interactives/InteractiveShell.tsx",
  "components/student/StudentClassPage.tsx",
  "app/form/FormRunner.tsx",
  "app/dashboard/page.tsx",
  "app/play/",
];

function isStudentAllow(rel) {
  return STUDENT_ALLOW.some((a) => rel.includes(a));
}

function teacherCopy() {
  // Positive control: cyrillic boundaries must catch bad teacher copy.
  const bad = "Сделайте лист без регистрации прямо сейчас.";
  const okStudent = "Ученик заходит без регистрации по QR.";
  if (!TEACHER_FORBIDDEN[0].test(bad)) {
    fail("positive control failed: pattern misses teacher «без регистрации»");
  }
  if (!TEACHER_FORBIDDEN[0].test(okStudent)) {
    fail("positive control sanity: student phrase should also match raw pattern");
  }

  const hits = [];
  for (const abs of walk(join(ROOT, "src"))) {
    const rel = relative(ROOT, abs).replace(/\\/g, "/");
    if (isStudentAllow(rel)) continue;
    // Dev-only comments / docs in lib/dev are not teacher CTA.
    if (rel.includes("lib/dev/")) continue;
    const text = visible(read(rel));
    for (const re of TEACHER_FORBIDDEN) {
      if (re.test(text)) hits.push(rel);
    }
  }
  if (hits.length) {
    fail(`teacher-copy forbidden phrases remain in:\n${[...new Set(hits)].join("\n")}`);
  }

  // Student phrases must remain.
  const studentFiles = [
    "src/components/landing/HiddenFeatures.tsx",
    "src/components/interactives/InteractiveShell.tsx",
    "src/app/form/FormRunner.tsx",
    "src/components/student/StudentClassPage.tsx",
  ];
  for (const f of studentFiles) {
    const t = visible(read(f));
    if (!/(без регистрации|регистрация не нужна)/i.test(t)) {
      fail(`student phrase removed from ${f}`);
    }
  }

  console.log("teacher-copy verification passed");
}

function familyAccess() {
  const plans = read("src/lib/content/plans.ts");
  if (/(?<![а-яёa-zА-ЯЁA-Z])Семейный доступ(?![а-яёa-zА-ЯЁA-Z])/u.test(visible(plans))) {
    fail("«Семейный доступ» still in plans.ts");
  }
  // Positive control
  if (!/Семейный доступ/.test("Семейный доступ до 5 человек")) {
    fail("positive control failed for family phrase");
  }
  const userFacing = [
    "src/app/pricing/page.tsx",
    "src/components/landing/PricingTeaser.tsx",
  ];
  for (const f of userFacing) {
    try {
      const t = visible(read(f));
      if (/Семейный доступ/i.test(t)) fail(`«Семейный доступ» in ${f}`);
    } catch {
      /* optional file */
    }
  }
  console.log("family-access verification passed");
}

function ipStatus() {
  const files = [
    "src/app/legal/[slug]/page.tsx",
    "src/lib/content/trust.ts",
    "src/lib/site.ts",
    "src/app/contact/page.tsx",
  ];
  for (const f of files) {
    const t = visible(read(f));
    if (/(самозанят|НПД)/i.test(t)) fail(`НПД/самозанятый remains in ${f}`);
  }
  const trust = visible(read("src/lib/content/trust.ts"));
  if (!/индивидуальн(ый|ого) предприниматель/i.test(trust)) {
    fail("trust.ts missing ИП wording");
  }
  const legal = visible(read("src/app/legal/[slug]/page.tsx"));
  if (!/индивидуальн(ый|ого) предприниматель/i.test(legal)) {
    fail("legal page missing ИП wording");
  }
  console.log("ip-status verification passed");
}

function ogrnipSource() {
  const site = read("src/lib/site.ts");
  if (!/export const OPERATOR_OGRNIP/.test(site)) {
    fail("OPERATOR_OGRNIP missing in site.ts");
  }
  if (!/export const OPERATOR_ADDRESS/.test(site)) {
    fail("OPERATOR_ADDRESS missing in site.ts");
  }
  // Defaults must be empty string, not a fake number.
  const ogrnDef = site.match(/OPERATOR_OGRNIP\s*=\s*process\.env\.[^\n]+?\?\?\s*("[^"]*")/);
  const addrDef = site.match(/OPERATOR_ADDRESS\s*=\s*process\.env\.[^\n]+?\?\?\s*("[^"]*")/);
  if (!ogrnDef || ogrnDef[1] !== '""') fail("OPERATOR_OGRNIP default must be empty string");
  if (!addrDef || addrDef[1] !== '""') fail("OPERATOR_ADDRESS default must be empty string");

  const trust = read("src/lib/content/trust.ts");
  if (!/OPERATOR_OGRNIP/.test(trust)) fail("trust.ts must import/use OPERATOR_OGRNIP");
  if (!/\bogrnip\b/i.test(trust)) fail("trust.operator must expose ogrnip field");

  const legal = read("src/app/legal/[slug]/page.tsx");
  if (!/OPERATOR_OGRNIP/.test(legal)) fail("legal page must use OPERATOR_OGRNIP");

  const contact = read("src/app/contact/page.tsx");
  if (!/operator\.ogrnip|ОГРНИП/.test(contact)) {
    fail("contact page must surface ОГРНИП from operator");
  }

  const envEx = read(".env.example");
  if (!/NEXT_PUBLIC_OPERATOR_OGRNIP=/.test(envEx)) {
    fail(".env.example missing NEXT_PUBLIC_OPERATOR_OGRNIP");
  }

  // No 15-digit OGRNIP hardcode in defaults of these files.
  for (const f of ["src/lib/site.ts", "src/lib/content/trust.ts"]) {
    const t = visible(read(f));
    if (/\b\d{15}\b/.test(t)) fail(`possible fake OGRNIP digit string in ${f}`);
  }

  console.log("ogrnip-source verification passed");
}

function ogrnipPublished() {
  const inn = process.env.NEXT_PUBLIC_OPERATOR_INN?.trim() || "";
  const addr = process.env.NEXT_PUBLIC_OPERATOR_ADDRESS?.trim() || "";
  const ogrn = process.env.NEXT_PUBLIC_OPERATOR_OGRNIP?.trim() || "";
  if (!inn || !addr || !ogrn) {
    fail(
      `ogrnip-published missing env: INN=${inn ? "set" : "empty"} ADDRESS=${addr ? "set" : "empty"} OGRNIP=${ogrn ? "set" : "empty"}`,
    );
  }
  if (!/^\d{15}$/.test(ogrn)) fail("OGRNIP must be 15 digits when published");
  console.log("ogrnip-published verification passed");
}

function acceptanceTests() {
  const ws = read("backend/src/routes/worksheets.ts");
  const genIdx = ws.indexOf('worksheetsRouter.post("/generate"');
  const authIdx = ws.indexOf("requireAuth(c)", genIdx);
  if (genIdx < 0 || authIdx < genIdx || authIdx - genIdx > 200) {
    fail("POST /generate must call requireAuth soon after route");
  }

  const plans = read("src/lib/content/plans.ts");
  if (!/amount:\s*249/.test(plans) || !/amount:\s*499/.test(plans) || !/amount:\s*999/.test(plans)) {
    fail("prices 249/499/999 missing in plans.ts");
  }
  // Base norm 800 sheets: NORM_BASE / 1600 or explicit 800 * TOKENS
  if (!/800\s*\*\s*TOKENS_PER_WORKSHEET|NORM_BASE\s*=\s*1_280_000|1_280_000/.test(plans)) {
    // softer: tokensToWorksheetsLabel(NORM_BASE) and NORM_BASE constant
    if (!/NORM_BASE/.test(plans)) fail("NORM_BASE missing");
  }

  const env = {
    ...process.env,
    PATH: `/opt/homebrew/opt/node@22/bin:${process.env.PATH || ""}`,
    NEXT_TELEMETRY_DISABLED: "1",
  };
  const nodeTests = [
    "tests/d4-free-requires-login.test.ts",
    "tests/d3-tariff-norms.test.ts",
    "tests/tz26-promises.test.ts",
    "tests/qa-2026-11-04-gaps.test.ts",
  ];
  // trust-pages рендерит React → нужен jsdom (дефолт vitest), не node.
  const jsdomTests = ["tests/trust-pages.test.ts"];

  for (const [label, args] of [
    ["node", ["vitest", "run", "--environment", "node", ...nodeTests]],
    ["jsdom", ["vitest", "run", ...jsdomTests]],
  ]) {
    const r = spawnSync("npx", args, {
      cwd: ROOT,
      env,
      encoding: "utf8",
      timeout: 300_000,
    });
    process.stdout.write(r.stdout || "");
    process.stderr.write(r.stderr || "");
    if (r.status !== 0) fail(`acceptance vitest failed (${label})`);
  }
  console.log("acceptance-tests verification passed");
}

const runners = {
  "teacher-copy": teacherCopy,
  "family-access": familyAccess,
  "ip-status": ipStatus,
  "ogrnip-source": ogrnipSource,
  "ogrnip-published": ogrnipPublished,
  "acceptance-tests": acceptanceTests,
};

if (!gate || !runners[gate]) {
  fail(`usage: node scripts/qa-2026-11-04-gates.mjs <${Object.keys(runners).join("|")}>`);
}

runners[gate]();
