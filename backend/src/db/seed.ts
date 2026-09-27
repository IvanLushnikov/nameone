/**
 * Seed-скрипт для локальной разработки.
 *
 * Создаёт двух тестовых пользователей (free + plus) и по одному worksheet
 * для плюсового. Запуск: `npm run db:seed`.
 *
 * Безопасно вызывать многократно — данные не дублируются (INSERT OR IGNORE
 * через UNIQUE constraint на email).
 *
 * Использует miniflare D1 через `wrangler d1 execute --local` НЕ обязателен —
 * скрипт сам поднимает Miniflare программно. Но удобнее запускать так:
 *
 *   npm run db:migrate:local && npm run db:seed
 */

import { getPlatformProxy } from "wrangler";
import type { D1Database } from "@cloudflare/workers-types";
import { runMigrations } from "./migrate";
import { createSession } from "./queries";
import { worksheetId, sessionToken, userId } from "../lib/shortid";

interface SeedUser {
  email: string;
  name: string;
  plan: "free" | "plus";
}

const SEED_USERS: SeedUser[] = [
  { email: "test-free@example.com", name: "Тестовый Free", plan: "free" },
  { email: "test-plus@example.com", name: "Тестовый Plus", plan: "plus" },
];

async function main(): Promise<void> {
  // Достаём D1 из локального miniflare (через wrangler platform proxy).
  const proxy = await getPlatformProxy<{ DB: D1Database }>({
    configPath: "./wrangler.toml",
  });

  try {
    const db = proxy.env.DB;

    // 1. Применяем схему (идемпотентно).
    const mig = await runMigrations(db);
    if (!mig.ok) {
      throw new Error(`Migration failed: ${mig.error}`);
    }
    // eslint-disable-next-line no-console
    console.info(`✓ migrations applied (${mig.statements} statements)`);

    // 2. Создаём юзеров (INSERT OR IGNORE для идемпотентности).
    const now = Math.floor(Date.now() / 1000);
    for (const u of SEED_USERS) {
      const id = userId();
      try {
        await db
          .prepare(
            `INSERT OR IGNORE INTO users (id, email, name, plan, generations_total, generations_today, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 0, 0, ?5, ?5)`,
          )
          .bind(id, u.email, u.name, u.plan, now)
          .run();
        // eslint-disable-next-line no-console
        console.info(`✓ user ${u.email} (plan=${u.plan})`);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`! user ${u.email} skipped: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // 3. Создаём тестовый worksheet для plus-юзера.
    const plusUser = await db
      .prepare(`SELECT id FROM users WHERE email = ?1`)
      .bind("test-plus@example.com")
      .first<{ id: string }>();

    if (plusUser) {
      const wsId = worksheetId();
      const sampleWorksheet = {
        title: "Площадь треугольника — 5 класс (демо)",
        subject: "math",
        grade: 5,
        topic: "Площадь треугольника",
        difficulty: "medium",
        type: "worksheet",
        count: 4,
        tasks: [
          { number: 1, text: "Найдите площадь треугольника со стороной 6 см и высотой 4 см.", type: "short-answer", answer: "12 см²", explanation: "S = ½ · a · h", points: 1 },
          { number: 2, text: "Чему равна площадь прямоугольного треугольника с катетами 3 и 4?", type: "short-answer", answer: "6", explanation: "S = ½ · 3 · 4", points: 1 },
        ],
      };
      try {
        await db
          .prepare(
            `INSERT OR IGNORE INTO worksheets (id, user_id, subject, grade, topic, difficulty, type, count, title, payload_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
          )
          .bind(
            wsId,
            plusUser.id,
            sampleWorksheet.subject,
            sampleWorksheet.grade,
            sampleWorksheet.topic,
            sampleWorksheet.difficulty,
            sampleWorksheet.type,
            sampleWorksheet.count,
            sampleWorksheet.title,
            JSON.stringify(sampleWorksheet),
            now,
          )
          .run();
        // eslint-disable-next-line no-console
        console.info(`✓ sample worksheet ${wsId} for ${plusUser.id}`);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`! worksheet skipped: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // 4. Создаём "вечную" dev-сессию для plus-юзера — удобно тестировать /api/users/me.
    if (plusUser) {
      const token = sessionToken();
      await createSession(proxy.env.DB, { token, userId: plusUser.id, ttlSeconds: 60 * 60 * 24 * 365 });
      // eslint-disable-next-line no-console
      console.info(`✓ dev session token: ${token}`);
    }

    // eslint-disable-next-line no-console
    console.info("\nDone. Use the token above as `X-Session-Token: <token>` header in tests.");
  } finally {
    await proxy.dispose();
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("Seed failed:", e);
  process.exit(1);
});
