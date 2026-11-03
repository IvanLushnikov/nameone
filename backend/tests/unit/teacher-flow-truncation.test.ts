/**
 * teacher-flow п.1: GENERATION_TRUNCATED = 422, не Internal 500.
 */
import { describe, it, expect } from "vitest";
import { GenerationTruncatedError } from "../../src/lib/errors";

describe("teacher-flow · GENERATION_TRUNCATED", () => {
  it("отдаёт HTTP 422 и код GENERATION_TRUNCATED", () => {
    const err = new GenerationTruncatedError();
    expect(err.status).toBe(422);
    expect(err.code).toBe("GENERATION_TRUNCATED");
    expect(err.message).toMatch(/не собран/i);
  });
});
