/**
 * Печать рабочего листа: в PDF не должно быть ПУСТЫХ страниц (лист 6.1.5).
 *
 * Запуск — одной командой, сервер поднимает и гасит сам:
 *   node scripts/check-print-pages.mjs
 *
 * ЧТО ПРОВЕРЯЕМ (гейт G1). Пустая страница — это страница PDF, на которой нет
 * НИЧЕГО, кроме водяной метки «ДЕМО». Метка в `PrintWatermark` сделана
 * `position: fixed`, поэтому Chromium повторяет её на КАЖДОЙ странице, и
 * брак выглядит как «лист из двух страниц, вторая — с одним словом ДЕМО».
 * Проверка честная: PDF печатается настоящей печатью браузера (`page.pdf()`,
 * те же стили, что и Ctrl+P), страницы считаются `pdfinfo`, текст каждой
 * страницы достаётся `pdftotext` и разбирается посимвольно. Скриншот «похоже,
 * нормально» доказательством не был бы — здесь он только дополнение.
 *
 * ГЛАВНЫЙ СЛУЧАЙ: лист из 5 заданий с ответами и пояснениями обязан печататься
 * РОВНО В 2 СТРАНИЦЫ (материал, потом ответы). Столько же страниц — у листа из
 * одного задания. Больше — значит где-то между ними пустая полоса.
 *
 * ПОИСК КРАЕВЫХ СЛУЧАЕВ. Разбивку задаёт не CSS, а длина материала: когда
 * материал кончается ровно у края страницы, принудительный разрыв перед
 * ответами может добавить лишнюю страницу. Поэтому перебираем число заданий
 * от 1 до 24 (`SWEEP_MAX`) и смотрим, появляется ли пустая страница на КАКОМ-ТО
 * шаге. Это и есть настоящая проверка края, а не один удачный пример.
 *
 * ОСТАЛЬНЫЕ ТИПЫ. Лист, КТП, план урока и презентация печатаются из
 * `/preview`; карточки, комплект материалов и «урок целиком» живут только в
 * конструкторе — но и они достаются честно: конструктор сам восстанавливает
 * последний артефакт из истории устройства, поэтому кладём артефакт в
 * localStorage и открываем `/constructor` без query-параметров (глубокая
 * ссылка восстановление отменяет).
 *
 * КАК ПОЛУЧАЕМ ЧЕСТНЫЙ МАТЕРИАЛ. Артефакты с `isDemo: true` кладём в
 * localStorage истории (`uchlist.history`) и открываем `/preview?id=<id>` — тот
 * же путь, которым учитель открывает лист из кабинета. Ничего не подделываем
 * на уровне флага: `isDemo` лежит в самом артефакте, превью читает именно его,
 * поэтому метка «ДЕМО» в PDF настоящая (это важно: именно она делает страницу
 * «почти пустой», и без неё дефект не воспроизводится).
 *
 * ЧТО НУЖНО: playwright (уже в проекте) и poppler (`pdfinfo`, `pdftotext`).
 * Если poppler не найден — скрипт падает с объяснением, а не делает вид,
 * что измерил.
 */

import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import net from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SHOTS = join(ROOT, ".unlazy", "teacher-path", "shots", "leaf-6.1.5");
const KEY_HISTORY = "uchlist.history";

/** Порт по умолчанию — как в задании листа. Занятый порт пропускаем. */
const WANT_PORT = Number(process.env.PORT ?? 4317);

/** Сколько листов с разным числом заданий перебираем в поисках края. */
const SWEEP_MAX = 24;

const failures = [];
const report = [];

function check(name, ok, detail) {
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  report.push(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

// ---------------------------------------------------------------------------
// Материал
// ---------------------------------------------------------------------------

const SUBJECT = "algebra";
/** Свежая дата: конструктор восстанавливает артефакт из истории только если
 *  он не старше двух часов — иначе пришлось бы подделывать возраст записи. */
const CREATED_AT = new Date().toISOString();

/** Короткое задание — обычный случай, который и ломала печать. */
function shortTask(n) {
  return {
    number: n,
    text: `Решите уравнение ${n * 2}x + ${n + 1} = ${n * 7 + 4} и запишите корень.`,
    answer: `x = ${n + 1}`,
    explanation: `Собираем x в одной стороне: ${n * 2}x = ${n * 7 + 4 - n - 1}, делим и получаем корень.`,
    points: 2,
  };
}

/** Длинное условие с вариантами — материал, который сам по себе рвётся. */
function longTask(n) {
  return {
    number: n,
    text:
      `Задача ${n}. Туризм. Турист прошёл первую часть маршрута со скоростью ` +
      `${n + 2} км/ч в течение ${n} ч, затем вторую часть со скоростью ${n + 5} км/ч ` +
      `в течение ${n + 1} ч, сделал остановку на 30 мин и вернулся по короткой дороге, ` +
      `проехав ${n * 4} км. Найдите весь путь туриста и среднюю скорость на всём маршруте, ` +
      `считая остановку частью пути, и объясните, почему средняя скорость не равна среднему ` +
      `арифметическому скоростей на участках.`,
    options: [
      `Весь путь равен ${n * 3} км`,
      `Весь путь равен ${n * 5} км, средняя скорость выше среднего арифметического`,
      `Весь путь равен ${n * 7} км, средняя скорость равна среднему арифметическому`,
    ],
    answer: `${n * 5} км`,
    explanation:
      `Складываем пути участков и делим на общее время вместе с остановкой; ` +
      `средняя скорость на всём маршруте считается от всего пути и всего времени.`,
    points: 3,
  };
}

function worksheet(id, title, tasks) {
  return {
    id,
    title,
    subject: SUBJECT,
    grade: 8,
    topic: "Рациональные дроби",
    difficulty: "medium",
    isDemo: true,
    createdAt: CREATED_AT,
    tasks,
  };
}

const seq = (n, fn) => Array.from({ length: n }, (_, i) => fn(i + 1));

/** КТП — самый плотный тип: таблица на несколько страниц. */
const KTP = {
  id: "print-ktp",
  type: "ktp",
  title: "КТП · Алгебра · 8 класс · 2026/2027",
  subject: SUBJECT,
  grade: 8,
  schoolYear: "2026/2027",
  totalHours: 102,
  isDemo: true,
  createdAt: CREATED_AT,
  weeks: Array.from({ length: 34 }, (_, i) => ({
    weekNum: i + 1,
    entries: [0, 1].map((k) => ({
      num: i * 2 + k + 1,
      dates: `${String((i * 6 + k * 2) % 28 + 1).padStart(2, "0")}.09–${String((i * 6 + k * 2 + 5) % 28 + 1).padStart(2, "0")}.09`,
      topic: [
        "Повторение. Разложение многочленов на множители с помощью формул сокращённого умножения",
        "Целые выражения. Преобразование рациональных выражений и решение задач на проценты",
        "Линейная функция и её график. Прямая пропорциональная и обратная",
        "Системы линейных уравнений с двумя переменными",
      ][(i + k) % 4],
      kind: k === 1 ? "control" : "lesson",
      hours: 1,
      fgosRef: "Гл. 1 §2",
    })),
  })),
};

/** План урока — шесть стадий, обычно короче одной страницы. */
const PLAN = {
  id: "print-plan",
  type: "lesson-plan",
  title: "План урока · Рациональные дроби",
  subject: SUBJECT,
  grade: 8,
  topic: "Рациональные дроби",
  fgosRef: "§ 27, п. 3",
  goals: {
    educational: ["Сокращать рациональные дроби", "Определять область определения"],
    developmental: ["Развивать умение работать с формулами"],
    nurturing: ["Воспитывать аккуратность в записи"],
  },
  equipment: ["Учебник", "Тетрадь", "Карточки для проверки"],
  stages: [
    {
      kind: "org-moment",
      title: "Организационный момент",
      durationMin: 3,
      teacherActions: "Приветствие, проверка готовности к уроку.",
      studentActions: "Готовят рабочее место.",
    },
    {
      kind: "motivation",
      title: "Мотивация",
      durationMin: 5,
      teacherActions: "Показывает, где дроби встречаются в жизни.",
      studentActions: "Слушают, называют примеры.",
    },
    {
      kind: "new-topic",
      title: "Объяснение нового материала",
      durationMin: 12,
      teacherActions: "Разбирает сокращение дроби по образцу.",
      studentActions: "Записывают в тетрадь.",
    },
    {
      kind: "practice",
      title: "Отработка",
      durationMin: 15,
      teacherActions: "Даёт задания по карточкам.",
      studentActions: "Решают, проверяют по образцу.",
    },
    {
      kind: "reflex",
      title: "Рефлексия",
      durationMin: 5,
      teacherActions: "Возвращает к цели урока.",
      studentActions: "Отвечают, что поняли.",
    },
    {
      kind: "homework",
      title: "Домашнее задание",
      durationMin: 5,
      teacherActions: "Задаёт номера из учебника.",
      studentActions: "Записывают домашнее задание.",
    },
  ],
  homework: { text: "§ 27, № 892–897" },
  isDemo: true,
  createdAt: CREATED_AT,
};

/** Презентация — слайды не печатаются как листы, но страницы всё равно считаем. */
const PRESENTATION = {
  id: "print-presentation",
  type: "presentation",
  title: "Презентация · Рациональные дроби",
  subject: SUBJECT,
  grade: 8,
  topic: "Рациональные дроби",
  slideCount: 10,
  slides: seq(10, (i) => ({
    kind: i === 1 ? "title" : "bullets",
    title: i === 1 ? "Рациональные дроби" : `Слайд ${i}: правило сокращения`,
    bullets: [
      `Сокращаем дробь на общем множителе числителя и знаменателя.`,
      `Область определения не должна содержать нули знаменателя.`,
    ],
  })),
  isDemo: true,
  createdAt: CREATED_AT,
};

const byId = new Map();
function entry(artifact, type) {
  const item = {
    id: artifact.id,
    type,
    title: artifact.title,
    subject: artifact.subject,
    grade: artifact.grade,
    createdAt: artifact.createdAt,
    isFavorite: false,
    artifact,
  };
  byId.set(artifact.id, item);
  return item;
}

/** Случаи: 5 заданий — эталон, дальше края и соседние типы. */
const CASES = [
  { id: "print-ws-5", label: "лист 5 заданий (эталон)", artifact: worksheet("print-ws-5", "Рабочий лист · Линейная функция", seq(5, shortTask)) },
  { id: "print-ws-long", label: "лист с длинными условиями и вариантами", artifact: worksheet("print-ws-long", "Рабочий лист · Задачи на движение", seq(8, longTask)) },
  { id: "print-ws-30", label: "лист 30 заданий", artifact: worksheet("print-ws-30", "Рабочий лист · Большой лист", seq(30, shortTask)) },
  { id: "print-ktp", label: "КТП", artifact: KTP },
  { id: "print-plan", label: "план урока", artifact: PLAN },
  { id: "print-presentation", label: "презентация", artifact: PRESENTATION },
];

for (const c of CASES) {
  const type = c.id === "print-ktp" ? "ktp" : c.id === "print-plan" ? "lesson-plan" : c.id === "print-presentation" ? "presentation" : "worksheet";
  c.type = type;
  c.historyEntry = entry(c.artifact, type);
}

/** Перебор числа заданий — ищем, на каком шаге появляется пустая страница. */
for (let n = 1; n <= SWEEP_MAX; n++) {
  const id = `print-sweep-${n}`;
  CASES.push({
    id,
    label: `лист ${n} заданий (перебор)`,
    type: "worksheet",
    historyEntry: entry(worksheet(id, `Рабочий лист · ${n} заданий`, seq(n, shortTask)), "worksheet"),
  });
}

const HISTORY = CASES.map((c) => c.historyEntry);

/**
 * Типы, которые печатаются из конструктора. Карточки — главный случай: их
 * листы разделялись высотой A4, а не правилом разрыва, поэтому правка печати
 * обязана проверить, что листы не склеились (и не плодили пустые).
 * 20 карточек = 2 листа = ровно 2 страницы, 8 карточек = 1 лист = 1 страница.
 */
const CARD_SETS = {
  "print-cards-20": seq(20, (i) => ({
    front: `Термин ${i}: сокращение дроби`,
    back: `Определение ${i}: числитель и знаменатель делят на общий множитель, знак не меняется.`,
    category: "Словарь",
  })),
  "print-cards-8": seq(8, (i) => ({
    front: `Формула ${i}: площадь прямоугольника`,
    back: `Формула ${i}: S = a · b, где a и b — длина и ширина в сантиметрах.`,
    category: "Формулы",
  })),
};

const MATERIALS = {
  id: "print-materials",
  type: "materials",
  title: "Комплект материалов · Рациональные дроби",
  subject: SUBJECT,
  grade: 8,
  topic: "Рациональные дроби",
  isDemo: true,
  createdAt: CREATED_AT,
  files: [
    {
      id: "f1",
      kind: "glossary",
      title: "Словарь терминов",
      format: "txt",
      content: seq(12, (i) => `Термин ${i} — определение, которое нужно помнить наизусть к контрольной.`).join("\n"),
    },
    {
      id: "f2",
      kind: "reference",
      title: "Справочные данные",
      format: "txt",
      content: seq(14, (i) => `Формула ${i}: сокращение дроби, область определения, разложение на множители.`).join("\n"),
    },
    {
      id: "f3",
      kind: "handout",
      title: "Памятка для ученика",
      format: "txt",
      content: seq(10, (i) => `Шаг ${i}: смотри на множители числителя и знаменателя, потом сокращай.`).join("\n"),
    },
  ],
};

const BUNDLE = {
  id: "print-bundle",
  type: "lesson-bundle",
  title: "Урок целиком: Рациональные дроби",
  subject: SUBJECT,
  grade: 8,
  topic: "Рациональные дроби",
  isDemo: true,
  createdAt: CREATED_AT,
  totalMs: 1200,
  failed: [],
  lessonPlan: PLAN,
  presentation: PRESENTATION,
  worksheet: worksheet("print-bundle-ws", "Рабочий лист · Рациональные дроби", seq(5, shortTask)),
  test: worksheet("print-bundle-test", "Тест · Рациональные дроби", seq(6, shortTask)),
};

const CONSTRUCTOR_CASES = [
  { id: "print-cards-20", label: "карточки, 20 штук (2 листа)", type: "cards", artifact: { id: "print-cards-20", title: "Карточки · Рациональные дроби", subject: SUBJECT, grade: 8, topic: "Рациональные дроби", difficulty: "medium", isDemo: true, createdAt: CREATED_AT, cards: CARD_SETS["print-cards-20"] }, needle: "Карточки для запоминания" },
  { id: "print-cards-8", label: "карточки, 8 штук (1 лист)", type: "cards", artifact: { id: "print-cards-8", title: "Карточки · Формулы", subject: SUBJECT, grade: 8, topic: "Площадь", difficulty: "medium", isDemo: true, createdAt: CREATED_AT, cards: CARD_SETS["print-cards-8"] }, needle: "Карточки для запоминания" },
  { id: "print-materials", label: "комплект материалов", type: "materials", artifact: MATERIALS, needle: "Словарь терминов" },
  { id: "print-bundle", label: "урок целиком", type: "lesson-bundle", artifact: BUNDLE, needle: "Урок целиком" },
];

for (const c of CONSTRUCTOR_CASES) {
  c.historyEntry = {
    id: c.artifact.id,
    type: c.type,
    title: c.artifact.title,
    subject: c.artifact.subject,
    grade: c.artifact.grade,
    createdAt: c.artifact.createdAt,
    isFavorite: false,
    artifact: c.artifact,
  };
}

/** Сколько страниц обязано занять карточки: лист карточек — это страница. */
const EXPECT_PAGES = new Map([
  ["print-cards-20", 2],
  ["print-cards-8", 1],
]);

/**
 * Варианты печати — те, которыми пользуется учитель из диалога Chrome.
 * `nobg` — главный: галочка «фоновая графика» по умолчанию ВЫКЛЮЧЕНА.
 */
const VARIANTS = [
  { tag: "nobg", opts: { printBackground: false } },
  { tag: "bg", opts: { printBackground: true } },
  { tag: "scale70", opts: { printBackground: false, scale: 0.7 } },
  { tag: "landscape", opts: { printBackground: false, landscape: true } },
];

// ---------------------------------------------------------------------------
// Измерение PDF
// ---------------------------------------------------------------------------

function haveTool(tool) {
  try {
    execFileSync("command", ["-v", tool], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function pdfPages(path) {
  const out = execFileSync("pdfinfo", [path], { encoding: "utf8" });
  const m = out.match(/^Pages:\s+(\d+)/m);
  if (!m) throw new Error(`pdfinfo не вернул число страниц для ${path}`);
  return Number(m[1]);
}

function pageText(path, page) {
  return execFileSync("pdftotext", ["-f", String(page), "-l", String(page), path, "-"], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
}

/**
 * Страница пустая, если на ней нет ничего, кроме метки «ДЕМО». Метка
 * рисуется разреженными буквами, и `pdftotext` отдаёт её как «О М ДЕ О М Е Д
 * О М ДЕ», поэтому проверяем не совпадение строки, а остаток: убираем
 * пробелы и буквы ДЕМО — если осталось пусто, кроме метки на странице
 * ничего нет.
 */
function isBlank(text) {
  return text.replace(/[\s\u00a0]+/g, "").replace(/[ДДЕМО]/g, "").length === 0;
}

/** Разбор страницы: сколько значащих символов и есть ли заголовок раздела. */
function analysePage(text) {
  const dense = text.replace(/[\s\u00a0]+/g, "");
  return {
    chars: dense.replace(/[ДДЕМО]/g, "").length,
    material: text.includes("РАБОЧИЙ ЛИСТ") || text.includes("ОТВЕТЫ И ПОЯСНЕНИЯ"),
    answers: text.includes("ОТВЕТЫ И ПОЯСНЕНИЯ"),
    head: dense.slice(0, 60),
  };
}

/** «1 страница / 2 страницы / 5 страниц» — отчёт читает человек. */
function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

async function measurePdf(page, name, label, variant, file) {
  await page.pdf({ path: file, format: "A4", ...variant.opts });
  const pages = pdfPages(file);
  const detail = [];
  for (let i = 1; i <= pages; i++) {
    const text = pageText(file, i);
    detail.push({ page: i, blank: isBlank(text), ...analysePage(text) });
  }
  const blanks = detail.filter((d) => d.blank).map((d) => d.page);
  check(
    `${label} · ${variant.tag}: пустых страниц нет`,
    blanks.length === 0,
    `страниц ${pages}${blanks.length ? `, пустые: ${blanks.join(", ")}` : ""}`
  );
  return { name, label, variant: variant.tag, pdf: file, pages, detail, blanks };
}

/** Сколько страниц должен занимать эталонный лист: материал + ответы. */
const EXPECT_2PAGES = new Set(["print-ws-5", "print-sweep-1", "print-sweep-2", "print-sweep-3", "print-sweep-4"]);

// ---------------------------------------------------------------------------
// Dev-сервер
// ---------------------------------------------------------------------------

async function probe(base, timeoutMs) {
  try {
    const res = await fetch(base, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForServer(base, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe(base, 4000)) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

/** Первый свободный порт от 4317 вверх — чтобы не мешать чужим стендам. */
function freePortFrom(want) {
  return new Promise((resolve, reject) => {
    const tryPort = (port) => {
      const s = net.createServer();
      s.once("error", (err) => {
        if (err.code === "EADDRINUSE") {
          s.close(() => (port + 1 <= want + 20 ? tryPort(port + 1) : reject(err)));
        } else reject(err);
      });
      s.once("listening", () => s.close(() => resolve(port)));
      s.listen(port, "127.0.0.1");
    };
    tryPort(want);
  });
}

async function main() {
  for (const tool of ["pdfinfo", "pdftotext"]) {
    if (!haveTool(tool)) {
      console.error(
        `[check-print-pages] Не найден ${tool} (poppler).\n` +
          `  Без него страницы PDF не посчитать — гейт без честного измерения\n` +
          `  проходить нельзя. Установите poppler: brew install poppler`
      );
      process.exit(1);
    }
  }

  const { chromium } = await import("playwright");

  mkdirSync(SHOTS, { recursive: true });

  const port = await freePortFrom(WANT_PORT);
  const BASE = `http://127.0.0.1:${port}`;

  /** Поднимаем сервер и гасим его одной группой процессов. */
  const spawnServer = () => {
    const proc = spawn("npm", ["run", "dev", "--", "--port", String(port)], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    });
    proc.log = "";
    proc.stdout.on("data", (b) => (proc.log += b.toString()));
    proc.stderr.on("data", (b) => (proc.log += b.toString()));
    return proc;
  };
  const killServer = (child) => {
    if (!child?.pid) return;
    try {
      // npm порождает next отдельным процессом — гасим всю группу.
      process.kill(-child.pid, "SIGTERM");
    } catch {
      try {
        child.kill("SIGTERM");
      } catch {
        /* уже мёртв */
      }
    }
  };

  let child = spawnServer();
  console.log(`[check-print-pages] Поднимаю dev-сервер на ${BASE} (порт ${port})…`);

  const measured = [];

  try {
    // В репозитории параллельно работают другие dev-серверы и делят каталог
    // сборки, поэтому запуск иногда зависает на «Starting…». Один повтор —
    // дешевле, чем красный гейт из-за чужой пересборки.
    let ready = await waitForServer(BASE, 150_000);
    if (!ready) {
      console.log("[check-print-pages] Сервер не проснулся, пробую ещё раз…");
      killServer(child);
      child = spawnServer();
      ready = await waitForServer(BASE, 150_000);
    }
    if (!ready) {
      throw new Error(`Сервер не поднялся на ${BASE}. Лог:\n${String(child.log).slice(-2000)}`);
    }

    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      [KEY_HISTORY, JSON.stringify(HISTORY)]
    );

    for (const c of CASES) {
      await page.goto(`${BASE}/preview?id=${c.id}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
      // Материал отрисован: `.worksheet-page` есть у листа, КТП и плана урока,
      // а презентация печатается сеткой слайдов без него — ждём любой из них.
      // Именно `attached`, а не `visible`: предыдущий случай уже переключил
      // страницу в печатные стили, а экранная шапка превью в них скрыта.
      await page.waitForSelector(".worksheet-page, h1, h2", { state: "attached", timeout: 60_000 });
      // Шрифты и формулы дожидаемся — иначе в PDF едет разная высота строк.
      await page.evaluate(() => document.fonts.ready);
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.emulateMedia({ media: "print" });
      await page.waitForTimeout(350);

      // Перебор края меряем одним вариантом: разбивку задаёт длина материала,
      // а не галочка «фоновая графика».
      const variants = c.label.includes("(перебор)") ? VARIANTS.slice(0, 1) : VARIANTS;
      for (const v of variants) {
        const file = join(SHOTS, `${c.id}--${v.tag}.pdf`);
        measured.push(await measurePdf(page, c.id, c.label, v, file));
      }
    }

    await page.close();

    /* --- Фаза 2: типы, которые печатаются только из конструктора. --------- */
    for (const c of CONSTRUCTOR_CASES) {
      // Своя страница и своя история на случай: конструктор восстанавливает
      // ровно один артефакт — самый свежий, поэтому лишние записи только мешают.
      const cpage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await cpage.addInitScript(
        ([key, value]) => window.localStorage.setItem(key, value),
        [KEY_HISTORY, JSON.stringify([c.historyEntry])]
      );
      await cpage.goto(`${BASE}/constructor`, { waitUntil: "domcontentloaded", timeout: 180_000 });
      // Ждём кусок материала, а не класс: у комплекта материалов и «урока
      // целиком» нет ни `.worksheet-page`, ни `.cards-print-sheet`.
      await cpage.waitForFunction(
        (needle) => (document.body.textContent ?? "").includes(needle),
        c.needle,
        { timeout: 60_000 }
      );
      await cpage.evaluate(() => document.fonts.ready);
      await cpage.waitForLoadState("networkidle").catch(() => {});
      await cpage.emulateMedia({ media: "print" });
      await cpage.waitForTimeout(350);
      for (const v of VARIANTS) {
        const file = join(SHOTS, `${c.id}--${v.tag}.pdf`);
        measured.push(await measurePdf(cpage, c.id, c.label, v, file));
      }
      await cpage.close();
    }

    await browser.close();

    // --- То, ради чего лист и затевался: ровно две страницы у короткого листа.
    for (const m of measured.filter((m) => EXPECT_2PAGES.has(m.name) && m.variant === "nobg")) {
      check(`${m.label}: ровно 2 страницы (материал, потом ответы)`, m.pages === 2, `страниц ${m.pages}`);
    }

    // Карточки: один лист карточек — ровно одна страница. Правка печати сняла
    // высоту A4, на которой держался разрыв между листами, поэтому это
    // главная проверка, что листы не склеились.
    for (const m of measured.filter((m) => EXPECT_PAGES.has(m.name) && m.variant === "nobg")) {
      const want = EXPECT_PAGES.get(m.name);
      check(`${m.label}: ровно ${want} ${plural(want, "страница", "страницы", "страниц")}`, m.pages === want, `страниц ${m.pages}`);
    }

    // Ответы — отдельной страницей и ровно один раз.
    for (const m of measured.filter((m) => m.name === "print-ws-5" && m.variant === "nobg")) {
      const answerPages = m.detail.filter((d) => d.answers).map((d) => d.page);
      check(
        "эталон: ответы начинаются с новой страницы и печатаются один раз",
        answerPages.length === 1 && answerPages[0] === m.pages,
        `страницы с ответами: ${answerPages.join(", ") || "нет"}, всего ${m.pages}`
      );
      check("эталон: материал и ответы несли в одну страницу", m.detail[0].chars > 200, `знаков на 1-й странице ${m.detail[0].chars}`);
    }

    // Перебор: ни на одном числе заданий пустой страницы быть не должно.
    const sweep = measured.filter((m) => m.name.startsWith("print-sweep-"));
    const sweepBad = sweep.filter((m) => m.blanks.length > 0).map((m) => `${m.name}:${m.blanks.join(",")}`);
    check(
      `перебор 1..${SWEEP_MAX} заданий: пустых страниц нет`,
      sweepBad.length === 0,
      sweepBad.length ? sweepBad.join("; ") : `страниц от ${Math.min(...sweep.map((m) => m.pages))} до ${Math.max(...sweep.map((m) => m.pages))}`
    );

    writeFileSync(join(SHOTS, "pages.json"), JSON.stringify(measured, null, 2));

    console.log(report.join("\n"));
    console.log("");
    console.log(`PDF: ${SHOTS}`);
    console.log(`Разбор страниц: ${join(SHOTS, "pages.json")}`);
    console.log("");
    if (failures.length > 0) {
      console.error(`NO_BLANK_PAGE_FAIL (${failures.length}):`);
      for (const f of failures) console.error(`  · ${f}`);
      process.exitCode = 1;
    } else {
      console.log("NO_BLANK_PAGE_OK");
    }
  } finally {
    killServer(child);
  }
}

await main();