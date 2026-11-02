/**
 * Соль отпечатка посетителя — находка №2 ревью безопасности от 30.10.2026.
 *
 * Что было сломано: в восьми местах соль бралась как
 * `env.FINGERPRINT_SALT ?? "dev-fingerprint-salt"`. Секрет FINGERPRINT_SALT
 * на боевом воркере задан не был, поэтому в проде молча считался хэш с
 * публичной константой из исходников. Такой хэш перебирается за секунды
 * (пространство IPv4 восстанавливается перебором), и таблица отпечатков
 * фактически становилась справочником по IP — при том, что схема обещает
 * обратное («сырые IP, ASN и User-Agent в таблицу не попадают»).
 *
 * Тест проверяет три вещи:
 *   1. в production без соли — отказ, а не молчаливая подстановка;
 *   2. локальная разработка и тесты продолжают работать;
 *   3. публичной соли из прошлой версии в исходниках больше нет.
 */

import { describe, it, expect } from "vitest";
import { fingerprintHash, fingerprintSalt } from "../../src/lib/antifraud";
import { ServiceMisconfiguredError } from "../../src/lib/errors";

// Исходники целевых файлов — как текст. Проверять «нет ли публичной соли»
// надо по коду, а не на глаз: такая строка легко возвращается вместе с
// новым роутом, и тогда находка снова становится боевой.
import antifraudSrc from "../../src/lib/antifraud.ts?raw";
import llmSrc from "../../src/routes/llm.ts?raw";
import usersSrc from "../../src/routes/users.ts?raw";
import worksheetsSrc from "../../src/routes/worksheets.ts?raw";
import examsSrc from "../../src/routes/exams.ts?raw";
import f06Src from "../../src/routes/f06.ts?raw";
import artifactGenerateSrc from "../../src/routes/artifact-generate.ts?raw";
import turnstileSrc from "../../src/routes/turnstile.ts?raw";

/** Публичная соль из прошлой версии — в исходниках её быть не должно. */
const PUBLIC_SALT = "dev-fingerprint-salt";

describe("соль отпечатка посетителя", () => {
  it("в production без соли — отказ, а не молчаливая подстановка", () => {
    expect(() => fingerprintSalt({ APP_ENV: "production" })).toThrow(ServiceMisconfiguredError);
    // Пустая строка — тоже «соли нет»: trim() должен это поймать.
    expect(() => fingerprintSalt({ APP_ENV: "production", FINGERPRINT_SALT: "   " })).toThrow(
      ServiceMisconfiguredError,
    );
  });

  it("в production используется именно заданная соль", () => {
    expect(fingerprintSalt({ APP_ENV: "production", FINGERPRINT_SALT: "prod-salt-32-chars" })).toBe(
      "prod-salt-32-chars",
    );
  });

  it("вне production подставляется локальная заглушка и ничего не ломает", () => {
    // Локальная разработка и тесты: соли нет, но падать нельзя — иначе не
    // проверить было бы ничего.
    expect(fingerprintSalt({ APP_ENV: "development" })).toBeTruthy();
    expect(fingerprintSalt({})).toBeTruthy();
  });

  it("смена соли меняет отпечаток — старые хэши не подходят", async () => {
    const input = { ip: "203.0.113.7", userAgent: "Mozilla/5.0" };
    const before = await fingerprintHash(input, PUBLIC_SALT);
    const after = await fingerprintHash(input, "new-prod-salt");

    expect(after).not.toBe(before);
  });

  it("в исходниках нет публичной соли из прошлой версии", () => {
    const sources: Array<[string, string]> = [
      ["lib/antifraud.ts", antifraudSrc],
      ["routes/llm.ts", llmSrc],
      ["routes/users.ts", usersSrc],
      ["routes/worksheets.ts", worksheetsSrc],
      ["routes/exams.ts", examsSrc],
      ["routes/f06.ts", f06Src],
      ["routes/artifact-generate.ts", artifactGenerateSrc],
      ["routes/turnstile.ts", turnstileSrc],
    ];

    const offenders = sources
      .filter(([, content]) => content.includes(PUBLIC_SALT))
      .map(([name]) => name);

    expect(offenders).toEqual([]);
  });
});
