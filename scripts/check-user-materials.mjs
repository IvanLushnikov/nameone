#!/usr/bin/env node
/**
 * Проверка листа 5.1.1: публикация своих материалов и защита чужого.
 *
 *   node scripts/check-user-materials.mjs   →  USER_MATERIALS_SAFE_OK
 *
 * ─── Почему скрипт, а не тест ───────────────────────────────────────────────
 * Здесь нет ни сети, ни D1, ни зависимостей: только Node и чтение файлов. Его
 * можно запустить где угодно — на CI без установки пакетов, на чужой машине, в
 * момент когда backend ещё не поднят.
 *
 * ─── ЧТО СКРИПТ ОБЯЗАН УМЕТЬ ПОВАЛИТЬ ───────────────────────────────────────
 * Главная проверка здесь не «всё на месте», а «снаружи нельзя снять чужой
 * материал». Пока строка вида `DELETE FROM user_materials WHERE id = ?` без
 * `AND user_id = ?` существует в СЛОЕ ДАННЫХ — это дыра, и скрипт обязан падать.
 * Поэтому каждое правило сформулировано как запрет на конкретную форму записи,
 * а не как «вроде бы написано правильно».
 *
 * ─── Что именно проверяем ───────────────────────────────────────────────────
 *   1. Сдача материала идёт С ПРИЗНАТЕМ ВХОДА, а чужой отказ — 403, не 404.
 *   2. Ни одна запись в слое данных не обходится без фильтра по владельцу.
 *   3. Идентификатор учителя приезжает из сессии, а не из тела запроса.
 *   4. В общий банк попадает ТОЛЬКО опубликованное.
 *   5. Статус виден словами, а причину отказа нельзя не указать.
 *   6. Экран не обещает охвата и не выдумывает счётчики.
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

/** Тело функции/блока по маркерам — иначе проверка смотрела бы на соседний текст. */
function bodyOf(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  if (start < 0) return "";
  const end = text.indexOf(endMarker, start);
  return text.slice(start, end < 0 ? text.length : end);
}

/**
 * Убрать комментарии — оставить то, что учитель реально прочитает на экране.
 *
 * Зачем: этот файл объясняет в комментариях, каких обещаний на экране быть не
 * должно, и дословно приводит их в пример. Проверка по исходнику цепляла бы
 * собственное объяснение скрипта и падала на вранье, которого нет.
 *
 * Режутся блочные комментарии и `//` в начале строки. Последнее — намеренно
 * построчно: внутри строки `//` встречается в ссылках (`https://`), и резать по
 * нему всю строку означало бы выкинуть и видимый текст после неё.
 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => (/^\s*\/\//.test(line) ? "" : line))
    .join("\n");
}

const db = await read("backend/src/db/materials.ts");
const routes = await read("backend/src/routes/materials.ts");
const migration = await read("backend/src/db/migrations/0003_user_materials.ts");
const api = await read("src/lib/materials/user-api.ts");
const view = await read("src/components/materials/SubmitMaterialDialog.tsx");
const page = await read("src/app/materials/page.tsx");

/* ─────────────────────────────────────────────────────────────────────────────
 * 1. Сдача материала и отказ за чужой
 * ───────────────────────────────────────────────────────────────────────────── */

check("маршрут сдачи материала есть", /materialsRouter\.post\("\/user"/.test(routes), "POST /api/materials/user не найден");
check("список своих материалов есть", /materialsRouter\.get\("\/user\/mine"/.test(routes), "GET /api/materials/user/mine не найден");
check("общий банк материалов есть", /materialsRouter\.get\("\/user"/.test(routes), "GET /api/materials/user не найден");

// Сдача материала обязана требовать входа: без сессии материал некуда положить.
// Конец обработчика сдачи — СЛЕДУЮЩЕЕ объявление маршрута. Маркер берётся по
// объявлению, а не по слову «PATCH»: слово встречается в шапке файла раньше
// (в списке маршрутов), и такой «конец» уводил бы срез до конца файла — мимо
// проверки.
const submitHandler = bodyOf(routes, 'materialsRouter.post("/user",', 'materialsRouter.patch("/user/:id"');
check("обработчик сдачи вообще найден", submitHandler.length > 0, "не удалось выделить обработчик сдачи");
check(
  "сдача материала требует входа",
  /requireAuth\(c\)/.test(submitHandler),
  "обработчик сдачи не вызывает requireAuth",
);

// Чужой материал — отказ 403, а не 404: иначе «не твоё» неотличимо от «нет такого».
check(
  "у чужого материала свой код отказа (403, не 404)",
  /case "forbidden"/.test(routes) && /MATERIAL_FORBIDDEN/.test(routes) && /MATERIAL_NOT_FOUND/.test(routes),
  "нет раздельных кодов 403 и 404",
);
check(
  "у чужого материала есть слово для учителя",
  /материал другого учителя/i.test(routes),
  "на 403 нет понятного объяснения",
);

/* ─────────────────────────────────────────────────────────────────────────────
 * 2. НИ ОДНА ЗАПИСЬ БЕЗ ФИЛЬТРА ПО ВЛАДЕЛЬЦУ — ГЛАВНОЕ ПРАВИЛО ЛИСТА
 * ───────────────────────────────────────────────────────────────────────────── */

// Любой UPDATE/DELETE должен нести `user_id`. Проверяем ВСЕ такие строки в слое
// данных: одна забытая строка — и учитель снимает чужую работу.
const writeStatements = [...db.matchAll(/\b(UPDATE|DELETE)\s+FROM\s+user_materials\b[^`)]*/gi)].map(
  (m) => m[0],
);
check(
  "в слое данных есть записи — иначе проверять нечего",
  writeStatements.length > 0,
  "в db/materials.ts нет ни одного UPDATE/DELETE — проверка ослаблена",
);

const unscopedWrites = writeStatements.filter(
  (stmt) => !/AND\s+user_id\s*=/i.test(stmt),
);
// Два UPDATE без фильтра допустимы, и оба — не пользовательские:
//   * approve/reject: статус меняет владелец, а не автор;
//   * счётчик скачиваний: он не идентифицирует учителя вообще.
// Всё остальное — дыра.
const ALLOWED_UNSCOPED = [/moderated_by\s*=\s*\?/i, /downloads\s*=\s*downloads\s*\+\s*1/i];
const dangerous = unscopedWrites.filter((stmt) => !ALLOWED_UNSCOPED.some((rx) => rx.test(stmt)));
check(
  "каждая запись по материалу отфильтрована по владельцу",
  dangerous.length === 0,
  `запись без фильтра по user_id: ${dangerous[0] ?? ""}`,
);

// Явный запрет на «удалить по id» в любом виде — самая частая форма дыры.
check(
  "нет удаления материала только по id",
  !/DELETE\s+FROM\s+user_materials\s+WHERE\s+id\s*=\s*\?\d+\s*`/i.test(db),
  "найдено удаление user_materials по одному только id",
);

// Владелец проверяется ДО того, как что-то сделано с материалом.
const updateFn = bodyOf(db, "export async function updateOwnUserMaterial(", "export async function withdrawOwnUserMaterial(");
check(
  "правка сначала проверяет владельца",
  /loadOwnUserMaterial\(db, userId, id\)/.test(updateFn) &&
    updateFn.indexOf("loadOwnUserMaterial(db, userId") < updateFn.indexOf("UPDATE user_materials"),
  "правка меняет строку раньше, чем проверяет, чья она",
);
const withdrawFn = bodyOf(db, "export async function withdrawOwnUserMaterial(", "export async function deleteOwnUserMaterial(");
check(
  "снятие с публикации сначала проверяет владельца",
  /loadOwnUserMaterial\(db, userId, id\)/.test(withdrawFn) &&
    withdrawFn.indexOf("loadOwnUserMaterial(db, userId") < withdrawFn.indexOf("UPDATE user_materials"),
  "снятие меняет строку раньше, чем проверяет, чья она",
);
const deleteFn = bodyOf(db, "export async function deleteOwnUserMaterial(", "export async function recordUserMaterialDownload(");
check(
  "удаление сначала проверяет владельца",
  /loadOwnUserMaterial\(db, userId, id\)/.test(deleteFn) &&
    deleteFn.indexOf("loadOwnUserMaterial(db, userId") < deleteFn.indexOf("DELETE FROM user_materials"),
  "удаление стирает строку раньше, чем проверяет, чья она",
);

// Уже опубликованное не правится и не удаляется молча: иначе учитель тихо
// изменил бы материал, который уже читают другие.
check(
  "опубликованный материал защищён от молчаливой правки",
  /published_locked/.test(db) && /published_locked/.test(routes),
  "нет запрета править/удалять уже опубликованное",
);
check(
  "запрет опубликованного включён и в правку, и в удаление",
  /status === "published"\) return fail\("published_locked"\)/.test(updateFn) &&
    /status === "published"\) return fail\("published_locked"\)/.test(deleteFn),
  "защита опубликованного есть не во всех операциях",
);

/* ─────────────────────────────────────────────────────────────────────────────
 * 3. ЧУЖОЙ УЧИТЕЛЬ ПРИХОДИТ ИЗ СЕССИИ, А НЕ ИЗ ЗАПРОСА
 * ───────────────────────────────────────────────────────────────────────────── */

check(
  "идентификатор учителя берётся из сессии",
  /user\.id/.test(routes) && !/userId:\s*z\./.test(routes) && !/body\.userId/.test(routes),
  "в роутах появился учитель из тела запроса",
);
check(
  "в теле запроса сдачи нет поля user_id",
  !/userId\s*:\s*z\./.test(routes) && !/\.user_id\s*=\s*\?1/.test(routes),
  "клиент может подменить владельца материала",
);
// Модерация — единственное место, где статус меняет не автор, и там нужен админ.
check(
  "модерация доступна только владельцу сайта",
  /function requireAdmin/.test(routes) && /if \(!user\.isAdmin\)/.test(routes),
  "модерация не закрыта администратором",
);
const approveHandler = bodyOf(routes, 'materialsRouter.post("/moderation/:id/approve"', "const RejectBody");
check(
  "модерация требует администратора",
  /requireAdmin\(c\)/.test(approveHandler),
  "обработчик одобрения не проверяет администратора",
);

/* ─────────────────────────────────────────────────────────────────────────────
 * 4. В ОБЩИЙ БАНК ПОПАДАЕТ ТОЛЬКО ОПУБЛИКОВАННОЕ
 * ───────────────────────────────────────────────────────────────────────────── */

const publicListFn = bodyOf(db, "export async function listPublishedUserMaterials(", "export async function getPublishedUserMaterial(");
check(
  "публичный список берёт только опубликованное",
  /status = 'published'/.test(publicListFn),
  "в публичный список попадают неопубликованные материалы",
);
check(
  "фильтр по статусу стоит в SQL, а не в разборе ответа",
  publicListFn.indexOf("status = 'published'") < publicListFn.indexOf("return rows.results"),
  "статус проверяется после чтения — черновик уже прочитан",
);
const publicGetFn = bodyOf(db, "export async function getPublishedUserMaterial(", "export async function listOwnUserMaterials(");
check(
  "открыть отдельный материал можно только опубликованный",
  /status = 'published'/.test(publicGetFn),
  "по прямой ссылке открывается и черновик",
);
const downloadFn = bodyOf(db, "export async function recordUserMaterialDownload(", "модерация");
check(
  "черновик нельзя скачать",
  /status = 'published'/.test(downloadFn),
  "скачать можно и неопубликованный материал",
);
// Дефолт — не публикация: автор не может прислать «уже опубликовано».
check(
  "статус задаёт сервер, а не клиент",
  /'pending'/.test(submitHandler) === false && /VALUES \([^)]*'pending'/i.test(db),
  "статус материала приходит из тела запроса",
);
check(
  "в теле запроса сдачи нет поля status",
  !/status\s*:\s*z\./.test(routes),
  "клиент может сам выбрать статус публикации",
);

/* ─────────────────────────────────────────────────────────────────────────────
 * 5. СТАТУС СЛОВАМИ, ПРИЧИНА ОТКАЗА ОБЯЗАТЕЛЬНА
 * ───────────────────────────────────────────────────────────────────────────── */

check(
  "у каждого статуса есть слова",
  /pending:\s*"На модерации"/.test(api) &&
    /published:\s*"Опубликован"/.test(api) &&
    /rejected:\s*"Отклонён"/.test(api) &&
    /withdrawn:\s*"Снят с публикации"/.test(api),
  "статус показывается кодом, а не словами",
);
check(
  "экран рисует подпись статуса",
  /statusWords\(material\.status\)/.test(view),
  "карточка своего материала не показывает статус словами",
);
check(
  "экран объясняет, что делать дальше",
  /STATUS_HINT/.test(view),
  "нет пояснения: на модерации это или уже в банке",
);
check(
  "причина отказа видна учителю",
  /Причина отказа/.test(view) && /material\.rejectReason/.test(view),
  "отказ показан без причины — учитель не знает, что исправлять",
);
check(
  "отказ без причины невозможен",
  /reason_required/.test(db) && /reason_required/.test(routes),
  "материал можно отклонить молча",
);
// Статус решал человек, а не код: в модерации нет «авто».
check(
  "дефолт модерации — ждать человека",
  /status\s+TEXT\s+NOT\s+NULL\s+DEFAULT\s+'pending'/.test(migration),
  "дефолтный статус не pending — материал может появиться сам",
);
check(
  "очередь модерации — это очередь, а не автопубликация",
  /listModerationQueue/.test(routes) && /moderation\/queue/.test(routes),
  "нет ручной очереди на решение",
);

/* ─────────────────────────────────────────────────────────────────────────────
 * 6. ЭКРАН НЕ ОБЕЩАЕТ ОХВАТА И НЕ ВЫДУМЫВАЕТ СЧЁТЧИКИ
 * ───────────────────────────────────────────────────────────────────────────── */

// Каждая цифра на экране приезжает с сервера, а не считается в браузере.
const pageSection = bodyOf(page, '<section id="teacher-materials"', "</section>");
check(
  "у пользовательского материала виден автор",
  /authorName/.test(view) && /От учителя/.test(view),
  "нет отметки, что материал принёс учитель",
);
check(
  "подпись авторства читается словами",
  /\{material\.authorName\}/.test(view),
  "автор не подписан на карточке",
);
check(
  "счётчик скачиваний подписан честно",
  /Скачали/.test(view) && /раз/.test(view),
  "счётчик подписан словами охвата, которых мы не считали",
);

// Запрещённые обещания: их не должно быть ни на странице, ни в компоненте.
// Проверяем ТЕКСТ ДЛЯ УЧИТЕЛЯ (комментарии убраны), иначе скрипт цеплялся бы
// собственные пояснения о том, чего на экране нет.
const visiblePage = stripComments(pageSection);
const visibleView = stripComments(view);
const FORBIDDEN_PROMISES = [
  /вас увидят все/i,
  /увидят все/i,
  /популярн/i,
  /лучшие работы/i,
  /топ-\d/i,
  /уже скачали \d+ учител/i,
];
for (const rx of FORBIDDEN_PROMISES) {
  check(
    `нет необеспеченного обещания: ${rx.source}`,
    !rx.test(visiblePage) && !rx.test(visibleView),
    "на экране обещание, которого продукт не выполняет",
  );
}
check(
  "на странице сказано, что решение принимает человек",
  /владелец сайта\s+посмотрел/i.test(pageSection),
  "страница не объясняет, что материал проходит модерацию",
);
// Аудитории у нас нет — значит, и хранить её нельзя.
const migrationWrite = bodyOf(migration, "CREATE TABLE IF NOT EXISTS user_material_downloads", "];");
check(
  "в скачиваниях не хранится, кто скачал",
  !/user_id/.test(migrationWrite),
  "в таблице скачиваний появился идентификатор учителя — аудитории у нас нет",
);

/* ─────────────────────────────────────────────────────────────────────────────
 * 7. ЭКРАН И КЛИЕНТ СВЯЗАНЫ СО СТРАНИЦЕЙ
 * ───────────────────────────────────────────────────────────────────────────── */

check(
  "страница подключает авторскую часть",
  /SubmitMaterialDialog/.test(page) && /UserMaterialsList/.test(page),
  "страница каталога не подключает ни сдачу, ни список",
);
check(
  "компонент берёт данные из клиента, а не собирает запрос руками",
  /from "@\/lib\/materials\/user-api"/.test(view),
  "компонент не использует общий клиент материалов",
);
check(
  "формат списка один на клиенте и на экране",
  /loadUserMaterials/.test(view) && /export async function loadUserMaterials/.test(api),
  "экран и клиент разошлись в том, как грузится список",
);

// ─────────────────────────────────────────────────────────────────────────────
// Итог
// ─────────────────────────────────────────────────────────────────────────────

if (problems.length > 0) {
  console.error("ПРОВАЛЕНО:");
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}

console.log(`Проверено правил: ${ok.length}`);
console.log("USER_MATERIALS_SAFE_OK");