/**
 * TZ-16 §3.4: тесты «Урока целиком» (мок + параллельность + ZIP-экспорт).
 *
 * Edge cases:
 *   1. happy path — 4 слота собраны из существующих моков, failed пуст;
 *      лист и тест — РАЗНЫЕ артефакты (test перепакован в multiple-choice).
 *   2. ПАРАЛЛЕЛЬНОСТЬ — главное проектное решение типа. Замеряем wall-clock:
 *      4 слота с задержкой 120 мс каждый собираются заметно быстрее, чем
 *      сумма последовательных задержек (480 мс).
 *   3. Частичный отказ — один слот падает, остальные три заполнены,
 *      `failed` содержит ровно одну запись с причиной.
 *   4. Таймаут пакета — слот, не ответивший за 30 мс, уходит в `failed`
 *      с упоминанием времени ожидания.
 *   5. ZIP-экспорт — 4 файла с ASCII-именами; в частичном комплекте
 *      файлов 3, и упавшего слота в архиве нет.
 */
import JSZip from "jszip";
import { describe, it, expect } from "vitest";
import type { GenerationRequest, LessonBundle } from "@/lib/types";
import { mockLessonBundle, buildLessonBundle, BUNDLE_SLOTS } from "@/lib/mock/lesson-bundle";
import { generateBundleZip, bundleZipFilename } from "@/lib/utils/bundle-zip";

const baseReq = (overrides: Partial<GenerationRequest> = {}): GenerationRequest => ({
  subject: "math",
  grade: 5,
  topic: "drobi-obyknovennye",
  difficulty: "medium",
  count: 5,
  type: "lesson-bundle",
  withAnswers: false,
  withExplanations: false,
  ...overrides,
});

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Имена файлов внутри готового ZIP-архива. */
async function zipNames(bundle: LessonBundle): Promise<string[]> {
  const blob = await generateBundleZip(bundle);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  return Object.keys(zip.files).filter((n) => !zip.files[n].dir);
}

describe("mockLessonBundle — happy path", () => {
  it("собирает 4 слота из моков, failed: []", async () => {
    const bundle = await mockLessonBundle(baseReq());

    expect(bundle.lessonPlan).not.toBeNull();
    expect(bundle.presentation).not.toBeNull();
    expect(bundle.worksheet).not.toBeNull();
    expect(bundle.test).not.toBeNull();
    expect(bundle.failed).toEqual([]);
    expect(bundle.title).toContain("Урок целиком");
    expect(bundle.totalMs).toBeGreaterThanOrEqual(0);
  });

  it("тест — не копия рабочего листа: задания перепакованы в multiple-choice", async () => {
    const bundle = await mockLessonBundle(baseReq());
    const ws = bundle.worksheet!;
    const test = bundle.test!;

    expect(test.tasks.length).toBe(ws.tasks.length);
    const wsKinds = new Set(ws.tasks.map((t) => t.type));
    const testKinds = new Set(test.tasks.map((t) => t.type));

    expect(testKinds.has("multiple-choice")).toBe(true);
    // У рабочего листа multiple-choice быть не должно — иначе в ZIP
    // лежали бы два одинаковых файла под разными именами.
    expect(wsKinds.has("multiple-choice")).toBe(false);
  });

  it("тема не найдена в таксономии → комплект всё равно собирается", async () => {
    const bundle = await mockLessonBundle(baseReq({ topic: "nesushchestvuyushchaya-tema" }));
    expect(bundle.lessonPlan).not.toBeNull();
    expect(bundle.test).not.toBeNull();
    expect(bundle.failed).toEqual([]);
  });
});

describe("buildLessonBundle — параллельность, а не последовательность", () => {
  it("4 слота с задержкой 120 мс собираются быстрее суммы последовательных задержек", async () => {
    const one = 120;
    const req = baseReq();
    const start = Date.now();

    // Каждый слот «отвечает» через 120 мс — как реальный LLM-вызов.
    const bundle = await buildLessonBundle(
      req,
      {
        "lesson-plan": async () => {
          await delay(one);
          return (await mockLessonBundle(req)).lessonPlan!;
        },
        presentation: async () => {
          await delay(one);
          return (await mockLessonBundle(req)).presentation!;
        },
        worksheet: async () => {
          await delay(one);
          return (await mockLessonBundle(req)).worksheet!;
        },
        test: async () => {
          await delay(one);
          return (await mockLessonBundle(req)).test!;
        },
      },
      10_000
    );

    const elapsed = Date.now() - start;
    const sequential = one * BUNDLE_SLOTS.length; // 480 мс

    expect(bundle.failed).toEqual([]);
    expect(bundle.lessonPlan).not.toBeNull();
    // Параллельно ≈ 120 мс + накладные. Порог 350 мс — заведомо ниже
    // последовательных 480 мс и с большим запасом выше параллельных 120 мс.
    expect(elapsed).toBeLessThan(sequential - 100);
  });

  it("отказ одного слота не теряет остальные три (Promise.allSettled, не Promise.all)", async () => {
    const req = baseReq();
    const good = await mockLessonBundle(req);

    const bundle = await buildLessonBundle(
      req,
      {
        "lesson-plan": async () => good.lessonPlan!,
        presentation: async () => {
          throw new Error("бэк вернул 500");
        },
        worksheet: async () => good.worksheet!,
        test: async () => good.test!,
      },
      10_000
    );

    expect(bundle.lessonPlan).not.toBeNull();
    expect(bundle.worksheet).not.toBeNull();
    expect(bundle.test).not.toBeNull();
    // Упавший слот остаётся пустым — и это ЕДИНСТВЕНный признак отказа.
    expect(bundle.presentation).toBeNull();

    expect(bundle.failed).toHaveLength(1);
    expect(bundle.failed[0].slot).toBe("presentation");
    expect(bundle.failed[0].reason).toContain("500");
  });

  it("таймаут пакета: слот без ответа уходит в failed с упоминанием времени", async () => {
    const req = baseReq();
    const good = await mockLessonBundle(req);

    const bundle = await buildLessonBundle(
      req,
      {
        "lesson-plan": async () => good.lessonPlan!,
        presentation: async () => {
          // Ответит уже после истечения таймаута — его результат не придёт.
          await delay(500);
          return good.presentation!;
        },
        worksheet: async () => good.worksheet!,
        test: async () => good.test!,
      },
      30
    );

    expect(bundle.lessonPlan).not.toBeNull();
    expect(bundle.worksheet).not.toBeNull();
    expect(bundle.test).not.toBeNull();
    expect(bundle.presentation).toBeNull();
    expect(bundle.failed).toEqual([
      { slot: "presentation", reason: expect.stringContaining("время ожидания") },
    ]);
  });
});

describe("generateBundleZip — экспорт комплекта", () => {
  it("полный комплект → 4 файла с ASCII-именами", async () => {
    const bundle = await mockLessonBundle(baseReq());
    const names = await zipNames(bundle);

    expect(names.sort()).toEqual([
      "01-plan.docx",
      "02-presentation.pptx",
      "03-worksheet.docx",
      "04-test.docx",
    ]);
    // Имена ASCII: кириллица в ZIP ломает часть распаковщиков.
    for (const n of names) {
      expect(n).toMatch(/^[\x20-\x7e]+$/);
    }
  });

  it("частичный комплект → 3 файла, упавшего слота в архиве нет", async () => {
    const req = baseReq();
    const good = await mockLessonBundle(req);

    const bundle = await buildLessonBundle(
      req,
      {
        "lesson-plan": async () => good.lessonPlan!,
        presentation: async () => {
          throw new Error("таймаут");
        },
        worksheet: async () => good.worksheet!,
        test: async () => good.test!,
      },
      10_000
    );

    const names = await zipNames(bundle);
    expect(names.sort()).toEqual(["01-plan.docx", "03-worksheet.docx", "04-test.docx"]);
  });

  it("имя архива — ASCII-slug", async () => {
    const bundle = await mockLessonBundle(baseReq());
    const filename = bundleZipFilename(bundle);

    expect(filename).toMatch(/^lesson-[a-z0-9-]+\.zip$/);
    expect(filename).toBe("lesson-math-5kl-drobi-obyknovennye.zip");
  });
});
