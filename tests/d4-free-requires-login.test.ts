/**
 * D4: free = вход сразу. Анонимная генерация закрыта.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PLANS } from "@/lib/content/plans";

const REPO = join(__dirname, "..");

describe("D4 · free = вход сразу", () => {
  it("POST /generate требует requireAuth", () => {
    const ws = readFileSync(join(REPO, "backend/src/routes/worksheets.ts"), "utf8");
    const genIdx = ws.indexOf('worksheetsRouter.post("/generate"');
    const authIdx = ws.indexOf("requireAuth(c)", genIdx);
    expect(genIdx).toBeGreaterThan(-1);
    expect(authIdx).toBeGreaterThan(genIdx);
    expect(authIdx - genIdx).toBeLessThan(200);

    const art = readFileSync(join(REPO, "backend/src/routes/artifact-generate.ts"), "utf8");
    expect(art).toMatch(/requireAuth\(c\)/);

    const exams = readFileSync(join(REPO, "backend/src/routes/exams.ts"), "utf8");
    const examGen = exams.indexOf('examsRouter.post("/generate"');
    expect(exams.indexOf("requireAuth(c)", examGen)).toBeGreaterThan(examGen);
  });

  it("пользовательские тексты не обещают лист без регистрации", () => {
    const plansText = PLANS.free.features.join("\n") + "\n" + PLANS.free.description;
    expect(plansText).not.toMatch(/без регистрации/i);

    const hero = readFileSync(join(REPO, "src/components/landing/Hero.tsx"), "utf8");
    expect(hero).not.toMatch(/без регистрации/);

    const login = readFileSync(join(REPO, "src/app/login/page.tsx"), "utf8");
    expect(login).not.toMatch(/Создать лист без регистрации/);
  });
});
