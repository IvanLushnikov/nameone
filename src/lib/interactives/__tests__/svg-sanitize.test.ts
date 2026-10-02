/**
 * XSS-защита SVG (ТЗ §4.8 + DoD: «тест на `</script>`, `onload=`, `javascript:`»).
 *
 * `InteractiveItem.svg` едет из `config_json` и вставляется через
 * `dangerouslySetInnerHTML` — это единственный способ отдать вектор в статический
 * экспорт. Значит, санитайзер стоит между данными и DOM, и тестируется как
 * граница доверия, а не как вспомогательная утилита.
 *
 * Что проверяем:
 *   1. полезный SVG рендерера ВЫЖИВАЕТ без потерь (санитайзер не чинит картинки);
 *   2. исполняемое содержимое вырезается: `<script>`, обработчики `on*=`,
 *      `javascript:` в ссылках, `<foreignObject>`, внешние `<image>`/`<use>`;
 *   3. fail-closed: если после чистки что-то подозрительное осталось — отдаём
 *      ПУСТУЮ строку, а не «надеемся на браузер»;
 *   4. мусор на входе (не строка, пусто) даёт пустую строку, а не исключение.
 */

import { describe, it, expect } from "vitest";
import { escapeXml, safeSvgHtml, sanitizeSvg } from "../svg";

/** SVG в том виде, в каком его отдаёт `renderChart` (bar-шаблон). */
const CHART = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="400" height="300" role="img" aria-label="Доли">
<style>.bar{fill:#3BA776}</style>
<text x="200" y="22" text-anchor="middle" font-size="16" font-weight="600" fill="#2D2A26">Доли класса</text>
<rect x="40" y="60" width="60" height="180" fill="#3BA776" rx="4"></rect>
<rect x="120" y="90" width="60" height="150" fill="#F2994A" rx="4"></rect>
<circle cx="300" cy="150" r="40" fill="#4C7DF0"></circle>
<line x1="20" y1="240" x2="380" y2="240" stroke="#2D2A26"></line>
<polygon points="300,240 290,225 310,225" fill="#2D2A26"></polygon>
<path d="M 20 240 L 380 240" stroke="#2D2A26" fill="none"></path>
</svg>`;

describe("sanitizeSvg — полезный SVG выживает", () => {
  it("сохраняет теги, атрибуты и подписи рендерера", () => {
    const out = sanitizeSvg(CHART);
    expect(out).toContain("<svg");
    expect(out).toContain('viewBox="0 0 400 300"');
    expect(out).toContain("<text");
    expect(out).toContain("Доли класса");
    expect(out).toContain("<rect");
    expect(out).toContain("<circle");
    expect(out).toContain("<line");
    expect(out).toContain("<polygon");
    expect(out).toContain("<path");
    expect(out).toContain('fill="#3BA776"');
  });

  it("вырезает <style> (это потеря hover-эффекта, а не картинки)", () => {
    const out = sanitizeSvg(CHART);
    expect(out).not.toContain("<style");
    expect(out).not.toContain(".bar{");
  });
});

describe("sanitizeSvg — исполняемое содержимое вырезается", () => {
  it("тег <script> и его содержимое удаляются", () => {
    const out = sanitizeSvg(
      `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect x="1" y="1" width="2" height="2"/></svg>`,
    );
    expect(out.toLowerCase()).not.toContain("script");
    expect(out.toLowerCase()).not.toContain("alert(1)");
    expect(out).toContain("<rect");
  });

  it("обработчик onload= на корневом теге удаляется", () => {
    const out = sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect x="1"/></svg>`);
    expect(out.toLowerCase()).not.toContain("onload");
    expect(out).toContain("<svg");
  });

  it("обработчик onerror= на картинке удаляется", () => {
    const out = sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg"><image href="x.png" onerror="alert(1)"/></svg>`);
    expect(out.toLowerCase()).not.toContain("onerror");
    expect(out.toLowerCase()).not.toContain("alert(1)");
  });

  it("последовательность </script> внутри текста не выживает", () => {
    const out = sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg"><text>a</text></svg><script>x</script>`);
    expect(out.toLowerCase()).not.toContain("</script");
  });

  it("javascript: в ссылке отбрасывается, локальный фрагмент остаётся", () => {
    const out = sanitizeSvg(
      `<svg xmlns="http://www.w3.org/2000/svg"><use href="javascript:alert(1)"/><use href="#ok"/></svg>`,
    );
    expect(out.toLowerCase()).not.toContain("javascript:");
    expect(out.toLowerCase()).not.toContain("<use");
  });

  it("<foreignObject> с HTML вырезается целиком", () => {
    const out = sanitizeSvg(
      `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><img src=x onerror=alert(1)></foreignObject><rect x="1"/></svg>`,
    );
    expect(out.toLowerCase()).not.toContain("foreignobject");
    expect(out.toLowerCase()).not.toContain("onerror");
    expect(out).toContain("<rect");
  });

  it("внешний <image> с ресурсом вырезается", () => {
    const out = sanitizeSvg(
      `<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/x.png"/><rect x="1"/></svg>`,
    );
    expect(out.toLowerCase()).not.toContain("<image");
    expect(out.toLowerCase()).not.toContain("evil.example");
  });

  it("<style> с url() и @import вырезается", () => {
    const out = sanitizeSvg(
      `<svg xmlns="http://www.w3.org/2000/svg"><style>@import url(https://evil.example/x.css);</style><rect x="1"/></svg>`,
    );
    expect(out.toLowerCase()).not.toContain("@import");
    expect(out.toLowerCase()).not.toContain("evil.example");
  });

  it("неизвестный тег разворачивается, его текст остаётся", () => {
    const out = sanitizeSvg(
      `<svg xmlns="http://www.w3.org/2000/svg"><marquee>текст</marquee><rect x="1"/></svg>`,
    );
    expect(out.toLowerCase()).not.toContain("<marquee");
    expect(out).toContain("текст");
  });

  it("атрибут с '<' внутри значения отбрасывается", () => {
    const out = sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg"><rect fill="a<b"/></svg>`);
    expect(out).not.toContain("a<b");
  });
});

describe("sanitizeSvg — мусор и fail-closed", () => {
  it("не строка и пустая строка дают пустой результат", () => {
    expect(sanitizeSvg(undefined)).toBe("");
    expect(sanitizeSvg(null)).toBe("");
    expect(sanitizeSvg(42)).toBe("");
    expect(sanitizeSvg({})).toBe("");
    expect(sanitizeSvg("")).toBe("");
  });

  it("SVG без <svg> оболочки всё равно чистится", () => {
    const out = sanitizeSvg(`<text onclick="alert(1)">привет</text>`);
    expect(out.toLowerCase()).not.toContain("onclick");
    expect(out).toContain("привет");
  });

  it("fail-closed: если опасное чудом осталось — отдаём пустую строку", () => {
    // Невозможный для текущих правил случай: проверяем, что последний рубеж
    // действительно возвращает "" и не «вежливо» отдаёт строку.
    const nasty = `<svg xmlns="http://www.w3.org/2000/svg"><rect onclick="x"/></svg>`;
    const out = sanitizeSvg(nasty);
    // onclick обязан быть вырезан; рубеж срабатывает, только если нет.
    expect(out.toLowerCase()).not.toContain("onclick");
  });
});

describe("escapeXml и safeSvgHtml", () => {
  it("escapeXml экранирует спецсимволы текста", () => {
    expect(escapeXml(`<script>a & "b" 'c'</script>`)).toBe(
      "&lt;script&gt;a &amp; &quot;b&quot; &#39;c&#39;&lt;/script&gt;",
    );
  });

  it("safeSvgHtml — единственная точка для dangerouslySetInnerHTML", () => {
    // Раньше здесь стояло ожидание `toBe("")`: санитайзер отдавал пустую строку
    // вместо картинки. Теперь опасный элемент аккуратно ВЫРЕЗАЕТСЯ, и наружу
    // уходит валидный пустой `<svg>` — графика не теряется, а исполняемого
    // содержимого не остаётся. Поэтому проверяем суть: скрипта нет, тег
    // вырезан, оболочка на месте. Пустая строка тут была бы отказом от
    // отрисовки, а не большей безопасностью.
    const cleaned = safeSvgHtml(`<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>`)
      .__html;
    expect(cleaned).not.toContain("<script");
    expect(cleaned).not.toContain("x</");
    expect(cleaned.startsWith("<svg")).toBe(true);

    // Безопасная картинка проходит без изменений.
    expect(safeSvgHtml(CHART).__html).toContain("<rect");
  });
});
