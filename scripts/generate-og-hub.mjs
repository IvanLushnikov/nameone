/**
 * Генератор OG-картинки для хаба `/ai-dlya-uchitelya/`.
 *
 * Отдельный скрипт по той же причине, что и `generate-og-compare.mjs`: тот
 * парсит все предметы из `subjects.ts` и перерисовывает 22 карточки, а здесь
 * нужна одна. Шрифты — локальные из `scripts/fonts/`, сети не требуется.
 *
 * Визуально карточка повторяет `OgCard` из `generate-og-compare.mjs`: тот же
 * фон, те же бейджи, тот же бренд — иначе в ленте карточки одного сайта
 * выглядели бы как три разных дизайна.
 *
 * Отличие в содержании бейджей: на сравнениях стояли «цены проверено»,
 * потому что страница живёт месяцами и протухает. Хаб про содержание сайта,
 * протухать ему не с чем, поэтому бейджи называют то, что страница реально
 * собирает: восемь разборов, три сравнения и каталог тем. Все три числа
 * берутся из сборки, а не вписаны на глаз.
 *
 * Запуск: node scripts/generate-og-hub.mjs
 *
 * Выход: public/og/ai-dlya-uchitelya.png
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

// Палитра и размер — те же, что в generate-og-compare.mjs и в Edge route.
const SIZE = { width: 1200, height: 630 };
const COLOR_BG_FROM = "#062C24"; // brand-950
const COLOR_BG_MID = "#105C47";
const COLOR_BG_TO = "#159066"; // brand-600
const COLOR_BRAND = "#22B37C"; // brand-500
const COLOR_WHITE = "#FFFFFF";
const COLOR_SUBTLE = "rgba(255,255,255,0.75)";

// Заголовок короче, чем у предметов, — кегль фиксируем, чтобы карточка хаба
// не отличалась размером от карточек блога и сравнений.
const TITLE_SIZE = 72;

/**
 * Подзаголовок — не рекламное обещание, а содержательный ответ на вопрос
 * учителя, который приводит на эту страницу. «ИИ не ломается» было бы
 * неправдой, а «где ломается» — ровно то, ради чего хаб и читают.
 */
const CARD = {
  slug: "ai-dlya-uchitelya",
  title: "ИИ для учителя",
  subtitle: "где помогает и где ломается",
  badges: ["8 разборов", "3 сравнения", "1075 тем по ФГОС"],
};

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
            fontSize: 48,
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
 * Как и в `generate-og-compare.mjs`, НЕ пережимаем в палитру 256 цветов:
 * на 135°-градиенте дизеринг палитры вырисовывает тёмную полосу у левого
 * края, и на карточке 1200×630 её видно глазом.
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

const out = resolve(OG_DIR, `${CARD.slug}.png`);
const png = await renderPng(OgCard(CARD));
writeFileSync(out, png);
console.log(`  ✓ public/og/${CARD.slug}.png  ${(png.length / 1024).toFixed(1)} KB`);

console.log("\nOG_HUB_OK: 1 карточка");