/**
 * Unit-тесты для short ID генератора.
 */

import { describe, it, expect } from "vitest";
import {
  shortId,
  worksheetId,
  examId,
  userId,
  sessionToken,
  magicLinkToken,
} from "../../src/lib/shortid";

describe("shortId generators", () => {
  it("shortId returns lowercase alphanumeric", () => {
    for (let i = 0; i < 50; i++) {
      const id = shortId();
      expect(id).toMatch(/^[0-9a-z]+$/);
    }
  });

  it("worksheetId has ws_ prefix", () => {
    expect(worksheetId()).toMatch(/^ws_[0-9a-z]+$/);
  });

  it("examId has exam_ prefix", () => {
    expect(examId()).toMatch(/^exam_[0-9a-z]+$/);
  });

  it("userId has usr_ prefix", () => {
    expect(userId()).toMatch(/^usr_[0-9a-z]+$/);
  });

  it("sessionToken is 32 chars, mixed case + digits", () => {
    const t = sessionToken();
    expect(t.length).toBe(32);
    expect(t).toMatch(/^[0-9a-zA-Z]+$/);
  });

  it("magicLinkToken same shape as sessionToken", () => {
    const t = magicLinkToken();
    expect(t.length).toBe(32);
    expect(t).toMatch(/^[0-9a-zA-Z]+$/);
  });

  it("уникальность (1000 calls)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const id = shortId();
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
  });
});
