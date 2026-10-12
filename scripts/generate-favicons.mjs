/**
 * Генератор иконок сайта (favicon / apple-touch).
 *
 * Зачем: до 12.10.2026 в `src/app/favicon.ico` лежала чёрно-белая заглушка
 * (круг с белым треугольником) — вкладка браузера выглядела как «картинки нет».
 * Файл отдавался корректно (200, image/vnd.microsoft.icon), то есть дело было
 * не в раздаче, а в самом рисунке. Меняем на фирменный.
 *
 * Дизайн: тот же знак, что в логотипе шапки (src/components/shared/Logo.tsx) —
 * зелёный скруглённый квадрат и белый лист с загнутым уголком. Но рисуем его
 * заливкой с «дырками» цвета подложки, а не тонкими обводками: в размере 16px
 * обводка 1.8/24 превращается в кашу, а вырез в 26/512 остаётся читаемым.
 *
 * Почему три разных файла:
 *  - `icon.svg`       — вектор, Chrome/Safari/Firefox берут его по умолчанию,
 *                       остаётся резким на HiDPI. Со скруглением.
 *  - `favicon.ico`   — запасной вариант для старых браузеров; внутри три
 *                       размера (16/32/48), каждый — свой PNG (ICO с вложенным
 *                       PNG читают все браузеры новее Vista).
 *  - `apple-icon.png` — 180×180 для экрана «Домой» на iOS. Без скругления:
 *                       iOS накладывает свою маску, и заранее скруглённая
 *                       иконка даёт двойные углы с белыми срезанными углами.
 *
 * Запуск: `node scripts/generate-favicons.mjs`
 */
import sharp from "sharp";
import { writeFileSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const APP_DIR = resolve(ROOT, "src/app");

// Палитра бренда из tailwind.config.ts: brand-500 / brand-600.
const BRAND_500 = "#22B37C";
const BRAND_600 = "#159066";

/**
 * Знак на 512×512.
 *
 * @param {string} bg      заливка подложки
 * @param {number} radius  скругление подложки (0 — полный квадрат)
 */
const glyph = (bg, radius) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${radius}" fill="${bg}"/>
  <path d="M172 100h140l72 72v240a24 24 0 0 1-24 24H172a24 24 0 0 1-24-24V124a24 24 0 0 1 24-24z" fill="#fff"/>
  <path d="M312 100v48a24 24 0 0 0 24 24h48z" fill="${bg}"/>
  <rect x="196" y="252" width="152" height="26" rx="13" fill="${bg}"/>
  <rect x="196" y="316" width="152" height="26" rx="13" fill="${bg}"/>
  <rect x="196" y="380" width="96" height="26" rx="13" fill="${bg}"/>
</svg>`;

// ====================== СБОРКА ICO ======================

/**
 * Собирает .ico из готовых PNG-буферов.
 *
 * Формат: 6 байт заголовка (reserved=0, type=1, count) + по 16 байт на кадр +
 * сами изображения. Кадр хранится как PNG прямо в .ico — так делает сам Windows
 * начиная с Vista, и так понимают все браузеры, для которых нужен favicon.
 */
function packIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type = 1 (icon)
  header.writeUInt16LE(images.length, 4);

  const dir = Buffer.alloc(16 * images.length);
  let offset = header.length + dir.length;

  images.forEach(({ size, data }, i) => {
    const at = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, at + 0); // 0 означает 256
    dir.writeUInt8(size >= 256 ? 0 : size, at + 1);
    dir.writeUInt8(0, at + 2); // палитра не используется
    dir.writeUInt8(0, at + 3); // reserved
    dir.writeUInt16LE(1, at + 4); // planes
    dir.writeUInt16LE(32, at + 6); // бит на пиксель
    dir.writeUInt32LE(data.length, at + 8);
    dir.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });

  return Buffer.concat([header, dir, ...images.map((i) => i.data)]);
}

const raster = (svg, size) => sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();

// ====================== ЗАПИСЬ ======================

// 1. Вектор для современных браузеров.
const iconSvg = glyph(BRAND_500, 116);
const iconSvgPath = resolve(APP_DIR, "icon.svg");
writeFileSync(iconSvgPath, iconSvg);
console.log(`icon.svg       ${statSync(iconSvgPath).size} байт`);

// 2. favicon.ico — три размера со скруглением.
const icoSizes = [16, 32, 48];
const ico = packIco(
  await Promise.all(
    icoSizes.map(async (size) => ({ size, data: await raster(glyph(BRAND_500, 116), size) }))
  )
);
const faviconPath = resolve(APP_DIR, "favicon.ico");
writeFileSync(faviconPath, ico);
console.log(`favicon.ico    ${statSync(faviconPath).size} байт (${icoSizes.join("/")})`);

// 3. apple-icon.png — 180×180, полный квадрат (маску накладывает iOS).
const apple = await raster(glyph(BRAND_600, 0), 180);
const applePath = resolve(APP_DIR, "apple-icon.png");
writeFileSync(applePath, apple);
console.log(`apple-icon.png ${statSync(applePath).size} байт (180×180)`);