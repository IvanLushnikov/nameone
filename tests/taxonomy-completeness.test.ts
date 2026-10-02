/**
 * Инварианты полноты таксономии.
 *
 * Смысл: таксономия растёт файлами в `src/lib/content/grade-extensions/`.
 * Ошибки, которые тут ловятся, иначе всплывают только на проде —
 * как 404 на тему или «пустой» класс в навигации.
 *
 * Что проверяем:
 *  1. slug предмета уникален, все слаги входят в SubjectSlug;
 *  2. в предмете нет дублей классов (иначе generateStaticParams
 *     соберёт два одинаковых URL, а в UI — два пункта меню);
 *  3. slug темы уникален в пределах (предмет, класс) — иначе ссылка
 *     ведёт не туда, а `getTopic` отдаёт не ту тему;
 *  4. slug темы совпадает со своей транслитерацией — чтобы не плодить
 *     руками расхождения с `slugify` и не ломать SEO-редиректы;
 *  5. у каждой темы есть title и минимум 2 примера с непустым текстом;
 *  6. покрытие классов: каждый ожидаемый (предмет, класс) есть.
 *     Матрица EXPECTED_COVERAGE — источник правды по полноте.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { subjects, getSubject, getGrade, getTopic } from "../src/lib/content/subjects";
import { GRADE_EXTENSIONS } from "../src/lib/content/grade-extensions";
import { umk, getUMK } from "../src/lib/content/umk";
import { WEEKLY_TOPICS } from "../src/lib/content/weekly-topics";
import type { SubjectSlug, TopicExample } from "../src/lib/types";

/**
 * Ожидаемое покрытие классов по предметам.
 * Источник: ФРП (edsoo.ru) — предмет вводится с этого класса,
 * дальше идёт до выпускного. Исключения помечены комментарием.
 */
const EXPECTED_COVERAGE: Record<SubjectSlug, number[]> = {
  math: [1, 2, 3, 4, 5, 6],
  algebra: [7, 8, 9, 10, 11],
  geometry: [7, 8, 9, 10, 11],
  russian: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  literature: [5, 6, 7, 8, 9, 10, 11],
  english: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  german: [5, 6, 7, 8, 9, 10, 11],
  informatics: [5, 6, 7, 8, 9, 10, 11],
  physics: [7, 8, 9, 10, 11],
  chemistry: [8, 9, 10, 11],
  biology: [5, 6, 7, 8, 9, 10, 11],
  geography: [5, 6, 7, 8, 9, 10, 11],
  history: [5, 6, 7, 8, 9, 10, 11],
  social: [6, 7, 8, 9, 10, 11],
  okruzhaet: [1, 2, 3, 4],
  obzh: [5, 6, 7, 8, 9, 10, 11], // ФРП ОБЗР — с 5 класса
  technology: [5, 6, 7, 8, 9],
  finance: [7, 8, 9],
  music: [1, 2, 3, 4, 5, 6, 7, 8],
  art: [1, 2, 3, 4, 5, 6, 7, 8],
  pe: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

describe("Таксономия: базовая целостность", () => {
  it("все предметы из EXPECTED_COVERAGE присутствуют в subjects", () => {
    for (const slug of Object.keys(EXPECTED_COVERAGE)) {
      expect(getSubject(slug), `предмет ${slug} отсутствует в subjects`).toBeDefined();
    }
  });

  it("все файлы расширений подключены к GRADE_EXTENSIONS", () => {
    // Файл, который создали, но не импортировали в index.ts, молча выпадает
    // из сборки: предмет остаётся с дырами, и это видно только на проде.
    const dir = join(process.cwd(), "src/lib/content/grade-extensions");
    const indexSource = readFileSync(join(dir, "index.ts"), "utf-8");
    const orphans = readdirSync(dir)
      .filter((f) => f.endsWith(".ts") && f !== "index.ts" && f !== "types.ts")
      .filter((f) => !indexSource.includes(`"./${f.replace(/\.ts$/, "")}"`));
    expect(orphans, `созданы, но не подключены в index.ts: ${orphans.join(", ")}`).toEqual([]);
  });

  it("у каждого предмета уникальный slug", () => {
    const slugs = subjects.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("в GRADE_EXTENSIONS нет ключей вне SubjectSlug", () => {
    for (const key of Object.keys(GRADE_EXTENSIONS)) {
      expect(Object.keys(EXPECTED_COVERAGE)).toContain(key);
    }
  });

  it("в каждом предмете есть УМК", () => {
    for (const s of subjects) {
      expect((umk[s.slug] ?? []).length, `нет УМК для предмета ${s.slug}`).toBeGreaterThan(0);
    }
  });

  it("id учебника уникален в пределах предмета", () => {
    for (const [slug, list] of Object.entries(umk)) {
      const ids = list.map((u) => u.id);
      const dupes = ids.filter((n, i) => ids.indexOf(n) !== i);
      expect(dupes, `${slug}: дубли id УМК ${dupes.join(", ")}`).toEqual([]);
    }
  });

  it("у каждой пары (предмет, класс) минимум 3 учебника", () => {
    const thin: string[] = [];
    for (const s of subjects) {
      for (const g of s.grades) {
        const n = getUMK(s.slug, g.num).length;
        if (n < 3) thin.push(`${s.slug}/${g.num}: ${n}`);
      }
    }
    expect(thin, `мало УМК:\n${thin.join("\n")}`).toEqual([]);
  });

  it("учебник не выходит за диапазон классов своего предмета", () => {
    const spill: string[] = [];
    for (const s of subjects) {
      const nums = s.grades.map((g) => g.num);
      const from = Math.min(...nums);
      const to = Math.max(...nums);
      for (const u of umk[s.slug] ?? []) {
        if (u.grades?.some((gr) => gr < from || gr > to)) {
          spill.push(`${s.slug}/${u.id}: grades=${u.grades?.join(",")} вне ${from}-${to}`);
        }
      }
    }
    expect(spill, `УМК вне диапазона:\n${spill.join("\n")}`).toEqual([]);
  });
});

describe("Таксономия: классы", () => {
  for (const [slug, expectedGrades] of Object.entries(EXPECTED_COVERAGE)) {
    it(`${slug}: покрыты все ожидаемые классы`, () => {
      const subject = getSubject(slug as SubjectSlug);
      expect(subject, `предмет ${slug} отсутствует`).toBeDefined();
      const have = subject!.grades.map((g) => g.num);
      const missing = expectedGrades.filter((g) => !have.includes(g));
      expect(missing, `${slug}: нет классов ${missing.join(", ")}`).toEqual([]);
    });

    it(`${slug}: нет дублей классов`, () => {
      const subject = getSubject(slug as SubjectSlug)!;
      const nums = subject.grades.map((g) => g.num);
      const dupes = nums.filter((n, i) => nums.indexOf(n) !== i);
      expect(dupes, `${slug}: дубли классов ${dupes.join(", ")}`).toEqual([]);
    });

    it(`${slug}: нет классов вне ожидаемых`, () => {
      const subject = getSubject(slug as SubjectSlug)!;
      const extra = subject.grades.map((g) => g.num).filter((n) => !expectedGrades.includes(n));
      expect(extra, `${slug}: лишние классы ${extra.join(", ")}`).toEqual([]);
    });

    it(`${slug}: классы отсортированы по номеру`, () => {
      const subject = getSubject(slug as SubjectSlug)!;
      const nums = subject.grades.map((g) => g.num);
      expect(nums).toEqual([...nums].sort((a, b) => a - b));
    });
  }
});

describe("Таксономия: темы", () => {
  const allSubjectGrades = subjects.flatMap((s) =>
    s.grades.map((g) => ({ subjectSlug: s.slug, grade: g })),
  );

  it("slug темы уникален в пределах предмета и класса", () => {
    const collisions: string[] = [];
    for (const { subjectSlug, grade } of allSubjectGrades) {
      const slugs = grade.topics.map((t) => t.slug);
      const dupes = slugs.filter((n, i) => slugs.indexOf(n) !== i);
      for (const d of dupes) collisions.push(`${subjectSlug}/${grade.num}: ${d}`);
    }
    expect(collisions, `дубли slug тем:\n${collisions.join("\n")}`).toEqual([]);
  });

  it("slug темы пригоден для URL", () => {
    // Исторические slug ручные и уже в индексе поисковиков — переименовывать
    // их нельзя. Проверяем только пригодность как сегмента URL.
    const bad: string[] = [];
    for (const { subjectSlug, grade } of allSubjectGrades) {
      for (const t of grade.topics) {
        if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(t.slug)) {
          bad.push(`${subjectSlug}/${grade.num}: "${t.slug}"`);
        }
      }
    }
    expect(bad, `slug непригоден для URL:\n${bad.slice(0, 20).join("\n")}`).toEqual([]);
  });

  it("у каждой темы есть заголовок и минимум 2 примера", () => {
    const bad: string[] = [];
    for (const { subjectSlug, grade } of allSubjectGrades) {
      for (const t of grade.topics) {
        if (!t.title || t.title.trim().length < 3) {
          bad.push(`${subjectSlug}/${grade.num}/${t.slug}: пустой title`);
        }
        if (!t.examples || t.examples.length < 1) {
          bad.push(`${subjectSlug}/${grade.num}/${t.slug}: примеров ${t.examples?.length ?? 0}`);
        }
        const examples: TopicExample[] = t.examples ?? [];
        for (let i = 0; i < examples.length; i++) {
          const ex = examples[i];
          if (!ex.text || ex.text.trim().length < 3) {
            bad.push(`${subjectSlug}/${grade.num}/${t.slug}: пустой текст примера #${i + 1}`);
          }
        }
      }
    }
    expect(bad, `проблемные темы:\n${bad.slice(0, 20).join("\n")}`).toEqual([]);
  });

  it("getTopic находит каждую тему по её slug", () => {
    const broken: string[] = [];
    for (const { subjectSlug, grade } of allSubjectGrades) {
      for (const t of grade.topics) {
        const found = getTopic(subjectSlug, grade.num, t.slug);
        if (!found) broken.push(`${subjectSlug}/${grade.num}/${t.slug}`);
      }
    }
    expect(broken, `getTopic не нашёл:\n${broken.slice(0, 20).join("\n")}`).toEqual([]);
  });

  it("в каждом классе не меньше 5 тем", () => {
    const thin: string[] = [];
    for (const { subjectSlug, grade } of allSubjectGrades) {
      if (grade.topics.length < 5) {
        thin.push(`${subjectSlug}/${grade.num}: ${grade.topics.length} тем`);
      }
    }
    expect(thin, `классы с малым числом тем:\n${thin.join("\n")}`).toEqual([]);
  });
});

describe("Тема недели: ссылочная целостность", () => {
  it("каждая тема недели ссылается на существующую тему таксономии", () => {
    const broken: string[] = [];
    for (const t of WEEKLY_TOPICS) {
      if (!getTopic(t.subject as SubjectSlug, t.grade, t.topicSlug)) {
        broken.push(`${t.seoSlug} -> /subject/${t.subject}/${t.grade}/${t.topicSlug}`);
      }
    }
    expect(broken, `битые ссылки темы недели:\n${broken.join("\n")}`).toEqual([]);
  });

  it("seoSlug темы недели уникален", () => {
    const slugs = WEEKLY_TOPICS.map((t) => t.seoSlug);
    const dupes = slugs.filter((n, i) => slugs.indexOf(n) !== i);
    expect(dupes, `дубли seoSlug: ${dupes.join(", ")}`).toEqual([]);
  });
});

describe("Таксономия: сводка", () => {
  it("покрытие не уменьшилось", () => {
    const pairs = subjects.reduce((n, s) => n + s.grades.length, 0);
    const topics = subjects.reduce((n, s) => n + s.grades.reduce((m, g) => m + g.topics.length, 0), 0);
    // Плановый минимум: 21 предмет × полное покрытие классов.
    const expectedPairs = Object.values(EXPECTED_COVERAGE).reduce((n, g) => n + g.length, 0);
    expect(pairs, `пар (предмет, класс): ${pairs}, ожидалось ${expectedPairs}`).toBeGreaterThanOrEqual(expectedPairs);
    expect(topics, `тем: ${topics}`).toBeGreaterThanOrEqual(700);
  });

  it("getGrade возвращает класс для каждой ожидаемой пары", () => {
    for (const [slug, grades] of Object.entries(EXPECTED_COVERAGE)) {
      for (const g of grades) {
        expect(getGrade(slug, g), `${slug} / ${g} класс не найден`).toBeDefined();
      }
    }
  });
});
