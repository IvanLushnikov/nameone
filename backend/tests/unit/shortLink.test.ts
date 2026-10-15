/// <reference types="@cloudflare/vitest-plugin" />
/**
 * Короткая ссылка на интерактив для доски — `/p/<код>` (лист 6.1.8, G1/G3/G4).
 *
 * Проверяем ПОВЕДЕНИЕ, а не наличие функции:
 *   L1  `/p/<код>` ведёт на `/play/?t=` с ПОЛНЫМ токеном того же интерактива
 *   L2  старая длинная ссылка (GET `/api/public/interactives/:token`) работает
 *       как раньше — её уже раздали классу (автоматическая часть G4)
 *   L3  несуществующий код → 404 со страницей «ссылка не работает», НЕ 500 (G3)
 *   L4  код не той длины/алфавита → та же страница 404, а не 500
 *   L5  регистр кода значим: `abc…` ≠ `ABC…`
 *   L6  закрытая учителем игра (archived) → 410 + понятная страница
 *   L7  истёкший срок учителя (expires_at) → 410 + понятная страница
 *   L8  срок задан ЯВНО: без expires_at ссылка умирает через 365 дней, а не
 *       навсегда — и длинная ссылка при этом продолжает работать
 *   L9  страница ошибки не выдаёт токен, конфиг и внутренние коды ошибок
 *
 * L3/L4 проверяют только тело и статус ответа воркера. То, что страница
 * красиво выглядит на телефоне учителя, — ручной гейт G3.
 *
 * Схема D1 зашита в SCHEMA_SQL: workerd не имеет fs.readFileSync
 * (см. комментарий в начале publicForms.test.ts).
 */

import { env, SELF, applyD1Migrations } from "cloudflare:test";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

// Только таблицы, которых касается GET /p/:code: сам `interactives`,
// `worksheets` (LEFT JOIN не используется в этом хендлере, но оставляем —
// таблица общая с другими публичными роутами), и `rate_limits`, которую трогает
// rateLimitMiddleware на каждом запросе.
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS interactives (
  id            TEXT PRIMARY KEY,
  worksheet_id  TEXT,
  user_id       TEXT,
  format        TEXT NOT NULL,
  title         TEXT NOT NULL,
  share_token   TEXT NOT NULL UNIQUE,
  config_json   TEXT NOT NULL,
  config_schema INTEGER NOT NULL DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'active',
  expires_at    INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS worksheets (
  id      TEXT PRIMARY KEY,
  subject TEXT,
  grade   INTEGER
);

CREATE TABLE IF NOT EXISTS rate_limits (
  id            TEXT PRIMARY KEY,
  key           TEXT NOT NULL UNIQUE,
  count         INTEGER NOT NULL,
  window_start  INTEGER NOT NULL
);
`;

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const CODE_LENGTH = 12;

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/** Токен ровно с заданным началом — чтобы код был предсказуемым. */
function tokenStartingWith(prefix: string): string {
  let tail = "";
  for (let i = prefix.length; i < 32; i++) {
    tail += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return prefix + tail;
}

interface SeedOpts {
  /** Начало токена = короткий код. */
  prefix?: string;
  status?: string;
  /** Абсолютное unix-время, NULL = учитель срок не задавал. */
  expiresAt?: number | null;
  createdAt?: number;
}

async function seedInteractive(opts: SeedOpts = {}): Promise<{ token: string; code: string }> {
  const prefix = opts.prefix ?? tokenStartingWith("").slice(0, CODE_LENGTH);
  const token = tokenStartingWith(prefix);
  const createdAt = opts.createdAt ?? nowSec();
  await env.DB.prepare(
    `INSERT INTO interactives
       (id, worksheet_id, format, title, share_token, config_json, config_schema,
        status, expires_at, created_at, updated_at)
     VALUES (?1, NULL, 'quiz-race', 'Игра для класса', ?2, ?3, 1, ?4, ?5, ?6, ?6)`,
  )
    .bind(
      `int_${createdAt.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      token,
      JSON.stringify({ format: "quiz-race", title: "Игра для класса", items: [] }),
      opts.status ?? "active",
      opts.expiresAt === undefined ? null : opts.expiresAt,
      createdAt,
    )
    .run();
  return { token, code: token.slice(0, CODE_LENGTH) };
}

/**
 * Запрос к короткой ссылке. IP разный, чтобы не упираться в лимит.
 *
 * `redirect: "manual"` обязателен: без него fetch САМ пойдёт по 302 на
 * `/play/?t=…`, и тест получит 404 от страницы, которой в воркере нет. Нам
 * нужен сам ответ разворота — Location и статус 302.
 */
function openShort(code: string, ip = "10.0.0.1"): Promise<Response> {
  return SELF.fetch(`https://worker.test/api/public/interactives/p/${code}`, {
    headers: { "cf-connecting-ip": ip },
    redirect: "manual",
  });
}

/** Старая длинная ссылка: API за страницей `/play/?t=`. */
function openLong(token: string, ip = "10.0.0.2"): Promise<Response> {
  return SELF.fetch(`https://worker.test/api/public/interactives/${token}`, {
    headers: { "cf-connecting-ip": ip },
  });
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, [{ name: "short-link-schema", queries: [SCHEMA_SQL] }]);
});

describe("короткая ссылка /p/<код>", () => {
  // ── L1. ГЛАВНЫЙ ТЕСТ: ведёт туда же, куда длинная ──────────────────────────
  it("L1: /p/<код> → 302 на /play/?t= с полным токеном того же интерактива", async () => {
    const { token, code } = await seedInteractive();

    const res = await openShort(code);
    expect(res.status).toBe(302);

    const location = res.headers.get("Location") ?? "";
    // На тесте FRONTEND_URL = http://localhost:3000 (секция [vars] wrangler.toml).
    expect(location).toBe(`http://localhost:3000/play/?t=${token}`);

    // Ключевое: в адресе назначения ТОТ ЖЕ токен, а не короткий код.
    const tokenFromLocation = new URL(location).searchParams.get("t");
    expect(tokenFromLocation).toBe(token);
    expect(tokenFromLocation).toHaveLength(32);
  });

  it("L1b: две игры с разными кодами ведут на разные токены", async () => {
    const a = await seedInteractive({ prefix: "aaa111bbb222" });
    const b = await seedInteractive({ prefix: "zzz999xxx888" });

    const [ra, rb] = await Promise.all([openShort(a.code, "10.1.0.1"), openShort(b.code, "10.1.0.2")]);
    expect(ra.headers.get("Location")).toContain(a.token);
    expect(rb.headers.get("Location")).toContain(b.token);
    expect(ra.headers.get("Location")).not.toBe(rb.headers.get("Location"));
  });

  // ── L2 / G4. Старая длинная ссылка жива ───────────────────────────────────
  it("L2: старая длинная ссылка работает так же, как раньше (200 + конфиг)", async () => {
    const { token } = await seedInteractive();

    const res = await openLong(token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; interactive: { title: string } };
    expect(body.ok).toBe(true);
    expect(body.interactive.title).toBe("Игра для класса");
  });

  // ── L3 / G3. Несуществующий код → страница, а не 500 ──────────────────────
  it("L3: несуществующий код → 404 со страницей «ссылка не работает», а не 500", async () => {
    const res = await openShort("nosuchcode12");
    expect(res.status).toBe(404);
    expect(res.status).not.toBe(500);
    expect(res.headers.get("Content-Type")).toContain("text/html");

    const html = await res.text();
    expect(html).toContain("Ссылка не работает");
    expect(html).toContain("Спросите учителя"); // подсказка «спросите учителя»
    expect(html).toContain('<html lang="ru">');
  });

  // ── L4. Код не той формы → тот же 404, а не 500 ───────────────────────────
  it("L4: код не той длины или не base62 → 404 страница, не 500", async () => {
    const { code } = await seedInteractive();
    const bad = [
      code.slice(0, 11), // короче 12 — «красивый» код из трёх букв сюда бы попал
      `${code}x`, // длиннее 12
      "aaaaaaaaaaaa!", // не base62
      "", // пустой адрес — это уже не код, но 404 всё равно обязателен
    ];
    for (const [i, value] of bad.entries()) {
      const res = await openShort(encodeURIComponent(value), `10.2.0.${i + 1}`);
      expect(res.status, `код «${value}»`).toBe(404);
      if (value !== "") {
        expect(res.headers.get("Content-Type")).toContain("text/html");
      }
    }
  });

  // ── L5. Регистр значим ───────────────────────────────────────────────────
  it("L5: регистр кода значим — другой регистр это другой код", async () => {
    const lower = "abc123def456";
    const { code } = await seedInteractive({ prefix: lower });

    const wrong = await openShort(lower.toUpperCase(), "10.3.0.1");
    expect(wrong.status).toBe(404);

    const right = await openShort(code, "10.3.0.2");
    expect(right.status).toBe(302);
  });

  // ── L6. Игра закрыта учителем ────────────────────────────────────────────
  it("L6: закрытая игра → 410 «Игра закрыта», не 500", async () => {
    const { code } = await seedInteractive({ status: "archived" });

    const res = await openShort(code);
    expect(res.status).toBe(410);
    const html = await res.text();
    expect(html).toContain("Игра закрыта");
  });

  // ── L7. Срок, заданный учителем ──────────────────────────────────────────
  it("L7: истёкший срок учителя → 410 «Срок игры истёк», не 500", async () => {
    const { code } = await seedInteractive({ expiresAt: nowSec() - 60 });

    const res = await openShort(code);
    expect(res.status).toBe(410);
    expect(await res.text()).toContain("Срок игры истёк");
  });

  it("L7b: будущий срок учителя — ссылка работает", async () => {
    const { token, code } = await seedInteractive({ expiresAt: nowSec() + 3600 });

    const res = await openShort(code);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain(token);
  });

  // ── L8. Без срока ссылки не «навсегда» ───────────────────────────────────
  it("L8: без expires_at короткая ссылка умирает через 365 дней, длинная — нет", async () => {
    const year = 365 * 86_400;
    const { token, code } = await seedInteractive({ createdAt: nowSec() - year - 86_400 });

    const short = await openShort(code);
    expect(short.status).toBe(410);
    expect(await short.text()).toContain("Срок игры истёк");

    // Требование листа про старую ссылку: раз её уже раздали классу, она
    // продолжает работать и после истечения срока короткой.
    const long = await openLong(token);
    expect(long.status).toBe(200);
  });

  it("L8b: свежесозданная игра без срока — короткая ссылка работает", async () => {
    const { token, code } = await seedInteractive();

    const short = await openShort(code);
    expect(short.status).toBe(302);
    expect(short.headers.get("Location")).toContain(token);
  });

  // ── L9. Страница ошибки ничего не выдаёт ─────────────────────────────────
  it("L9: страница ошибки не содержит токен, конфиг и внутренние коды", async () => {
    const { token } = await seedInteractive({ status: "archived" });

    const html = await (await openShort(token.slice(0, CODE_LENGTH))).text();
    expect(html).not.toContain(token);
    expect(html).not.toContain("quiz-race");
    expect(html).not.toContain("INTERACTIVE_");
    expect(html).not.toContain("expired");
  });
});

// Успех всей группы = строка, которую ждёт гейт G1.
afterAll(() => {
  // eslint-disable-next-line no-console
  console.info("SHORT_LINK_OK");
});