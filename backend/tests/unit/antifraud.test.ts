/**
 * Антифрод: отпечаток, сигналы, решение.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ГЛАВНОЕ, ЧТО ТЕСТ ЗАЩИЩАЕТ
 * ─────────────────────────────────────────────────────────────────────────────
 * Подозрение НЕ равно блокировке. Если кто-то однажды решит, что «при
 * 3 аккаунтах с одного IP надо отрубить» — отрубится реальный учитель,
 * который зашёл с телефона и с рабочего ноутбука. Тариф «Школа» вообще
 * предполагает, что за одним IP сидит весь класс.
 *
 * Поэтому здесь нет ни одного теста на «должен заблокировать», и есть явная
 * проверка, что функция решения вообще не умеет возвращать отказ.
 *
 * Второе: отпечаток обязан быть ДЕТЕРМИНИРОВАННЫМ. Недетерминированный
 * отпечаток означает, что сигналы накапливаются в пустоту, фрод не ловится,
 * а таблица отпечатков растёт впустую.
 */

import { describe, it, expect } from "vitest";
import {
  decideFraud,
  fingerprintHash,
  EMPTY_SIGNALS,
  TRUST_WINDOW_SECONDS,
  SIGNAL_MULTI_ACCOUNT,
  SIGNAL_MULTI_ASN,
  SIGNAL_BURST_PER_HOUR,
  type FraudSignals,
  type CfObject,
} from "../../src/lib/antifraud";
import { sha256Hex } from "../../src/lib/hash";

const SALT = "test-salt";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
const CF: CfObject = {
  country: "RU",
  colo: "KZN",
  deviceType: "desktop",
  browser: "Chrome",
  os: "macOS",
  asn: 12345,
  botManagement: { verified: true },
};

describe("отпечаток", () => {
  it("детерминирован: те же входные дают тот же хэш", async () => {
    const input = { ip: "203.0.113.5", userAgent: UA, cf: CF };
    const a = await fingerprintHash(input, SALT);
    const b = await fingerprintHash(input, SALT);
    expect(a).toBe(b);
    expect(a).toHaveLength(64); // sha256 hex
  });

  it("разный IP даёт разный отпечаток", async () => {
    const a = await fingerprintHash({ ip: "203.0.113.5", userAgent: UA, cf: CF }, SALT);
    const b = await fingerprintHash({ ip: "203.0.113.6", userAgent: UA, cf: CF }, SALT);
    expect(a).not.toBe(b);
  });

  it("разный User-Agent даёт разный отпечаток", async () => {
    const a = await fingerprintHash({ ip: "203.0.113.5", userAgent: UA, cf: CF }, SALT);
    const b = await fingerprintHash(
      { ip: "203.0.113.5", userAgent: "curl/8.4.0", cf: CF },
      SALT,
    );
    expect(a).not.toBe(b);
  });

  it("разный ASN даёт разный отпечаток (смена оператора = другой человек)", async () => {
    const a = await fingerprintHash(
      { ip: "203.0.113.5", userAgent: UA, cf: { ...CF, asn: 1 } },
      SALT,
    );
    const b = await fingerprintHash(
      { ip: "203.0.113.5", userAgent: UA, cf: { ...CF, asn: 2 } },
      SALT,
    );
    expect(a).not.toBe(b);
  });

  it("БЕЗ соли хэш одинаковый — и это ловушка, поэтому соль обязательна", async () => {
    const withSalt = await fingerprintHash({ ip: "1.2.3.4", userAgent: UA, cf: CF }, SALT);
    const withOtherSalt = await fingerprintHash(
      { ip: "1.2.3.4", userAgent: UA, cf: CF },
      "other-salt",
    );
    expect(withSalt).not.toBe(withOtherSalt);
  });

  it("работает без request.cf (локальная разработка)", async () => {
    const h = await fingerprintHash({ ip: "127.0.0.1", userAgent: UA }, SALT);
    expect(h).toHaveLength(64);
  });

  it("пустые поля не роняют: отсутствие UA — это тоже признак", async () => {
    const h = await fingerprintHash({ ip: "", userAgent: "" }, SALT);
    expect(h).toHaveLength(64);
  });
});

describe("решение по сигналам", () => {
  const signals = (over: Partial<FraudSignals> = {}): FraudSignals => ({
    ...EMPTY_SIGNALS,
    ...over,
  });

  it("чистый посетитель проходит без вопросов", () => {
    const v = decideFraud(signals(), { cf: CF });
    expect(v.decision).toBe("ok");
    expect(v.reason).toBe("no_signals");
  });

  it("2+ аккаунта с отпечатка → капча", () => {
    const v = decideFraud(signals({ accounts: SIGNAL_MULTI_ACCOUNT }), { cf: CF });
    expect(v.decision).toBe("challenge");
    expect(v.reason).toBe("multi_account");
  });

  it("3+ разных ASN с одного IP → капча", () => {
    const v = decideFraud(signals({ asns: SIGNAL_MULTI_ASN }), { cf: CF });
    expect(v.decision).toBe("challenge");
    expect(v.reason).toBe("multi_asn");
  });

  it("всплеск 10+ генераций в час → капча", () => {
    const v = decideFraud(signals(), { cf: CF, burstGenerationsInHour: SIGNAL_BURST_PER_HOUR });
    expect(v.decision).toBe("challenge");
    expect(v.reason).toBe("burst");
  });

  it("один всплеск ниже порога — не повод тревожить", () => {
    const v = decideFraud(signals(), { cf: CF, burstGenerationsInHour: SIGNAL_BURST_PER_HOUR - 1 });
    expect(v.decision).toBe("ok");
  });

  it("одна аккаунтная сессия (1 аккаунт) — норма для живого человека", () => {
    const v = decideFraud(signals({ accounts: 1, asns: 1 }), { cf: CF });
    expect(v.decision).toBe("ok");
  });

  it("недавно прошёл капчу — не мучаем повторно даже при сигналах", () => {
    const now = 1_700_000_000;
    const v = decideFraud(signals({ accounts: 9, asns: 9, lastPassedAt: now }), {
      cf: CF,
      now,
    });
    expect(v.decision).toBe("ok");
    expect(v.reason).toBe("recently_passed_challenge");
  });

  it("прошло больше окна доверия — сигналы снова считаются", () => {
    const now = 1_700_000_000;
    const v = decideFraud(
      signals({ accounts: 9, lastPassedAt: now - TRUST_WINDOW_SECONDS - 10 }),
      { cf: CF, now },
    );
    expect(v.decision).toBe("challenge");
  });

  it("непроверенный бот без данных CF → капча с первого раза", () => {
    // Ни browser, ни deviceType от Cloudflare нет + ботManagement говорит,
    // что это бот. Это подделка, а не живой человек.
    const v = decideFraud(signals(), {
      cf: { botManagement: { verified: false } },
    });
    expect(v.decision).toBe("challenge");
    expect(v.reason).toBe("bot_unverified");
  });

  it("РЕШЕНИЕ НИКОГДА НЕ БЛОКИРУЕТ — только ok или challenge", () => {
    // Финальная страховка от регрессии: в системе нет и не должно быть
    // ветки «заблокировать».
    const allBad = signals({
      accounts: 999,
      asns: 999,
      generations: 9999,
      challenges: 9999,
    });
    const v = decideFraud(allBad, {
      cf: { botManagement: { verified: false } },
      burstGenerationsInHour: 10_000,
    });
    expect(v.decision).toBe("challenge");
    expect(["ok", "challenge"]).toContain(v.decision);
  });
});

describe("sha256-обвязка", () => {
  it("даёт стабильный hex фиксированной длины", async () => {
    const h = await sha256Hex("проверка");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("разные строки — разные хэши", async () => {
    expect(await sha256Hex("a")).not.toBe(await sha256Hex("b"));
  });
});
