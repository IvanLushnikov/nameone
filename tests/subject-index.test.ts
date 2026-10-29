/**
 * Сводка таксономии (`subject-index.json`) не должна разойтись с таксономией.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЗАЧЕМ ТЕСТ
 * ─────────────────────────────────────────────────────────────────────────────
 * `src/lib/content/subject-index.json` — лёгкая сводка, по которой главная
 * показывает число тем и названия предметов. Считается из `subjects.ts`
 * скриптом `scripts/build-subject-index.mjs`, чтобы цифры на сайте были
 * настоящими, а не вписанными руками.
 *
 * Но сгенерированный файл — это ВТОРОЕ место, где живёт информация о
 * таксономии. Как только он расходится с оригиналом, на главной начинает
 * врать: «5 492 темы» при реальных 5 500, или карточка предмета ведёт на
 * несуществующую тему.
 *
 * Тест ловит это на CI — до того, как враньё доедет до учителя.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ПРОВЕРЯЕМ
 * ─────────────────────────────────────────────────────────────────────────────
 *  1. Сводка совпадает с тем, что сейчас генерирует скрипт (точное равенство
 *     с посчитанным из `subjects.ts` значением).
 *  2. Число тем совпадает с реальным числом тем в таксономии — именно это
 *     число показывает лендинг.
 *  3. Слаг первой темы в сводке есть в таксономии — по нему карточка ведёт
 *     на страницу темы, и битая ссылка на главной бьёт по SEO.
 *  4. Склоны, эмодзи и описания не пустые — карточка без описания выглядит
 *     как заглушка.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * КАК ЧИНИТЬ ПРИ ПАДЕНИИ
 * ─────────────────────────────────────────────────────────────────────────────
 *   node scripts/build-subject-index.mjs --write
 * и закоммитить `src/lib/content/subject-index.json`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { subjects, getSubject, getGrade } from "../src/lib/content/subjects";
import {
  subjectIndex,
  totalTopicsCount,
  subjectTopicsCount,
  getSubjectIndex,
} from "../src/lib/content/subject-index";

const ROOT = process.cwd();
const INDEX_FILE = join(ROOT, "src", "lib", "content", "subject-index.json");

describe("Сводка таксономии совпадает с таксономией", () => {
  it("файл на диске байт-в-байт равен тому, что генерирует скрипт", () => {
    // Ровно то же, что делает `scripts/build-subject-index.mjs`. Если файл
    // разошёлся с таксономией — здесь падение с понятным объяснением.
    const expected = JSON.stringify(
      subjects.map((s) => ({
        slug: s.slug,
        title: s.title,
        shortTitle: s.shortTitle,
        emoji: s.emoji,
        color: s.color,
        description: s.description,
        grades: s.grades.map((g) => ({
          num: g.num,
          title: g.title,
          topicsCount: g.topics.length,
          firstTopicSlug: g.topics.length > 0 ? g.topics[0].slug : null,
        })),
      })),
    );

    const actual = readFileSync(INDEX_FILE, "utf8").trim();

    expect(
      actual,
      "Сводка разошлась с таксономией. Почини: node scripts/build-subject-index.mjs --write",
    ).toBe(expected);
  });

  it("число тем в сводке равно реальному числу тем в таксономии", () => {
    // Именно это число показывает главная («Тем в каталоге»). Расхождение —
    // враньё на витрине.
    const realTopics = subjects.reduce(
      (sum, s) => sum + s.grades.reduce((m, g) => m + g.topics.length, 0),
      0,
    );

    expect(totalTopicsCount()).toBe(realTopics);
    expect(totalTopicsCount()).toBeGreaterThan(0);
  });

  it("в сводке те же предметы, что в таксономии", () => {
    expect(subjectIndex.length).toBe(subjects.length);

    for (const entry of subjectIndex) {
      const real = getSubject(entry.slug);
      expect(real, `предмет ${entry.slug} есть в сводке, но нет в таксономии`).toBeDefined();
      expect(entry.title).toBe(real!.title);
      expect(entry.shortTitle).toBe(real!.shortTitle);
      expect(entry.emoji).toBe(real!.emoji);
      expect(entry.color).toBe(real!.color);
      expect(entry.description).toBe(real!.description);
    }
  });

  it("у каждого предмета в сводке те же классы и те же счётчики тем", () => {
    for (const entry of subjectIndex) {
      const real = getSubject(entry.slug)!;
      expect(entry.grades.length, `предмет ${entry.slug}: число классов`).toBe(
        real.grades.length,
      );

      for (const grade of entry.grades) {
        const realGrade = getGrade(entry.slug, grade.num);
        expect(realGrade, `предмет ${entry.slug}, класс ${grade.num} есть в сводке`).toBeDefined();
        expect(grade.title).toBe(realGrade!.title);
        expect(grade.topicsCount, `предмет ${entry.slug}, класс ${grade.num}: число тем`).toBe(
          realGrade!.topics.length,
        );
      }
    }
  });

  it("счётчик тем по предмету совпадает с числом тем в таксономии", () => {
    for (const entry of subjectIndex) {
      const real = getSubject(entry.slug)!;
      const realCount = real.grades.reduce((sum, g) => sum + g.topics.length, 0);
      expect(subjectTopicsCount(entry), `предмет ${entry.slug}`).toBe(realCount);
    }
  });

  it("слаг первой темы из сводки существует в таксономии", () => {
    // По этому слагу карточка предмета ведёт на страницу темы. Ссылка в
    // пустоту на главной — это 404 и минус в SEO.
    for (const entry of subjectIndex) {
      for (const grade of entry.grades) {
        if (!grade.firstTopicSlug) continue;
        const realGrade = getGrade(entry.slug, grade.num)!;
        const found = realGrade.topics.some((t) => t.slug === grade.firstTopicSlug);
        expect(
          found,
          `предмет ${entry.slug}, класс ${grade.num}: тема ${grade.firstTopicSlug} есть в сводке, но нет в таксономии`,
        ).toBe(true);
      }
    }
  });

  it("у предметов в сводке заполнены название, эмодзи и описание", () => {
    // Карточка без описания или без эмодзи выглядит как заглушка — а это
    // главная страница.
    for (const entry of subjectIndex) {
      expect(entry.title.length, `предмет ${entry.slug}: пустое название`).toBeGreaterThan(0);
      expect(entry.shortTitle.length, `предмет ${entry.slug}: пустое короткое название`).toBeGreaterThan(0);
      expect(entry.emoji.length, `предмет ${entry.slug}: пустой эмодзи`).toBeGreaterThan(0);
      expect(entry.description.length, `предмет ${entry.slug}: пустое описание`).toBeGreaterThan(0);
    }
  });

  it("поиск предмета по slug работает и для несуществующего slug", () => {
    expect(getSubjectIndex("math")?.title).toBeTruthy();
    // Несуществующий slug — это `undefined`, а не исключение: вызывающий код
    // покажет slug вместо названия, и дефект будет виден.
    expect(getSubjectIndex("такого-предмета-нет")).toBeUndefined();
  });
});
