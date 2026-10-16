/**
 * Убирает из статического экспорта RSC-копии страниц (файлы `.txt` рядом
 * с `.html`), чтобы сборка влезала в лимит Cloudflare Pages.
 *
 * ЗАЧЕМ. На бесплатном тарифе Pages берёт максимум 20 000 файлов на выкатку.
 * После добавления тем ФГОС (7 251 тема × 3 вида страниц) статический
 * экспорт разросся до 45 208 файлов, и фронт перестал выкатываться вообще:
 * пайплайн доходил до шага Deploy и падал. Страниц «План урока» из выкатки
 * убрали (решение владельца 16.10.2026) — осталось 30 706 файлов, из них
 * 15 247 — технические копии. Без этого шага лимит всё равно не взят.
 *
 * ЧТО ТАКОЕ `.txt`. App Router Next.js кладёт рядом с каждой страницей
 * `.txt` с полезной нагрузкой RSC: она нужна, чтобы переход по внутренней
 * ссылке не перезагружал страницу целиком. Без файла клиентский роутер
 * получает 404 и просто переходит обычным перезагружением — ссылка
 * работает, страница открывается, теряется только мгновенный переход
 * без перезагрузки. Владелец сознательно выбрал этот размен (16.10.2026):
 * лучше 15 459 файлов и полная перезагрузка, чем 30 706 файлов и полный
 * отказ выкатки.
 *
 * ЧТО НЕ ТРОГАЕМ. `robots.txt`, `llms.txt` и `llms-full.txt` — настоящие
 * текстовые файлы сайта, не RSC-копии. Их отличает признак: рядом нет
 * одноимённого `.html`. Поэтому правило «удалять `.txt`, у которого есть
 * сосед `.html`», а не «удалять все `.txt`».
 *
 * ЗАПУСК. Скрипт вызывается из `npm run build` после `next build`,
 * поэтому в CI и при ручной сборке поведение одинаковое.
 */

import { existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "out");

// Каталоги, содержимое которых — не страницы сайта. Обходить их не нужно:
// внутри `_next` RSC-копий нет, а `node_modules`-подобные каталоги в сборку
// не попадают. Список оставлен явным, чтобы случайно не начать удалять
// файлы внутри бандла.
const SKIP_DIRS = new Set(["_next"]);

let deleted = 0;
let kept = 0;

/**
 * Рекурсивно обходит каталог и удаляет `.txt`, у которых есть сосед `.html`.
 * @param {string} dir каталог для обхода
 */
function prune(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) prune(full);
      continue;
    }

    if (!entry.name.endsWith(".txt")) continue;

    // Соседний `.html` — признак того, что это RSC-копия страницы.
    const html = full.replace(/\.txt$/, ".html");
    if (existsSync(html)) {
      unlinkSync(full);
      deleted += 1;
    } else {
      kept += 1;
    }
  }
}

if (!existsSync(OUT)) {
  console.error(`Каталога сборки нет: ${OUT}. Запустите npm run build целиком.`);
  process.exit(1);
}

const before = countFiles(OUT);
prune(OUT);
const after = countFiles(OUT);

console.log(
  `prune-export: удалено RSC-копий ${deleted}, сохранено служебных .txt ${kept}. ` +
    `Файлов в сборке: ${before} → ${after}.`,
);

if (after > 20000) {
  console.error(
    `prune-export: в сборке ${after} файлов, а Cloudflare Pages на бесплатном ` +
      `тарифе берёт 20 000. Выкатка снова упадёт — нужно либо убрать ещё страницы, ` +
      `либо перейти на платный тариф (там лимит 100 000).`,
  );
  process.exit(1);
}

/**
 * Считает все файлы в каталоге.
 * @param {string} dir каталог
 * @returns {number} количество файлов
 */
function countFiles(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    total += entry.isDirectory() ? countFiles(full) : statSync(full).isFile() ? 1 : 0;
  }
  return total;
}