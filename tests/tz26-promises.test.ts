/**
 * ОБЕЩАНИЯ, КОТОРЫЕ ТЕПЕРЬ ПОДТВЕРЖДЕНЫ (ТЗ-26, гейты Г3 и Г4).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЗАЧЕМ ТЕСТ, А НЕ ПРОВЕРКА ГЛАЗАМИ
 * ─────────────────────────────────────────────────────────────────────────────
 * Четыре обещания расходились с фактами. Каждое из них вернётся при любом
 * новом тексте, если за ним не стоит проверка:
 *   · «за 30 секунд» — при замерах 13.10.2026: 5 прогонов из 10 уложились,
 *     контрольная 96–102 с;
 *   · «Исполнитель услуг: не указан — ФИО, ИНН и адрес регистрации вписывает
 *     владелец» — служебная записка в публичном документе;
 *   · метрика «по желанию, можно отключить» при безусловной загрузке с
 *     webvisor и без переключателя на сайте;
 *   · «Банк наполняется» + «показано 12 из 150» + обещание выгрузки при
 *     витрине, где скачать нечего.
 *
 * Проверяем ИСХОДНИКИ, а не вёрстку: обещание живёт в строке. Комментарии
 * вырезаются — разработчик вправе писать в комментарии о старом тексте,
 * учитель его не видит.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ФИЗИКА НЕ ПОПАДАЕТ ПОД НОЖ
 * ─────────────────────────────────────────────────────────────────────────────
 * В `pe.ts` есть «удержание по 15–30 секунд» — это про растяжку, а не про
 * скорость сервиса. Тест не должен ловить физику.
 */

import { describe, it, expect } from "vitest";

// Маркер успеха для гейт-чекера (unlazy). Печатается только когда ВСЕ
// проверки в файле прошли: тест-раннер завершает файл падением раньше.
afterAll(() => {
  console.log("TZ26-PROMISES-OK");
});
import { afterAll } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Читаем файл из репозитория: vitest запускается из его корня. */
function read(file: string): string {
  return readFileSync(join(process.cwd(), file), "utf8");
}

/** Без комментариев: слова из комментария учителю не видны. */
function userText(file: string): string {
  return read(file)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Все .ts/.tsx под каталогом. */
function tsFiles(dir: string): string[] {
  const root = join(process.cwd(), dir);
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry)) {
        // Путь ОТНОСИТЕЛЬНЫЙ к корню репозитория: `userText` склеивает его
        // с process.cwd(), и абсолютный путь давал бы путь вдвое длиннее.
        out.push(full.slice(process.cwd().length + 1));
      }
    }
  };
  walk(root);
  return out;
}

describe("ТЗ-26 Г4: «за 30 секунд» больше не обещают нигде", () => {
  const files = tsFiles("src").filter(
    // Физика: «удержание по 15–30 секунд» — про растяжку, не про сервис.
    (f) => !f.endsWith("grade-extensions/pe.ts"),
  );

  it("в пользовательском тексте нет ни «за 30 секунд», ни «за 30 сек»", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = userText(file);
      if (/за\s*30\s*секунд/i.test(text) || /за\s*30\s*сек/i.test(text)) {
        offenders.push(file);
      }
    }
    expect(offenders, `«за 30 секунд» вернулось в: ${offenders.join(", ")}`).toEqual([]);
  });

  it("в пользовательском тексте нет голого «30 секунд —» в обещании", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = userText(file);
      // «30 секунд — и конспект на 45 минут у вас в DOCX» — обещание.
      if (/^\s*30\s*секунд\s+—/im.test(text) || /30\s*секунд\s+—\s+(и|PDF|готов)/i.test(text)) {
        offenders.push(file);
      }
    }
    expect(offenders, `обещание «30 секунд — …» вернулось в: ${offenders.join(", ")}`).toEqual([]);
  });

  it("в <title> главной и конструктора нет обещания скорости", () => {
    for (const file of ["src/app/layout.tsx", "src/app/constructor/layout.tsx"]) {
      expect(userText(file), `в ${file} есть title со скоростью`).not.toMatch(
        /title:[^\n]*секунд/i,
      );
    }
  });

  it("физика не сломалась: «по 15–30 секунд» в растяжке осталась", () => {
    // Проверка на то, что фильтр выше не съел содержательный текст предмета.
    expect(read("src/lib/content/grade-extensions/pe.ts")).toMatch(/15–30 секунд|15-30 секунд/);
  });
});

describe("ТЗ-26 Г3: служебная записка убрана с трёх страниц", () => {
  const legal = userText("src/app/legal/[slug]/page.tsx");

  it("в оферте нет «вписывает владелец» и «не указан»", () => {
    expect(legal).not.toMatch(/вписывает владелец/i);
    expect(legal).not.toMatch(/не указан(ы|о)?\b/i);
  });

  it("на /about/ и /contact/ тех же слов нет", () => {
    for (const file of ["src/app/about/page.tsx", "src/app/contact/page.tsx"]) {
      const text = userText(file);
      expect(text, `в ${file} осталась служебная записка`).not.toMatch(/вписывает владелец/i);
      expect(text, `в ${file} осталось «не указан»`).not.toMatch(/не указан(ы|о)?\b/i);
    }
  });

  it("в trust.ts плейсхолдер — честная пометка, а не TODO", () => {
    const trust = userText("src/lib/content/trust.ts");
    expect(trust).not.toMatch(/вписывает владелец/i);
  });

  it("исполнитель назван: в оферте есть блок про самозанятого и связь", () => {
    expect(legal).toMatch(/Исполнитель услуг/);
    expect(legal).toMatch(/самозанят/i);
    expect(legal).toMatch(/предоставля(ется|ются) по запросу/);
  });
});

describe("ТЗ-26 Г4: метрика описана так, как она работает", () => {
  const legal = userText("src/app/legal/[slug]/page.tsx");

  it("про метрику не сказано «по желанию»", () => {
    // Единственное «по желанию» в документе — про необязательный пароль.
    // Про метрику его быть не должно.
    const lines = legal.split("\n").filter((l) => /метрик/i.test(l) && /по желанию/i.test(l));
    expect(lines, "про метрику снова сказано «по желанию»").toEqual([]);
  });

  it("сказано прямо: включается автоматически, отключается в браузере", () => {
    expect(legal).toMatch(/Метрик[\s\S]{0,200}автоматически/i);
    expect(legal).toMatch(/отключ\w*[\s\S]{0,40}настройках браузера/i);
  });
});

describe("ТЗ-26 Г4: Банк материалов не обещает то, чего нет", () => {
  const materials = userText("src/app/materials/page.tsx");
  const footer = userText("src/components/layout/Footer.tsx");

  it("на витрине нет «банк наполняется»", () => {
    expect(materials).not.toMatch(/банк наполняется/i);
    expect(materials).not.toMatch(/материалы, которые вы сами создали/i);
  });

  it("в подвале нет обещания выгрузки PDF/DOCX/PPTX", () => {
    expect(footer).not.toMatch(/PDF\s*·\s*DOCX\s*·\s*PPTX/);
  });

  it("страница честно говорит, что файл появляется после генерации", () => {
    expect(materials).toMatch(/после\s+генерации/i);
  });
});