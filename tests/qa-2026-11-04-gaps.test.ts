/**
 * QA gaps 2026-11-04 после preview @ ccd564d (#63).
 * Канарейка: учительский «без регистрации» запрещён; ученический сохранён;
 * ОГРНИП — один источник из site.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OPERATOR_ADDRESS, OPERATOR_OGRNIP } from "@/lib/site";
import { operator } from "@/lib/content/trust";

const ROOT = join(__dirname, "..");

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function visible(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

const FORBIDDEN =
  /(?<![а-яёa-zА-ЯЁA-Z])без регистрации(?![а-яёa-zА-ЯЁA-Z])/iu;

describe("QA-001 · учительский копирайт vs вход", () => {
  it("позитивный контроль ловит плохой текст", () => {
    expect(FORBIDDEN.test("Сделайте лист без регистрации")).toBe(true);
    expect(FORBIDDEN.test("безрегистрации")).toBe(false);
  });

  it.each([
    "src/components/landing/Hero.tsx",
    "src/components/landing/CTA.tsx",
    "src/app/layout.tsx",
    "src/app/page.tsx",
    "src/app/constructor/page.tsx",
    "src/app/legal/[slug]/page.tsx",
  ])("%s: нет учительского «без регистрации»", (file) => {
    expect(visible(src(file))).not.toMatch(FORBIDDEN);
  });

  it("ученические фразы сохранены", () => {
    expect(visible(src("src/components/landing/HiddenFeatures.tsx"))).toMatch(
      /без регистрации/i,
    );
    expect(visible(src("src/components/interactives/InteractiveShell.tsx"))).toMatch(
      /регистрация не нужна/i,
    );
    expect(visible(src("src/app/form/FormRunner.tsx"))).toMatch(
      /регистрация не нужна/i,
    );
  });
});

describe("QA · ОГРНИП один источник", () => {
  it("дефолты пустые — без фейка", () => {
    expect(OPERATOR_OGRNIP).toBe("");
    expect(OPERATOR_ADDRESS).toBe("");
  });

  it("trust.operator.ogrnip берёт плейсхолдер при пустом env", () => {
    expect(operator.ogrnip).toMatch(/по запросу/i);
    expect(operator.regime).toMatch(/индивидуальн/i);
  });

  it("legal и trust импортируют OPERATOR_OGRNIP", () => {
    expect(src("src/app/legal/[slug]/page.tsx")).toMatch(/OPERATOR_OGRNIP/);
    expect(src("src/lib/content/trust.ts")).toMatch(/OPERATOR_OGRNIP/);
    expect(src("src/app/contact/page.tsx")).toMatch(/operator\.ogrnip/);
  });
});
