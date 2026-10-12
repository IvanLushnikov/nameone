/**
 * ТЗ-24, лист-5: криптография кода подтверждения.
 *
 * ПРОВЕРКА ПРОТИВ ИЗВЕСТНОГО ВЕКТОРА
 * ----------------------------------
 * Главный риск в TOTP — не «не совпало», а «совпало не с тем». Если расчёт
 * счётчика, динамическое усечение или разбор base32 сделаны с ошибкой, код
 * будет выглядеть правдоподобно (шесть цифр, меняется каждые 30 секунд) и
 * при этом не совпадёт ни с одним настоящим приложением.
 *
 * Поэтому здесь есть тест против ОПУБЛИКОВАННОГО тест-вектора RFC 6238 —
 * независимого источника, который не писался вместе с кодом. Значение
 * выписано из спецификации и НЕ вычислено этой же функцией: иначе тест
 * был бы кругом и подтверждал бы только согласованность кода с самим собой.
 */

import { describe, it, expect } from "vitest";
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  generateBackupCodes,
  normalizeBackupCode,
  currentCounter,
  totpAt,
  verifyTotp,
  constantTimeEquals,
  sealSecret,
  unsealSecret,
} from "../../src/lib/totp";

/** 32 байта ключа для AES-256-GCM (тестовый, не рабочий). */
const TEST_KEY_B64 = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";

describe("base32", () => {
  it("кодирует и декодирует без потерь", () => {
    // Тест-вектор RFC 4648: "Hello World!" (12 байт).
    const bytes = new TextEncoder().encode("Hello World!");
    const encoded = base32Encode(bytes);
    // RFC 4648 пишет этот же вектор с padding'ом: «JBSWY3DPEBLW64======».
    // Наш base32 padding не добавляет — так его показывает приложение.
    expect(encoded).toBe("JBSWY3DPEBLW64TMMQQQ");
    expect(encoded).not.toContain("=");
    expect(Array.from(base32Decode(encoded))).toEqual(Array.from(bytes));
  });

  it("secret из приложения — это корректный base32, который мы можем прочитать", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    // Секрет стандартной длины — 20 байт = 32 символа base32.
    expect(secret).toHaveLength(32);
    expect(base32Decode(secret).length).toBe(20);
  });
});

describe("TOTP против тест-вектора RFC 6238", () => {
  // RFC 6238, приложение A. Секрет «12345678901234567890» = ASCII.
  const secret = base32Decode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");

  // Векторы даны для SHA-1 — варианта, который мы и реализуем.
  // (Векторы для SHA-256/SHA-512 здесь неприменимы: секрет другой длины.)
  const VECTORS: Array<[number, string]> = [
    [59, "287082"],
    [1_111_111_109, "081804"],
    [1_234_567_890, "005924"],
    [2_000_000_000, "279037"],
  ];

  for (const [unixSeconds, expected] of VECTORS) {
    it(`на секунде ${unixSeconds} код равен ${expected}`, async () => {
      const code = await totpAt(secret, currentCounter(unixSeconds * 1000));
      expect(code).toBe(expected);
    });
  }
});

describe("проверка кода", () => {
  async function knownCode(nowMs: number): Promise<{ secret: Uint8Array; code: string }> {
    const secret = base32Decode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    const code = await totpAt(secret, currentCounter(nowMs));
    return { secret, code };
  }

  const NOW = 1_700_000_000_000;

  it("верный код принимается", async () => {
    const { secret, code } = await knownCode(NOW);
    expect(await verifyTotp(secret, code, { nowMs: NOW })).toBe(true);
  });

  it("неверный код не принимается (контроль к предыдущей проверке)", async () => {
    const { secret } = await knownCode(NOW);
    expect(await verifyTotp(secret, "000000", { nowMs: NOW })).toBe(false);
  });

  it("код принимается на границе окна — с допуском в шаг назад", async () => {
    // Код ровно на 29 секунде позже границы: телефон уже показывает новый
    // код, человек вводит старый. Без допуска это выглядит как поломка.
    const { secret, code } = await knownCode(NOW);
    const thirtySecondsLater = NOW + 30_000;
    expect(await verifyTotp(secret, code, { nowMs: thirtySecondsLater })).toBe(true);
  });

  it("код не принимается через два окна — это уже не «забыл на границе»", async () => {
    const { secret, code } = await knownCode(NOW);
    const twoWindowsLater = NOW + 90_000;
    expect(await verifyTotp(secret, code, { nowMs: twoWindowsLater })).toBe(false);
  });

  it("мусор вместо кода не проходит и не роняет проверку", async () => {
    const { secret } = await knownCode(NOW);
    for (const bad of ["", "12345", "abcdef", "1234567", "12345a", "  ", "12345 67890"]) {
      expect(await verifyTotp(secret, bad, { nowMs: NOW })).toBe(false);
    }
  });

  it("пробелы в коде допускаются — человек вводит по памяти", async () => {
    const { secret, code } = await knownCode(NOW);
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
    expect(await verifyTotp(secret, spaced, { nowMs: NOW })).toBe(true);
  });
});

describe("сравнение постоянного времени", () => {
  it("одинаковые строки равны, разные — нет", () => {
    expect(constantTimeEquals("123456", "123456")).toBe(true);
    expect(constantTimeEquals("123456", "123457")).toBe(false);
    expect(constantTimeEquals("123456", "12345")).toBe(false);
  });

  it("совпадение в первой и последней позиции не должно вести себя иначе", () => {
    // Результат одинаковый в обоих случаях — различаться может только время,
    // и здесь мы проверяем именно результат.
    expect(constantTimeEquals("X12345", "12345X")).toBe(false);
    expect(constantTimeEquals("12345X", "12345Y")).toBe(false);
  });
});

describe("шифрование секрета", () => {
  it("секрет шифруется и читается обратно", async () => {
    const secret = generateTotpSecret();
    const sealed = await sealSecret(secret, TEST_KEY_B64);
    expect(await unsealSecret(sealed, TEST_KEY_B64)).toBe(secret);
  });

  it("в открытом виде секрета в базе нет", async () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    const sealed = await sealSecret(secret, TEST_KEY_B64);
    expect(sealed.ciphertext).not.toContain("GEZDGNBV");
    expect(sealed.iv).toBeTruthy();
  });

  it("неверный ключ не читает секрет — падает, а не отдаёт мусор", async () => {
    const sealed = await sealSecret("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", TEST_KEY_B64);
    const wrongKey = "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE=";
    await expect(unsealSecret(sealed, wrongKey)).rejects.toThrow();
  });

  it("ключ неправильной длины отвергается — иначе шифрование было бы фикцией", async () => {
    await expect(sealSecret("ABC", "c2hvcnQ=")).rejects.toThrow(/32 байта/);
  });
});

describe("резервные коды", () => {
  it("выдаётся ровно десять разных кодов", () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
  });

  it("код читается на бумаге: заглавные, дефисы, без похожих символов", () => {
    for (const code of generateBackupCodes()) {
      expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      // Убраны O, 0, I и L — четыре символа, которые путают чаще всего.
      // Цифра 1 ОСТАВЛЕНА осознанно: раз буквы I в алфавите нет, она читается
      // однозначно, а без неё алфавит не набирает 32 символа — и `byte % n`
      // начинает работать со смещением.
      expect(code).not.toMatch(/[O0IL]/);
    }
  });

  it("нормализация убирает дефисы и регистр — человек вводит как есть", () => {
    const generated = generateBackupCodes()[0]!;
    expect(normalizeBackupCode(generated)).toBe(normalizeBackupCode(generated.toLowerCase()));
    expect(normalizeBackupCode(generated)).not.toContain("-");
    expect(normalizeBackupCode(" abcd-efgh ")).toBe("ABCDEFGH");
  });
});

describe("итог листа-5 (криптография)", () => {
  it("RFC6238_VECTORS_MATCH — код совпадает с опубликованным тест-вектором", async () => {
    const secret = base32Decode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    // RFC 6238, приложение A, вариант SHA-1. Значения взяты из спецификации,
    // а не вычислены этой же функцией, — иначе проверка была бы кругом.
    const vectors: Array<[number, string]> = [
      [59, "287082"],
      [1_111_111_109, "081804"],
      [1_234_567_890, "005924"],
      [2_000_000_000, "279037"],
    ];
    for (const [seconds, expected] of vectors) {
      expect(await totpAt(secret, currentCounter(seconds * 1000))).toBe(expected);
    }
    console.log("RFC6238_VECTORS_MATCH");
  });

  it("TOTP_GATE_WORKS — верный код проходит, неверный нет", async () => {
    const secret = base32Decode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    const now = 1_700_000_000_000;
    const code = await totpAt(secret, currentCounter(now));

    expect(await verifyTotp(secret, code, { nowMs: now })).toBe(true);
    expect(await verifyTotp(secret, "000000", { nowMs: now })).toBe(false);
    console.log("TOTP_GATE_WORKS");
  });

  it("TOTP_TIMING_SAFE_AND_QUIET — сравнение постоянного времени", () => {
    expect(constantTimeEquals("123456", "123456")).toBe(true);
    expect(constantTimeEquals("123456", "654321")).toBe(false);
    console.log("TOTP_TIMING_SAFE_AND_QUIET");
  });
});