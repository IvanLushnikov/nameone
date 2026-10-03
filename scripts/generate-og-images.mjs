/**
 * Генератор статических OG-картинок (TZ-10 Этап 3, fallback-вариант B).
 *
 * Edge runtime route `src/app/og/[...slug]/route.tsx` не запустится в
 * `output: "export"` режиме — поэтому при деплое на Cloudflare Pages
 * static-deploy og:image'и должны быть готовыми PNG-файлами.
 *
 * Что делаем:
 *  - Парсим `src/lib/content/subjects.ts` (регуляркой по 4-пробельному
 *    отступу — slug/title на уровне массива subjects), чтобы получить
 *    актуальный список предметов без отдельного JSON.
 *  - Рендерим 22 PNG (1 дефолтный + 21 предмет) через
 *    `next/dist/compiled/@vercel/og/index.node.js` — это тот же satori+resvg-wasm
 *    стек, что использует Edge route, поэтому визуально карточки идентичны.
 *  - Шрифт Inter cyrillic подгружается с jsDelivr (как в Edge route).
 *
 * Запуск: `node scripts/generate-og-images.mjs`
 *
 * Выход: `public/og/default.png` + `public/og/{subject.slug}.png` (22 файла).
 */
import { ImageResponse } from "next/dist/compiled/@vercel/og/index.node.js";
import { createElement as h } from "react";
import { readFileSync, mkdirSync, writeFileSync, statSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SUBJECTS_TS = resolve(ROOT, "src/lib/content/subjects.ts");
const OG_DIR = resolve(ROOT, "public/og");
const FONT_LOCAL_DIR = resolve(__dirname, "fonts");
const FONT_URL_BASE =
  "https://cdn.jsdelivr.net/npm/@fontsource/inter@5.1.0/files";

// ====================== КОНФИГ ======================

const SIZE = { width: 1200, height: 630 };

// Brand palette (как в Edge route, src/app/og/[...slug]/route.tsx).
const COLOR_BG_FROM = "#062C24"; // brand-950
const COLOR_BG_MID = "#105C47";
const COLOR_BG_TO = "#159066"; // brand-600
const COLOR_BRAND = "#22B37C"; // brand-500
const COLOR_WHITE = "#FFFFFF";
const COLOR_SUBTLE = "rgba(255,255,255,0.75)";

// TZ-10 §5.4: единый набор из 3 бейджей на всех карточках.
const BADGES = ["ФГОС 2021", "30 секунд", "PDF с ответами"];

// ====================== ПАРСИНГ ТАКСОНОМИИ ======================

/**
 * Достаём из subjects.ts массив subjects — парой {slug, title} на каждый
 * предмет. Регулярка матчит только `slug`/`title` на 4-пробельном отступе
 * (это уровень полей subject-объекта), игнорируя slug'и тем внутри topics[].
 */
function loadSubjects() {
  const src = readFileSync(SUBJECTS_TS, "utf8");
  const startIdx = src.indexOf("export const subjects:");
  if (startIdx === -1) {
    throw new Error("export const subjects не найден в subjects.ts");
  }
  const block = src.slice(startIdx);
  // 4 пробела перед slug → это уровень полей subject-объекта.
  const regex = /^\s{4}slug:\s*"([^"]+)"\s*,\s*title:\s*"([^"]+)"/gm;
  const subjects = [];
  let m;
  while ((m = regex.exec(block)) !== null) {
    subjects.push({ slug: m[1], title: m[2] });
  }
  if (subjects.length === 0) {
    throw new Error("Не удалось распарсить ни одного subject");
  }
  return subjects;
}

// ====================== ШРИФТ ======================

let _fonts = null;
async function loadFonts() {
  if (_fonts) return _fonts;

  // Сначала пробуем локальные шрифты в scripts/fonts/ (надёжнее и быстрее),
  // если их нет — фоллбэк на jsDelivr CDN (как Edge route).
  const localRegular = resolve(FONT_LOCAL_DIR, "inter-cyrillic-400-normal.woff");
  const localBold = resolve(FONT_LOCAL_DIR, "inter-cyrillic-700-normal.woff");

  let regular, bold;
  if (existsSync(localRegular) && existsSync(localBold)) {
    regular = readFileSync(localRegular);
    bold = readFileSync(localBold);
  } else {
    [regular, bold] = await Promise.all([
      fetch(`${FONT_URL_BASE}/inter-cyrillic-400-normal.woff`).then((r) => {
        if (!r.ok) throw new Error(`Font 400 load failed: ${r.status}`);
        return r.arrayBuffer();
      }),
      fetch(`${FONT_URL_BASE}/inter-cyrillic-700-normal.woff`).then((r) => {
        if (!r.ok) throw new Error(`Font 700 load failed: ${r.status}`);
        return r.arrayBuffer();
      }),
    ]);
  }
  // ImageResponse ждёт ArrayBuffer, у readFileSync — Buffer.
  const toAB = (b) =>
    b instanceof ArrayBuffer ? b : b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);

  _fonts = { regular: toAB(regular), bold: toAB(bold) };
  return _fonts;
}

// ====================== OG-CARD ======================

/**
 * Карточка OG-image — единый макет (default + subject).
 * Поля: brand, title, subtitle?, badges.
 */
function OgCard({ brand, title, subtitle, badges }) {
  // Защита от слишком длинных заголовков (satori сам не переносит).
  const titleSize = title.length > 32 ? 64 : title.length > 22 ? 76 : 88;

  const children = [];

  // === Бренд (верх-лево) ===
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
        brand,
      ),
    ),
  );

  // === Заголовок + подзаголовок (центр) ===
  const heading = [];
  heading.push(
    h(
      "div",
      {
        style: {
          fontSize: titleSize,
          fontWeight: 700,
          lineHeight: 1.05,
          letterSpacing: "-0.025em",
          display: "flex",
        },
      },
      title,
    ),
  );
  if (subtitle) {
    heading.push(
      h(
        "div",
        {
          style: {
            fontSize: 34,
            fontWeight: 400,
            color: COLOR_SUBTLE,
            marginTop: 22,
            display: "flex",
          },
        },
        subtitle,
      ),
    );
  }
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
      heading,
    ),
  );

  // === Бейджи ===
  children.push(
    h(
      "div",
      {
        key: "badges",
        style: {
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          marginTop: 36,
        },
      },
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

  // === URL в правом нижнем ===
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

// ====================== ГЕНЕРАЦИЯ ======================

/**
 * Рендерит PNG через satori+resvg-wasm (тот же стек, что Edge route),
 * затем пережимает через sharp с палитрой 256 цветов — resvg отдаёт
 * несжатый RGBA (~200 KB), sharp с palette даёт ~30-50 KB без видимой
 * потери качества (dithering 0.5 гасит бэндинг градиента).
 */
async function renderPng(element) {
  const fonts = await loadFonts();
  const res = new ImageResponse(element, {
    ...SIZE,
    fonts: [
      { name: "Inter", data: fonts.regular, weight: 400, style: "normal" },
      { name: "Inter", data: fonts.bold, weight: 700, style: "normal" },
    ],
  });
  const raw = Buffer.from(await res.arrayBuffer());
  return sharp(raw)
    .png({
      palette: true,
      colors: 256,
      compressionLevel: 9,
      quality: 90,
      dither: 0.5,
    })
    .toBuffer();
}

/**
 * Карточка для дефолтной страницы (главная).
 */
function defaultCard() {
  return OgCard({
    brand: "УчЛист",
    title: "Рабочие листы по ФГОС за 30 секунд",
    subtitle: "Без регистрации — 3 бесплатно",
    badges: BADGES,
  });
}

/**
 * Карточка для предмета.
 */
function subjectCard({ title }) {
  return OgCard({
    brand: "УчЛист",
    title: `Рабочие листы по ${title.toLowerCase()}`,
    subtitle: "Рабочие листы 1-11 класс по ФГОС 2021",
    badges: BADGES,
  });
}

// ====================== MAIN ======================

async function main() {
  const subjects = loadSubjects();
  mkdirSync(OG_DIR, { recursive: true });

  // Список тасков: default + каждый предмет.
  const tasks = [{ slug: "default", render: defaultCard }].concat(
    subjects.map((s) => ({ slug: s.slug, render: () => subjectCard(s) })),
  );

  const total = tasks.length;
  const sizes = [];
  console.log(`Генерирую ${total} PNG-картинок в public/og/ ...`);

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const element = t.render();
    const buf = await renderPng(element);
    const outPath = resolve(OG_DIR, `${t.slug}.png`);
    writeFileSync(outPath, buf);
    const kb = (buf.length / 1024).toFixed(1);
    sizes.push(buf.length);
    console.log(`[${i + 1}/${total}] ${t.slug}.png  ${kb} KB`);
  }

  const minKb = (Math.min(...sizes) / 1024).toFixed(1);
  const maxKb = (Math.max(...sizes) / 1024).toFixed(1);
  console.log(`\nГотово: ${total} файлов в ${OG_DIR}`);
  console.log(`Размер: ${minKb} — ${maxKb} KB`);

  // Sanity check: файлы должны существовать.
  for (const t of tasks) {
    const p = resolve(OG_DIR, `${t.slug}.png`);
    const st = statSync(p);
    if (!st.isFile() || st.size === 0) {
      throw new Error(`Файл не создан или пустой: ${p}`);
    }
  }
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  console.error(e.stack);
  process.exit(1);
});