#!/usr/bin/env node
/**
 * Проверка листа 3.1.3: ведомость по классу, отметки и выгрузка.
 *
 *   node scripts/check-class-report.mjs   →  CLASS_REPORT_OK
 *
 * ─── Почему скрипт, а не тест ────────────────────────────────────────────────
 * Здесь нет ни сети, ни D1, ни зависимостей: только Node и чтение файлов.
 * Поэтому его можно запустить где угодно — на CI без установки пакетов, на
 * чужой машине, в момент когда backend ещё не поднят — и получить ответ,
 * разъехались ли роуты, типы и экран.
 *
 * ─── Что именно проверяем (и почему каждая проверка не про «написано») ───────
 *   1. Сводка считается СЕРВЕРОМ: маршруты есть, и экран НЕ считает сам.
 *      Числа «сколько сдали» и «кто не сдал» должны приезжать готовыми —
 *      иначе у учителя на телефоне и на ноутбуке получатся разные ведомости.
 *   2. Чужой класс не виден: и сводка, и CSV отказывают ДО чтения учеников,
 *      код отказа — 403, а не 404.
 *   3. Отметка ИИ и отметка учителя не сливаются: сервер отдаёт признак
 *      «учитель не подтвердил», а экран рисует его словами, а не зелёной
 *      ячейкой. `check_method = 'manual'` не считается решением учителя —
 *      это «посмотри сам», иначе эссе выдавалось бы за оценку человека.
 *   4. Ученик без ответов виден как «не сдал»: и в сводке, и в выгрузке.
 *   5. Выгрузка — файл для таблицы: BOM, разделитель `;`, CRLF, attachment,
 *      а имя файла ещё и в UTF-8-варианте (кириллица).
 *   6. Пустое состояние объясняет: три причины и три действия, а не «0».
 *   7. Экран и типы связаны: компонент берёт данные из клиента ведомости,
 *      а не собирает свой запрос руками.
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

/** Тело функции/блока по имени — иначе проверка смотрела бы на соседний текст. */
function bodyOf(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  if (start < 0) return "";
  const end = text.indexOf(endMarker, start);
  return text.slice(start, end < 0 ? text.length : end);
}

const routes = await read("backend/src/routes/classes.ts");
const frontTypes = await read("src/lib/journal/types.ts");
const frontView = await read("src/components/lk/ClassReport.tsx");
const journalPage = await read("src/app/journal/page.tsx");

/* ─────────────────────────────────────────────────────────────────────────────
 * 1. Сводка считается на сервере
 * ───────────────────────────────────────────────────────────────────────────── */

check("маршрут сводки есть", /classesRouter\.get\("\/:id\/report"/.test(routes), "GET /:id/report не найден");
check(
  "маршрут выгрузки есть",
  /classesRouter\.get\("\/:id\/report\.csv"/.test(routes),
  "GET /:id/report.csv не найден",
);

// Сводка обязана требовать входа: без сессии класс не должен читаться.
const reportHandler = bodyOf(routes, 'classesRouter.get("/:id/report"', "classesRouter.get(\"/:id/report.csv\"");
check(
  "сводка требует входа",
  /requireAuth\(c\)/.test(reportHandler),
  "обработчик сводки не вызывает requireAuth",
);
const csvHandler = bodyOf(routes, 'classesRouter.get("/:id/report.csv"', "ПУТЬ УЧЕНИКА");
check("выгрузка требует входа", /requireAuth\(c\)/.test(csvHandler), "обработчик выгрузки не вызывает requireAuth");

// Экран не считает сводку сам: он только показывает числа сервера.
check(
  "экран не считает «сколько сдали» сам",
  !/filter\([^)]*works[^)]*\)\.length|studentsSubmitted\s*[:=]\s*[^r]/i.test(frontView),
  "в компоненте появился подсчёт учеников в браузере",
);
check(
  "экран берёт сводку с сервера",
  /loadClassReport/.test(frontView) && /summary\.studentsSubmitted/.test(frontView),
  "компонент не читает готовые числа сводки",
);

/* ─────────────────────────────────────────────────────────────────────────────
 * 2. Чужой класс не виден
 * ───────────────────────────────────────────────────────────────────────────── */

const loader = bodyOf(routes, "async function loadClassReport(", "GET /api/classes/:id/report");
check(
  "проверка владельца в сборщике сводки",
  /loadOwnClass\(db, userId, classId\)/.test(loader) && /if \(!owned\.ok\) fail\(owned\)/.test(loader),
  "сводка не проверяет, что класс учителя",
);
// Проверка должна идти ДО чтения учеников: иначе чужие строки уже прочитаны.
check(
  "владелец проверяется до чтения учеников",
  loader.indexOf("loadOwnClass(db, userId") < loader.indexOf("FROM class_students"),
  "ученики читаются раньше проверки владельца",
);
check(
  "у чужого класса свой код отказа (403, не 404)",
  /case "forbidden"/.test(routes) && /CLASS_FORBIDDEN/.test(routes) && /CLASS_NOT_FOUND/.test(routes),
  "нет раздельных кодов 403 и 404",
);
// Выгрузка собирается из того же сборщика: иначе ведомость и экран разойдутся.
check(
  "выгрузка и экран берут одну и ту же сводку",
  /loadClassReport\(c\.env\.DB, user\.id, c\.req\.param\("id"\)\)/.test(csvHandler),
  "выгрузка собирает ведомость отдельно от экрана",
);
// Работы фильтруются по владельцу: чужая работа учителя в ведомость не попадёт.
check(
  "в ведомость берутся только работы своего учителя",
  /WHERE f\.user_id = \?1/.test(loader),
  "в выборке работ нет фильтра по user_id",
);

/* ─────────────────────────────────────────────────────────────────────────────
 * 3. Отметка ИИ и отметка учителя не сливаются
 * ───────────────────────────────────────────────────────────────────────────── */

check(
  "сервер отдаёт признак «учитель не подтвердил»",
  /unconfirmedByTeacher/.test(routes) && /unconfirmedWorks/.test(routes),
  "нет признака неподтверждённого вердикта машины",
);
check(
  "признак считается, а не берётся из одного поля",
  /unconfirmedByTeacher: tally\.modelTasks > 0 && tally\.teacherTasks === 0/.test(routes),
  "признак не отличает машину от учителя",
);
// Ручное задание — это «посмотри сам», а не «учитель поставил».
check(
  "manual не считается решением учителя",
  !/meta\.decidedBy === "teacher" \|\| String\(t\.check_method\) === "manual"/.test(routes) &&
    /meta\.decidedBy === "teacher"/.test(routes),
  "check_method='manual' снова засчитан как отметка учителя",
);
check(
  "экран говорит словами, что машина не подтверждена",
  /ИИ, не подтверждён/.test(frontView) && /учитель поправил ИИ/.test(frontView),
  "на экране нет слов про источник отметки",
);
check(
  "выгрузка тоже говорит словами",
  /вердикт ИИ, не подтверждён учителем/.test(routes) && /учитель поправил ИИ/.test(routes),
  "в CSV нет слов про источник отметки",
);

/* ─────────────────────────────────────────────────────────────────────────────
 * 4. Ученик без ответов виден как «не сдал»
 * ───────────────────────────────────────────────────────────────────────────── */

check(
  "сервер отдаёт «не сдали» числом и ученика строкой",
  /studentsNotSubmitted/.test(routes) && /studentsNotSubmitted/.test(frontTypes),
  "нет счётчика «не сдали»",
);
// Строка рисуется для КАЖДОГО ученика отчёта: клиент не имеет права отфильтровать
// тех, у кого нет работ, — иначе «не сдал» молча превратится в «нет ученика».
check(
  "строка ведомости рисуется для каждого ученика",
  /students\.map\(/.test(frontView) && !/students\.filter\(/.test(frontView),
  "компонент рисует не всех учеников подряд",
);
check(
  "ячейка без работы — слово «не сдал»",
  /const NOT_SUBMITTED = "не сдал"/.test(frontView) && /\{NOT_SUBMITTED\}/.test(frontView),
  "ячейка без ответа остаётся пустой или числом",
);
check(
  "в выгрузке пустая ячейка — слово «не сдал»",
  /reportCsvCellValue[\s\S]{0,200}не сдал/.test(routes),
  "в CSV ячейка без ответа остаётся пустой",
);

/* ─────────────────────────────────────────────────────────────────────────────
 * 5. Выгрузка — файл, который открывается таблицей
 * ───────────────────────────────────────────────────────────────────────────── */

check(
  "разделитель «точка с запятой»",
  /\.join\(";"\)/.test(csvHandler) && /join\(";"\)/.test(routes),
  "CSV собирается не через «;»",
);
check(
  "UTF-8 BOM для русского Excel",
  /\\uFEFF/.test(csvHandler),
  "нет BOM — русский Excel откроет файл кракозябрами",
);
check("перевод строки CRLF", /join\("\\r\\n"\)/.test(csvHandler), "нет CRLF");
// Заголовки ответа собраны в ОДНОЙ функции: иначе пустая ветка выгрузки и
// полная разъедутся — одна забудет Content-Disposition, вторая про BOM.
const csvHeaders = bodyOf(routes, "function csvHeaders(", "/** Дата для имени файла");
check(
  "файл скачивается, а не открывается в браузере",
  /attachment; filename=/.test(csvHeaders) && /text\/csv; charset=utf-8/.test(csvHeaders),
  "нет заголовка attachment или типа text/csv",
);
check(
  "имя файла с кириллицей (RFC 5987)",
  /filename\*=UTF-8''/.test(csvHeaders) && /encodeURIComponent/.test(csvHeaders),
  "кириллическое имя класса потерялось бы в имени файла",
);
check(
  "одинаковые заголовки у обеих веток выгрузки",
  (csvHandler.match(/csvHeaders\(/g) ?? []).length === 2,
  "пустая и полная ветки выгрузки отвечают по-разному",
);
check(
  "значения экранируются",
  /function reportCsvCell[\s\S]{0,300}replace\(\/\"\/gu, '""'\)/.test(routes),
  "кавычки и разделитель в значениях не экранируются — файл поедет",
);
check(
  "клиент отдаёт файл как есть, а не строит CSV в браузере",
  /fetchClassReportCsv/.test(frontView) && /new Blob\(\[res\.text\]/.test(frontView),
  "компонент собирает CSV сам или скачивает не текстом",
);

/* ─────────────────────────────────────────────────────────────────────────────
 * 6. Пустое состояние объясняет, что делать
 * ───────────────────────────────────────────────────────────────────────────── */

check(
  "сервер различает три причины пустоты",
  /no_students/.test(routes) && /no_works/.test(routes) && /no_answers/.test(routes),
  "причины пустого ведомоста не разделены",
);
check(
  "экран объясняет каждую причину и предлагает действие",
  /no_students:[\s\S]{0,400}no_works:[\s\S]{0,400}no_answers:/.test(frontView) &&
    /hint:/.test(frontView) &&
    /action:/.test(frontView),
  "у пустого состояния нет пояснения и действия",
);
check(
  "пустое состояние — не голый ноль",
  /title:/.test(frontView) && !/\{summary\.studentsTotal\}\s*<\/div>\s*<\/Card>\s*\)/.test(frontView),
  "пустое состояние показывает только число",
);
// Усреднение: «среднего нет» и «ноль процентов» — разные утверждения.
check(
  "нет среднего — это null, а не ноль",
  /averagePercent: number \| null/.test(frontTypes) && /percentCount > 0 \? Math\.round/.test(routes),
  "нулевое среднее не отличить от «сдавать было нечего»",
);

/* ─────────────────────────────────────────────────────────────────────────────
 * 7. Экран, типы и страница связаны
 * ───────────────────────────────────────────────────────────────────────────── */

check("компонент импортирует клиента ведомости", /from "@\/lib\/journal\/types"/.test(frontView), "нет импорта типов ведомости");
check(
  "клиент ведомости определён в общем модуле",
  /export async function loadClassReport/.test(frontTypes) &&
    /export async function fetchClassReportCsv/.test(frontTypes),
  "в lib/journal/types.ts нет клиента ведомости",
);
check(
  "ведомость стоит на странице журнала",
  /ClassReportSection/.test(journalPage) && /from "@\/components\/lk\/ClassReport"/.test(journalPage),
  "секция ведомости не подключена к странице журнала",
);
check(
  "компонент экспортирован",
  /export function ClassReportSection/.test(frontView),
  "нет экспорта секции ведомости",
);
// Переключатель классов и скрытие: без них экран шумит тому, кто классы не завёл.
check(
  "при нескольких классах есть переключатель",
  /class-report-class-picker/.test(frontView),
  "у учителя с несколькими классами нет выбора класса",
);
check(
  "без классов блок не занимает место",
  /kind: "hidden"/.test(frontView),
  "пустой раздел рисуется всем подряд",
);

/* ─────────────────────────────────────────────────────────────────────────────
 * 8. Ссылки из пустого состояния и из блока — живые
 * ───────────────────────────────────────────────────────────────────────────── */

// Кнопка «что делать дальше», ведущая в 404, хуже, чем её отсутствие: учитель
// ровно в момент, когда ему нужна помощь, получает страницу ошибки.
const hrefs = Array.from(frontView.matchAll(/href="([^"]+)"/g), (m) => m[1]);
check("в блоке есть хоть одна ссылка", hrefs.length > 0, "ссылок не найдено");
const dead = [];
for (const href of hrefs) {
  const clean = href.split("?")[0].split("#")[0].replace(/\/$/, "");
  if (!clean.startsWith("/") || clean.startsWith("//")) continue;
  const asFile = clean === "" ? "src/app/page.tsx" : `src/app${clean}/page.tsx`;
  try {
    await read(asFile);
  } catch {
    dead.push(href);
  }
}
check(
  "все ссылки ведут на существующие страницы",
  dead.length === 0,
  `страницы не существуют: ${dead.join(", ")}`,
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
console.log("CLASS_REPORT_OK");