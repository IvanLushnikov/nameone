#!/usr/bin/env node
/**
 * Аварийное отключение кода подтверждения администратора (ТЗ-24 §8.1).
 *
 * ЗАЧЕМ ЭТО НУЖНО, КОГДА «НЕ НУЖНО»
 * ---------------------------------
 * Код подтверждения — это единственный слой поверх пароля на экране с
 * выручкой и себестоимостью. Если потерян телефон И резервные коды, владелец
 * продукта не может войти в единственный раздел, где видны деньги. Без этой
 * команды система осталась бы в состоянии «доступ потерян навсегда», и
 * единственным выходом стало бы разворачивание базы руками.
 *
 * ПОЧЕМУ ЭТО СКРИПТ, А НЕ КНОПКА В СУПЕРАДМИНКЕ
 * ---------------------------------------------
 * Войти в суперадминку без кода нельзя — в этом весь смысл. Кнопка «отключить
 * код», доступная тому, кто не смог войти, была бы дырой. А из консоли
 * разработчика попасть может только владелец проекта.
 *
 * КАК ЗАПУСТИТЬ
 * -------------
 *   cd backend
 *   node ../scripts/admin-totp-recovery.mjs --email ilushnikov98@icloud.com \
 *        --reason "потерян телефон"
 *
 * Скрипт ПЕЧАТАЕТ, что сделал, и пишет событие в `admin_totp_recovery` —
 * после него в системе живёт администратор без второго фактора, и это должно
 * быть видно в истории, а не остаться тайной.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = join(__dirname, "..", "backend");

/** Разбор аргументов вида `--email x --reason "y"`. */
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key?.startsWith("--")) continue;
    args[key.slice(2)] = argv[i + 1];
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (!args.email) {
  console.error(
    "Укажите почту администратора:\n" +
      "  node scripts/admin-totp-recovery.mjs --email <почта> --reason \"причина\"",
  );
  process.exit(1);
}

/** Схема нужна только здесь: команда работает напрямую с боевой D1. */
function tableExists(sql, name) {
  return sql.includes(`CREATE TABLE IF NOT EXISTS ${name}`);
}

async function main() {
  const schema = readFileSync(join(BACKEND_DIR, "src", "db", "schema.sql"), "utf8");

  // Импортируем логику из бэкенда, а не дублируем её: правила «код выключен»
  // и «событие в журнале» должны быть одни и те же, что и у бота.
  const { emergencyDisableTotp, isTotpEnabled } = await import(
    join(BACKEND_DIR, "src", "services", "admin-totp.ts")
  );

  if (!tableExists(schema, "admin_totp")) {
    console.error("В схеме нет таблицы admin_totp — миграция не применена.");
    process.exit(1);
  }

  // Подключение к D1: wrangler уже настроен на этот проект, поэтому берём
  // привязки из его конфигурации, а не просим дублировать ID базы.
  const { getPlatformProxy } = await import("wrangler");
  const proxy = await getPlatformProxy({ configPath: join(BACKEND_DIR, "wrangler.toml") });
  const db = proxy.env.DB;

  try {
    const user = await db
      .prepare(`SELECT id, is_admin FROM users WHERE email = ?1`)
      .bind(args.email)
      .first();

    if (!user) {
      console.error(`Пользователь с почтой ${args.email} не найден.`);
      process.exit(1);
    }
    if (user.is_admin !== 1) {
      console.error(`${args.email} не администратор. Код подтверждения у него не включался.`);
      process.exit(1);
    }

    const wasEnabled = await isTotpEnabled(db, user.id);

    await emergencyDisableTotp(db, user.id, args.reason ?? "не указана");

    console.log("Готово.");
    console.log(`  Администратор: ${args.email}`);
    console.log(`  Код подтверждения был включён: ${wasEnabled ? "да" : "нет"}`);
    console.log("  Резервные коды удалены вместе с кодом подтверждения.");
    console.log("  Событие записано в таблицу admin_totp_recovery.");
    console.log("");
    console.log("Теперь в суперадминку вход только по паролю.");
    if (wasEnabled) {
      console.log("Верните код подтверждения после восстановления доступа.");
    }
  } finally {
    await proxy.dispose();
  }
}

main().catch((error) => {
  console.error("Не получилось:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});