/**
 * Генератор OG-картинок для трёх сравнительных страниц.
 *
 * Отдельный скрипт, а не дополнение к `generate-og-images.mjs`: тот парсит
 * предметы из `subjects.ts` и перерисовывает все 22 карточки. Перезапускать его
 * ради трёх новых файлов незачем — и он тянет шрифты с jsDelivr, а здесь
 * достаточно локальных из `scripts/fonts/`.
 *
 * Визуально карточка повторяет `OgCard` из основного генератора: тот же фон,
 * те же бейджи, тот же бренд. Отличается только подзаголовок — здесь это
 * честная приписка «цены проверены 14 октября 2026», чтобы по картинке в
 * ленте было видно, что цифры не выдуманы.
 *
 * Запуск: node scripts/generate-og-compare.mjs
 *
 * Выход: public/og/compare-uchlist-ili-{obuchay,neyrum,chatgpt}.png
 */
import { ImageResponse } from "next/dist/compiled/@vercel/og/index.node.js";
import { createElement as h } from "react";
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OG_DIR = resolve(ROOT, "public/og");

// Палитра и размер — те же, что в scripts/generate-og-images.mjs и в Edge route.
const SIZE = { width: 1200, height: 630 };
const COLOR_BG_FROM = "#062C24"; // brand-950
const COLOR_BG_MID = "#105C47";
const COLOR_BG_TO = "#159066"; // brand-600
const COLOR_BRAND = "#22B37C"; // brand-500
const COLOR_WHITE = "#FFFFFF";
const COLOR_SUBTLE = "rgba(255,255,255,0.75)";

// Заголовки короче, чем у предметов, — размер шрифта фиксируем, чтобы три
// картинки не отличались друг от друга кеглем.
const TITLE_SIZE = 72;

/**
 * Три карточки. Заголовок — до «или», подзаголовок — сам вопрос сравнения:
 * именно так учитель формулирует запрос в поиске.
 */
const CARDS = [
  {
    slug: "uchlist-ili-obuchay",
    title: "УчЛист",
    subtitle: "или Обучай",
    badges: ["Цены", "Лимиты", "Проверено 14.10.2026"],
  },
  {
    slug: "uchlist-ili-neyrum",
    title: "УчЛист",
    subtitle: "или Нейрум",
    badges: ["Цены", "Токены", "Проверено 14.10.2026"],
  },
  {
    slug: "uchlist-ili-chatgpt",
    title: "УчЛист",
    subtitle: "или ChatGPT",
    badges: ["Рабочие листы", "Цена", "Проверено 14.10.2026"],
  },
];

/* ── шрифты: только локальные, без сети ─────────────────────────────── */

let _fonts = null;
function loadFonts() {
  if (_fonts) return _fonts;

  const regularPath = resolve(__dirname, "fonts", "inter-cyrillic-400.woff");
  const boldPath = resolve(__dirname, "fonts", "inter-cyrillic-700.woff");
  if (!existsSync(regularPath) || !existsSync(boldPath)) {
    throw new Error(
      "Нет шрифтов в scripts/fonts/. Положите inter-cyrillic-400.woff и inter-cyrillic-700.woff.",
    );
  }

  const toAB = (b) =>
    b instanceof ArrayBuffer ? b : b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);

  _fonts = { regular: toAB(readFileSync(regularPath)), bold: toAB(readFileSync(boldPath)) };
  return _fonts;
}

/* ── карточка ───────────────────────────────────────────────────────── */

function OgCard({ title, subtitle, badges }) {
  const children = [];

  // Бренд — как на остальных карточках сайта.
  children.push(
    h(
      "div",
      { key: "brand", style: { display: "flex", alignItems: "center", gap: 18 } },
      h(
        "div",
        {
          style: {
            width: 56,
            height: 56,
            borderRadius: 14,
            backgroundColor: COLOR_BRAND,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 32,
            lineHeight: 1,
          },
        },
        "✏️",
      ),
      h(
        "div",
        {
          style: {
            fontSize: 30,
            fontWeight: 700,
            letterSpacing: "-0.01em",
            display: "flex",
          },
        },
        "УчЛист",
      ),
    ),
  );

  children.push(
    h(
      "div",
      {
        key: "heading",
        style: {
          display: "flex",
          flexDirection: "column",
          marginTop: "auto",
          marginBottom: "auto",
          maxWidth: "100%",
        },
      },
      h(
        "div",
        {
          style: {
            fontSize: TITLE_SIZE,
            fontWeight: 700,
            lineHeight: 1.05,
            letterSpacing: "-0.025em",
            display: "flex",
          },
        },
        title,
      ),
      h(
        "div",
        {
          style: {
            fontSize: 64,
            fontWeight: 400,
            color: COLOR_SUBTLE,
            marginTop: 18,
            display: "flex",
          },
        },
        subtitle,
      ),
    ),
  );

  children.push(
    h(
      "div",
      { key: "badges", style: { display: "flex", flexWrap: "wrap", gap: 12, marginTop: 36 } },
      badges.map((b) =>
        h(
          "div",
          {
            key: b,
            style: {
              display: "flex",
              alignItems: "center",
              padding: "10px 18px",
              backgroundColor: "rgba(34, 179, 124, 0.18)",
              color: COLOR_BRAND,
              fontSize: 22,
              fontWeight: 700,
              borderRadius: 999,
              border: `2px solid ${COLOR_BRAND}`,
              letterSpacing: "-0.01em",
            },
          },
          b,
        ),
      ),
    ),
  );

  children.push(
    h(
      "div",
      {
        key: "url",
        style: {
          position: "absolute",
          right: 80,
          bottom: 36,
          fontSize: 22,
          fontWeight: 400,
          color: COLOR_SUBTLE,
          display: "flex",
          letterSpacing: "-0.005em",
        },
      },
      "uchlist.ru",
    ),
  );

  return h(
    "div",
    {
      style: {
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: COLOR_BG_FROM,
        backgroundImage: `linear-gradient(135deg, ${COLOR_BG_FROM} 0%, ${COLOR_BG_MID} 55%, ${COLOR_BG_TO} 100%)`,
        padding: "64px 80px 56px",
        fontFamily: "Inter",
        color: COLOR_WHITE,
        position: "relative",
      },
    },
    children,
  );
}

/* ── рендер ─────────────────────────────────────────────────────────── */

/**
 * Рендерит PNG через satori+resvg-wasm (тот же стек, что Edge route).
 *
 * В отличие от `generate-og-images.mjs` НЕ пережимаем в палитру 256 цветов.
 * На 135°-градиенте дизеринг палитры вырисовывает заметную тёмную полосу у
 * левого края — на карточке 1200×630 она видна глазом, а такая картинка
 * уходит в соцсети и мессенджеры. Лишние 13 КБ на файл того не стоят.
 */
async function renderPng(element) {
  const fonts = loadFonts();
  const res = new ImageResponse(element, {
    ...SIZE,
    fonts: [
      { name: "Inter", data: fonts.regular, weight: 400, style: "normal" },
      { name: "Inter", data: fonts.bold, weight: 700, style: "normal" },
    ],
  });
  const raw = Buffer.from(await res.arrayBuffer());
  return sharp(raw).png({ compressionLevel: 9 }).toBuffer();
}

mkdirSync(OG_DIR, { recursive: true });

for (const card of CARDS) {
  const out = resolve(OG_DIR, `compare-${card.slug}.png`);
  const png = await renderPng(OgCard(card));
  writeFileSync(out, png);
  console.log(`  ✓ public/og/compare-${card.slug}.png  ${(png.length / 1024).toFixed(1)} KB`);
}

console.log(`\nOG_COMPARE_OK: ${CARDS.length} карточек`);