import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Порог уверенности распознавания должен быть ОДИН и тот же на бэке и на фронте.
 *
 * Почему это отдельный тест, а не «просто проверка константы»: константы живут
 * в двух проектах, которые собираются раздельно (`backend/` и `src/`), и ни один
 * компилятор их не сверяет. Расхождение нашлось 2026-10-03 при разборе
 * docs/tz/18-money-and-trust.md: бэк считал уверенным от 0.6, фронт — от 0.85.
 *
 * Последствия расхождения не косметические: бэк называл «Верно» ответ,
 * прочитанный с уверенностью 0.7, начислял балл и включал его в итоговый
 * процент, а интерфейс прятал такую строку в блок «Проверьте сами» и итоговую
 * отметку не показывал. Учитель видел в базе одно, на экране — другое.
 *
 * Файл читается с диска, потому что только фронтовые тесты видят репозиторий:
 * бэк-тесты идут в workerd, где fs недоступен (та же причина, по которой
 * tests/integration/plans-price-sources.test.ts сверяет цены файлами).
 */

const ROOT = join(__dirname, "..", "..");

function extractThreshold(file: string, exportName: string): number {
  const src = readFileSync(join(ROOT, file), "utf8");
  const m = src.match(
    new RegExp(`export const ${exportName} = ([0-9]*\\.?[0-9]+);`)
  );
  if (!m) throw new Error(`Не нашёл ${exportName} в ${file}`);
  return Number(m[1]);
}

describe("порог уверенности: бэк и фронт", () => {
  const back = extractThreshold(
    "backend/src/services/photoCheckGrading.ts",
    "CONFIDENCE_THRESHOLD"
  );
  const front = extractThreshold(
    "src/lib/photo-check/confidence.ts",
    "CONFIDENCE_THRESHOLD"
  );

  it("значения совпадают", () => {
    expect(front).toBe(back);
  });

  it("порог равен решению владельца от 2026-10-03 (0.85)", () => {
    expect(back).toBe(0.85);
  });
});
