/**
 * Критерий 10 плана: окончания числительных в пользовательских текстах.
 *
 * Жалоба учительницы (дословно): «21 предметов», «94 комбинации» —
 * «Если это типа как названия просто и цифры будут меняться, то ок.
 * Если всегда будет это фактическое число, то окончания надо другие».
 *
 * Числа тут СЧЁТЧИК из таксономии и меняются (мы это видели: 469 → 1029 тем,
 * пока параллельный агент расширял каталог). Значит окончания обязаны
 * считаться, а не быть зашитой строкой.
 *
 * ЧТО ЛОВИТ ТЕСТ. Окончание чаще всего зашивают в разметку или — что хуже —
 * в SEO-строку, которая уезжает в title/description и в выдачу поисковика.
 * Поэтому проверяем не только видимый текст, но и метаданные.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { plural } from "@/lib/utils/cn";

const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("склонение числительных (критерий 10)", () => {
  it("plural() даёт верные формы на контрольных числах", () => {
    expect(plural(1, "предмет", "предмета", "предметов")).toBe("предмет");
    expect(plural(2, "предмет", "предмета", "предметов")).toBe("предмета");
    expect(plural(5, "предмет", "предмета", "предметов")).toBe("предметов");
    // 21 — число, оканчивающееся на 1, но не на 11: единственное число.
    expect(plural(21, "предмет", "предмета", "предметов")).toBe("предмет");
    expect(plural(101, "предмет", "предмета", "предметов")).toBe("предмет");
    expect(plural(11, "предмет", "предмета", "предметов")).toBe("предметов");
    expect(plural(14, "предмет", "предмета", "предметов")).toBe("предметов");
    expect(plural(94, "комбинация", "комбинации", "комбинаций")).toBe("комбинации");
    expect(plural(469, "тема", "темы", "тем")).toBe("тем");
  });

  const pages = [
    "src/app/subject/page.tsx",
    "src/app/subject/[subject]/page.tsx",
    "src/app/subject/[subject]/[grade]/page.tsx",
    "src/app/ktp/[subject]/[grade]/page.tsx",
    "src/components/landing/Subjects.tsx",
    "src/components/landing/Stats.tsx",
  ];

  /**
   * Вырезаем вызовы plural(...) целиком: иначе проверка находит слова
   * «предметов»/«тем» в аргументах самого хелпера и падает на правильном коде.
   *
   * ВАЖНО про `\b`: в JavaScript граница слова — ASCII, поэтому `\b` после
   * кириллицы НЕ срабатывает и проверка `not.toMatch(/тем\b/)` не может
   * упасть в принципе. Отсюда — «вакуумный» тест, который всегда зелёный.
   * Поэтому разделителем слова ставим ЯВНЫЙ класс символов, а не `\b`.
   */
  const strip = (src: string) =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/plural\s*\((?:[^()]|\([^()]*\))*\)/g, "PLURAL()");

  /** «тем» считаем отдельным словом, если дальше не буква и не дефис-согласование. */
  const wordEnd = '(?![а-яёa-z])';

  it.each(pages)("%s склоняет через plural(), а не зашитой строкой", (file) => {
    const code = strip(read(file));

    // Шаблонная строка: `${n} тем` / `${n} предметов`
    expect(code, `${file}: «\${n} предметов» в шаблонной строке`).not.toMatch(
      new RegExp(`\\$\\{[^}]+\\}\\s*(предметов|тем|классов|комбинаций)${wordEnd}`),
    );
    // JSX-текст: `} тем` / `}&nbsp;тем` / `} тем по ФГОС`
    expect(code, `${file}: «}} тем» в JSX-тексте`).not.toMatch(
      new RegExp(`\\}\\s*(?:&nbsp;|\\xa0)?\\s*(предметов|тем|классов)${wordEnd}`),
    );
  });

  it("проверка действительно может упасть (защита от вакуумного теста)", () => {
    // Самопроверка регулярки: если бы мы оставили `\b`, эти expect'ы прошли бы
    // бы на ЛЮБОМ коде. Здесь мы убеждаемся, что паттерн ловит настоящий хардкод.
    const bad = 'const x = `${n} тем`; const y = <b>{n} тем</b>;';
    expect(strip(bad)).toMatch(
      new RegExp(`\\$\\{[^}]+\\}\\s*(предметов|тем|классов)${wordEnd}`),
    );
    // …и не ловит правильный код.
    const good = 'const x = `${n} ${plural(n, "тема", "темы", "тем")}`;';
    expect(strip(good)).not.toMatch(
      new RegExp(`\\$\\{[^}]+\\}\\s*(предметов|тем|классов)${wordEnd}`),
    );
  });

  it("нигде в проекте не осталось «Домашка» (критерий 11)", () => {
    // Тот же грабли, что и выше: `\bДомашка\b` НИКОГДА не сматчится,
    // потому что `\b` в JS опирается на ASCII-класс \w, а кириллица туда
    // не входит. Проверяем границы слов явно.
    const slang = /(?<![а-яёa-z])Домашка(?![а-яёa-z])/;
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(rel);
        else if (/\.tsx?$/.test(e.name) && !rel.includes("node_modules")) {
          if (slang.test(read(rel))) hits.push(rel);
        }
      }
    };
    walk("src");
    expect(hits, `«Домашка» осталась в: ${hits.join(", ")}`).toEqual([]);
  });

  it("саморегуляция: та же проверка обязана ловить настоящую находку", () => {
    const slang = /(?<![а-яёa-z])Домашка(?![а-яёa-z])/;
    expect('homework: "6. Домашка"').toMatch(slang);
    expect('homework: "6. Домашнее задание"').not.toMatch(slang);
    // А вот так выглядел бы провалившийся вариант с `\b`:
    expect(/\bДомашка\b/.test('homework: "6. Домашка"')).toBe(false);
  });

  it("SEO-метаданные /subject не содержат «N предметов»", () => {
    const src = read("src/app/subject/page.tsx");
    expect(src).toMatch(/plural\(subjects\.length,/);
    // Строка, которая раньше текла в title и description целиком:
    // `${subjects.length} предметов` — именно её и поймали.
    expect(src).not.toMatch(/\$\{subjects\.length\} предметов/);
  });

  it("на главной («Предметы») тоже склоняется, а не «21 предметов»", () => {
    const src = read("src/components/landing/Subjects.tsx");
    expect(src).toMatch(/plural\(totalCount,/);
  });
});
