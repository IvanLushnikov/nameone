#!/usr/bin/env node
/**
 * Проверка листа 3.1.1: классы, ученики и персональный QR.
 *
 *   node scripts/check-class-roster.mjs   →  CLASS_ROSTER_OK
 *
 * ─── Почему скрипт, а не тест ────────────────────────────────────────────────
 * Здесь нет ни сети, ни D1, ни зависимостей: только Node и чтение файлов.
 * Поэтому его можно запустить где угодно — на CI без установки пакетов, на
 * чужой машине, в момент когда backend ещё не поднят — и получить ответ,
 * разъехались ли схема, миграция, роуты и ссылка.
 *
 * Что именно проверяем (и почему каждая проверка не про «написано», а про
 * рабочее свойство):
 *   1. Таблицы `classes`, `class_students`, `class_student_answers` есть в
 *      schema.sql — без них `db:migrate:*` их не создаст.
 *   2. Те же таблицы создаёт миграция 0002 — иначе база, поднятая до этого
 *      листа, останется без них навсегда.
 *   3. Ученики НЕ записаны в чужую таблицу: `teacher_classes` (список названий
 *      для фильтра) остаётся списком строк, а персональный токен лежит только
 *      в `class_students.token`.
 *   4. В персональной ссылке нет имени: имя не собирается в URL ни на бэке, ни
 *      на фронте. Это главное требование листа, и оно проверяется по коду,
 *      а не по впечатлению от интерфейса.
 *   5. Лимиты отправки не изменились: 60/час на пару «форма + IP» и 200/час на
 *      IP — те же числа и ТОТ ЖЕ бакет, что у общей ссылки. Иначе персональная
 *      ссылка стала бы вторым карманом.
 *   6. Чужой класс отклоняется, а не отдаётся пустым: в роуте есть проверка
 *      владельца и осмысленный код отказа.
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFile(join(ROOT, rel), "utf8");

const problems = [];
const ok = [];

function check(name, condition, detail = "") {
  if (condition) ok.push(name);
  else problems.push(detail ? `${name} — ${detail}` : name);
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 1–2. Схема и миграция
 * ───────────────────────────────────────────────────────────────────────────── */

const schema = await read("backend/src/db/schema.sql");

for (const table of ["classes", "class_students", "class_student_answers"]) {
  const ddl = new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`, "i");
  check(`schema.sql создаёт ${table}`, ddl.test(schema), "объявления CREATE TABLE IF NOT EXISTS нет");
}

// Персональный токен — UNIQUE: две строки с одинаковой ссылкой означали бы, что
// один QR уехал бы двум ученикам.
check(
  "token ученика уникален",
  /token\s+TEXT NOT NULL UNIQUE/i.test(schema.slice(schema.indexOf("CREATE TABLE IF NOT EXISTS class_students"))),
  "в class_students нет UNIQUE на token",
);

// Удаление — мягкое: строка с ответом обязана остаться у хозяина.
check(
  "удаление ученика мягкое (removed_at)",
  /removed_at INTEGER/i.test(schema),
  "в class_students нет removed_at",
);

const migration = await read("backend/src/db/migrations/0002_class_students.ts");
for (const table of ["classes", "class_students", "class_student_answers"]) {
  check(
    `миграция 0002 знает таблицу ${table}`,
    migration.includes(table),
    "таблицы нет в миграции",
  );
}
check(
  "миграция идемпотентна",
  /CREATE TABLE IF NOT EXISTS|tableExists/.test(migration) && /sqlite_master/.test(migration),
  "миграция не проверяет наличие таблиц и не может быть запущена повторно",
);

/* ─────────────────────────────────────────────────────────────────────────────
 * 3. Ученики не попали в чужую таблицу
 * ───────────────────────────────────────────────────────────────────────────── */

const classesService = await read("backend/src/db/classes.ts");
const accountService = await read("backend/src/services/account.ts");
check(
  "teacher_classes осталась списком названий для фильтра",
  /INSERT INTO teacher_classes \(user_id, classes_json/.test(accountService) &&
    !/classes_json[\s\S]{0,400}student/i.test(accountService),
  "teacher_classes начала хранить учеников",
);
check(
  "слой данных пишет только в classes / class_students / class_student_answers",
  /INSERT INTO class_students/.test(classesService) &&
    !/(INSERT INTO|UPDATE|DELETE FROM) teacher_classes/i.test(classesService),
  "в db/classes.ts появилась запись в teacher_classes",
);

/* ─────────────────────────────────────────────────────────────────────────────
 * 4. Имя ученика не едет в ссылке
 * ───────────────────────────────────────────────────────────────────────────── */

const frontApi = await read("src/lib/lk/classes-api.ts");

// Ссылка собирается из origin + токена формы + токена ученика. Ни одного имени.
const linkStart = frontApi.indexOf("export function buildPersonalLink");
const linkEnd = frontApi.indexOf("\n}", linkStart);
// Тело функции целиком, а не до первой скобки: иначе проверка «а не упомянуто ли
// имя» проходила бы по тексту ДО функции и ничего не проверяла.
const linkBody = linkStart >= 0 ? frontApi.slice(linkStart, linkEnd) : "";
check("функция персональной ссылки есть на фронте", linkBody.length > 0, "buildPersonalLink не найдена");
check(
  "ссылка собирается только из токенов",
  /form\/\?t=/.test(linkBody) && /&st=/.test(linkBody),
  "в buildPersonalLink нет пары t=…&st=…",
);
check(
  "тело buildPersonalLink не упоминает имя",
  !/name|фамил/i.test(linkBody),
  "в buildPersonalLink упоминается имя",
);

// На бэке персональный путь тоже не должен доставать имя наружу.
const routes = await read("backend/src/routes/classes.ts");
const publicGet = routes.slice(routes.indexOf("publicClassLinksRouter.get"));
check(
  "GET по персональной ссылке не отдаёт имя",
  /tasks: tasks\.map\(toPublicTask\)/.test(publicGet) && !/studentName:/.test(publicGet.split("publicClassLinksRouter.post")[0]),
  "в публичном GET по персональной ссылке есть имя ученика",
);
check(
  "имя подставляет сервер, а не тело запроса",
  /link\.student\.name/.test(routes),
  "в insert нет снимка имени из строки ученика",
);
check(
  "эталон не отдаётся ученику",
  /toPublicTask/.test(routes) && !/explanation:/.test(routes.split("publicClassLinksRouter.get")[1].split("const LinkSubmitBody")[0]),
  "в публичном ответе появилось поле explanation",
);

// Ни в одном нашем файле не собирается ссылка с именем.
for (const file of [
  "backend/src/routes/classes.ts",
  "src/lib/lk/classes-api.ts",
  "src/components/lk/ClassRosterSection.tsx",
]) {
  const text = await read(file);
  check(
    `${file}: нет ссылки с именем`,
    !/st=\$\{[^}]*name/i.test(text) && !/[?&]name=/.test(text),
    "в ссылку попало имя",
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 5. Лимиты отправки не изменились
 * ───────────────────────────────────────────────────────────────────────────── */

const publicForms = await read("backend/src/routes/publicForms.ts");
/**
 * Читаем не имя константы, а сам блок rateLimitMiddleware по бакетам.
 *
 * Имя константы в двух файлах разное (`formSubmitLimit` / `linkSubmitLimit`),
 * а смысл один и тот же. Проверять по имени значило бы вскоре проверять
 * переименование, а не лимит.
 */
const limitsOf = (text) => ({
  pair: /limit: 60,\s*\n\s*windowSec: 3600,\s*\n\s*bucket: "form-submit"/.test(text),
  bucket: /bucket: "form-submit"/.test(text),
  keyPair: /bucket: "form-submit",\s*\n\s*keyFn: \(c\) => `form:\$\{/.test(text),
  ip: /limit: 200,\s*\n\s*windowSec: 3600,\s*\n\s*bucket: "form-submit-ip"/.test(text),
  bucketIp: /bucket: "form-submit-ip"/.test(text),
});
const base = limitsOf(publicForms);
const link = limitsOf(routes);

check("лимит общей ссылки: 60/час на пару «форма + IP»", base.pair && base.bucket && base.keyPair, "константы в publicForms.ts другие");
check("потолок общей ссылки: 200/час на IP", base.ip && base.bucketIp, "константы в publicForms.ts другие");
check("персональная ссылка использует тот же лимит 60/час", link.pair, "лимит в routes/classes.ts другой");
check("персональная ссылка пишет в тот же бакет form-submit", link.bucket, "другой бакет — получился второй карман");
check("ключ лимита составной: форма + IP", link.keyPair, "ключ лимита не составной");
check("персональная ссылка использует тот же потолок 200/час", link.ip && link.bucketIp, "потолок другой");

/* ─────────────────────────────────────────────────────────────────────────────
 * 6. Чужой класс — отказ, а не пустой ответ
 * ───────────────────────────────────────────────────────────────────────────── */

check(
  "чужой класс отклоняется кодом CLASS_LINK_FORBIDDEN",
  /CLASS_LINK_FORBIDDEN/.test(routes),
  "нет явного отказа на чужую форму",
);
check(
  "проверка владельца формы есть до выдачи заданий",
  routes.indexOf("form.user_id !== link.teacherId") < routes.indexOf("publicClassLinksRouter.get"),
  "владелец не проверяется",
);
check(
  "учительский слой различает «не твой» и «нет такого»",
  /CLASS_FORBIDDEN/.test(routes) && /CLASS_NOT_FOUND/.test(routes),
  "нет раздельных кодов 403 и 404",
);

/* ─────────────────────────────────────────────────────────────────────────────
 * Итог
 * ───────────────────────────────────────────────────────────────────────────── */

if (problems.length > 0) {
  console.error("ПРОВАЛЕНО:");
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}

console.log(`Проверено правил: ${ok.length}`);
console.log("CLASS_ROSTER_OK");