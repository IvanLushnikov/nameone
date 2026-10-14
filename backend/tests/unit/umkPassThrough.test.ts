/**
 * Выбор учебника доходит до документов (лист 2.1.7, приёмка родителем).
 *
 * ЧТО ЭТО ЛОВИТ. Промпты всех шести типов читали `meta.umk`, но путь до них
 * шёл через zod-схему роута, а `z.object()` по умолчанию ВЫБРАСЫВАЕТ неизвестные
 * ключи. То есть промпт был готов, а значение до него не доходило: учитель
 * ставил галочку и получал документ без учебника. Тест ловит именно это —
 * не «блок написан», а «значение дошло».
 *
 * Запуск: npx vitest run tests/unit/umkPassThrough.test.ts
 */

import { describe, it, expect } from "vitest";
import { ArtifactRequestObject, ArtifactEnvelope } from "../../src/routes/artifact-generate";

const base = {
  subject: "math",
  grade: 8,
  topic: "Рациональные дроби",
  difficulty: "easy" as const,
  count: 6,
  withAnswers: true,
  withExplanations: true,
};

describe("УМК доходит до документов", () => {
  it("схема роута сохраняет meta.umk, а не выбрасывает его", () => {
    const parsed = ArtifactRequestObject.parse({ ...base, meta: { umk: "merzlyak-alg" } });
    expect(parsed.meta?.umk).toBe("merzlyak-alg");
  });

  it("без meta всё работает как раньше — учебник не обязателен", () => {
    const parsed = ArtifactRequestObject.parse({ ...base });
    expect(parsed.meta).toBeUndefined();
  });

  it("мусорный идентификатор не ломает разбор запроса", () => {
    for (const umk of ["", "   ", "не учебник"]) {
      const parsed = ArtifactRequestObject.parse({ ...base, meta: { umk } });
      // Значение может быть любым: нормализуется оно ниже по цепочке, в блоке
      // промпта. Важно, что запрос не упал.
      expect(parsed).toBeTruthy();
    }
  });

  it("длинный идентификатор отвергается: в промпт не должна уехать простыня", () => {
    expect(() => ArtifactRequestObject.parse({ ...base, meta: { umk: "x".repeat(200) } })).toThrow();
  });

  it("конверт документа принимает meta.umk", () => {
    const parsed = ArtifactEnvelope.parse({
      request: { ...base, meta: { umk: "vilenkin" } },
    });
    expect((parsed.request as { meta?: { umk?: string } }).meta?.umk).toBe("vilenkin");
  });

  it("umk допускает null — фронт шлёт его для «учебник не выбран»", () => {
    const parsed = ArtifactRequestObject.parse({ ...base, meta: { umk: null } });
    expect(parsed.meta?.umk).toBeNull();
  });
});