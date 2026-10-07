import { describe, it, expect } from "vitest";
import {
  MATERIALS_CATALOG,
  MATERIAL_PURPOSE_LABELS,
  MATERIAL_PURPOSE_ORDER,
  getMaterialBySlug,
  getMaterialsByFilters,
  getSubjectCounts,
  getFeaturedMaterials,
  materialConstructorHref,
  materialToSitemapEntry,
  translit,
  type MaterialArtifactType,
  type MaterialEntry,
} from "@/lib/content/materials-catalog";
import { getSubject, getTopic } from "@/lib/content/subjects";
import type { SubjectSlug } from "@/lib/types";

/**
 * Whitelist `type=` из конструктора (`src/app/constructor/page.tsx`, DEEP_LINK_TYPES).
 * Скопирован сюда, а не импортирован: страница конструктора — клиентский
 * компонент с JSX, тащить его в vitest-тест незачем. Если whitelist там
 * расширят, этот список надо будет синхронизировать.
 */
const CONSTRUCTOR_DEEP_LINK_TYPES = [
  "worksheet",
  "test",
  "cards",
  "control",
  "lesson-plan",
  "presentation",
  "ktp",
  "oge",
  "ege",
  "materials",
  "lesson-bundle",
  "interactive",
  "image",
];

const ARTIFACT_TYPES: MaterialArtifactType[] = [
  "worksheet",
  "test",
  "control",
  "lesson-plan",
  "presentation",
  "ktp",
  "interactive",
  "image",
];

/** Предметы, которые ТЗ-15 называет обязательными (§8 + ТЗ-15 §12). */
const REQUIRED_SUBJECTS = [
  "math",
  "russian",
  "literature",
  "okruzhaet",
  "english",
  "biology",
  "history",
  "geography",
  "informatics",
  "physics",
  "chemistry",
] as const satisfies readonly SubjectSlug[];

describe("Банк материалов: каталог", () => {
  it("набирает не меньше 120 записей", () => {
    // Ниже 120 — SEO-актив из ТЗ-15 §1 не вырастает, каталог считается пустым.
    expect(MATERIALS_CATALOG.length).toBeGreaterThanOrEqual(120);
  });

  it("все слаги уникальны (дубли ломают generateStaticParams и sitemap)", () => {
    const slugs = MATERIALS_CATALOG.map((m) => m.slug);
    const duplicates = slugs.filter((s, i) => slugs.indexOf(s) !== i);
    expect(duplicates).toEqual([]);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("слаги URL-безопасны и в формате <транслит>-<hash8>", () => {
    for (const m of MATERIALS_CATALOG) {
      expect(m.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{8}$/);
      expect(m.slug.length).toBeLessThanOrEqual(100);
    }
  });

  it("покрывает все пять категорий по цели", () => {
    const present = new Set(MATERIALS_CATALOG.map((m) => m.purpose));
    expect([...present].sort()).toEqual([...MATERIAL_PURPOSE_ORDER].sort());
    // Ровно пять — ни больше, ни меньше (как у конкурента, ТЗ-15 §3.1).
    expect(MATERIAL_PURPOSE_ORDER).toHaveLength(5);
    for (const purpose of MATERIAL_PURPOSE_ORDER) {
      expect(MATERIAL_PURPOSE_LABELS[purpose]).toBeTruthy();
      const count = MATERIALS_CATALOG.filter((m) => m.purpose === purpose).length;
      expect(count, `категория ${purpose} должна быть наполнена`).toBeGreaterThan(5);
    }
  });

  it("покрывает обязательные предметы", () => {
    const present = new Set(MATERIALS_CATALOG.map((m) => m.subject));
    for (const subject of REQUIRED_SUBJECTS) {
      expect(present.has(subject as SubjectSlug), `нет карточек по предмету ${subject}`).toBe(true);
      const count = MATERIALS_CATALOG.filter((m) => m.subject === subject).length;
      expect(count, `предмет ${subject} должен быть наполнен`).toBeGreaterThanOrEqual(5);
    }
  });

  it("покрывает классы 1-11 с разумной плотностью", () => {
    const byGrade = new Map<number, number>();
    for (const m of MATERIALS_CATALOG) {
      byGrade.set(m.grade, (byGrade.get(m.grade) ?? 0) + 1);
    }
    for (let grade = 1; grade <= 11; grade++) {
      expect(byGrade.get(grade) ?? 0, `нет карточек за ${grade} класс`).toBeGreaterThanOrEqual(3);
    }
  });

  it("использует все разрешённые типы артефактов", () => {
    const present = new Set(MATERIALS_CATALOG.map((m) => m.artifactType));
    for (const type of ARTIFACT_TYPES) {
      expect(present.has(type), `нет карточек типа ${type}`).toBe(true);
    }
  });

  it("каждая запись проходит валидацию полей", () => {
    for (const m of MATERIALS_CATALOG) {
      // Название — реальный SEO-заголовок, а не «Материал №1».
      expect(m.title.length, `слишком короткий title: ${m.title}`).toBeGreaterThanOrEqual(20);
      expect(m.title).not.toMatch(/Материал\s*№/i);
      expect(m.title).toMatch(/\d/); // в заголовке есть класс или номер
      expect(m.title).toContain(String(m.grade));

      // description идёт в meta description — 300–800 символов.
      expect(m.description.length, `description ${m.slug}: ${m.description.length}`).toBeGreaterThanOrEqual(300);
      expect(m.description.length, `description ${m.slug}: ${m.description.length}`).toBeLessThanOrEqual(800);
      // Описание обязано быть про ту же тему. Сравниваем без кавычек:
      // в описаниях внутренние кавычки приводятся к „лапкам“, а в
      // topicTitle стоят «ёлочки» — форма отличается, а текст один.
      const bare = (v: string) => v.replace(/[«»„“]/g, "").replace(/\s+/g, " ");
      expect(bare(m.description), `description про другую тему: ${m.slug}`).toContain(
        bare(m.topicTitle),
      );

      // Никаких «правдоподобных» счётчиков: у материала нет рейтинга
      // и числа использований, потому что за ними нет данных.
      expect(m.author).toBe("Редакция УчЛист");
      expect(m.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(new Date(m.updatedAt).getTime())).toBe(false);
      expect(m.count).toBeGreaterThanOrEqual(5);
      expect(m.count).toBeLessThanOrEqual(30);
      expect(["easy", "medium", "hard"]).toContain(m.difficulty);
    }
  });

  it("описания не скопированы из одного шаблона", () => {
    const unique = new Set(MATERIALS_CATALOG.map((m) => m.description));
    // Все 132 уникальны; порог 90% — страховка от повторов при будущих правках.
    expect(unique.size / MATERIALS_CATALOG.length).toBeGreaterThanOrEqual(0.9);
  });

  it("темы и классы ссылаются на реальную таксономию", () => {
    for (const m of MATERIALS_CATALOG) {
      const grade = getSubject(m.subject)?.grades.find((g) => g.num === m.grade);
      expect(grade, `нет предмета/класса ${m.subject}/${m.grade}`).toBeDefined();
      const topic = getTopic(m.subject, m.grade, m.topicSlug);
      expect(topic, `нет темы ${m.subject}/${m.grade}/${m.topicSlug}`).toBeDefined();
      expect(topic?.title).toBe(m.topicTitle);
    }
  });

  it("КТП не выпадает на начальной школе", () => {
    for (const m of MATERIALS_CATALOG.filter((x) => x.artifactType === "ktp")) {
      expect(m.grade).toBeGreaterThanOrEqual(5);
    }
  });
});

describe("Банк материалов: геттеры", () => {
  it("getMaterialBySlug находит существующий и не находит несуществующий", () => {
    const first = MATERIALS_CATALOG[0];
    expect(getMaterialBySlug(first.slug)).toEqual(first);
    expect(getMaterialBySlug("nesushchestvuyushchiy-slug")).toBeUndefined();
    expect(getMaterialBySlug("")).toBeUndefined();
  });

  it("getMaterialsByFilters фильтрует по каждому полю", () => {
    const sample = MATERIALS_CATALOG[0];

    const bySubject = getMaterialsByFilters({ subject: "math" });
    expect(bySubject.length).toBeGreaterThan(0);
    expect(bySubject.every((m) => m.subject === "math")).toBe(true);

    const byGrade = getMaterialsByFilters({ grade: 5 });
    expect(byGrade.every((m) => m.grade === 5)).toBe(true);

    const byPurpose = getMaterialsByFilters({ purpose: "check" });
    expect(byPurpose.every((m) => m.purpose === "check")).toBe(true);

    const byArtifact = getMaterialsByFilters({ artifactType: "interactive" });
    expect(byArtifact.every((m) => m.artifactType === "interactive")).toBe(true);

    // Комбинация полей + сохранение редакционного порядка каталога.
    const combined = getMaterialsByFilters({ subject: sample.subject, grade: sample.grade });
    expect(combined.every((m) => m.subject === sample.subject && m.grade === sample.grade)).toBe(true);
    const order = combined.map((m) => MATERIALS_CATALOG.indexOf(m));
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    // Нет пересечений — пустой результат.
    expect(getMaterialsByFilters({ subject: "math", grade: 11 })).toEqual([]);
    // Без фильтров — весь каталог.
    expect(getMaterialsByFilters({})).toHaveLength(MATERIALS_CATALOG.length);
  });

  it("getFeaturedMaterials берёт начало каталога и не больше лимита", () => {
    const featured = getFeaturedMaterials(5);
    expect(featured).toHaveLength(5);
    expect(featured).toEqual(MATERIALS_CATALOG.slice(0, 5));
  });

  // Рейтинга и «взяли в работу» в карточке больше нет: они считались из хэша
  // и показывались живым посетителям как настоящие. Тест держит границу, чтобы
  // счётчик не вернулся вместе с новым полем под другим именем.
  it("в карточке материала нет выдуманных счётчиков", () => {
    for (const m of MATERIALS_CATALOG) {
      expect(Object.keys(m), `лишние поля у ${m.slug}`).not.toContain("usesCount");
      expect(Object.keys(m), `лишние поля у ${m.slug}`).not.toContain("rating");
      expect(Object.keys(m), `лишние поля у ${m.slug}`).not.toContain("ratingCount");
    }
  });

  it("getSubjectCounts совпадает с фактическим составом каталога", () => {
    const counts = getSubjectCounts();
    const sum = counts.reduce((acc, c) => acc + c.count, 0);
    expect(sum).toBe(MATERIALS_CATALOG.length);
    for (const { subject, count } of counts) {
      expect(count).toBe(MATERIALS_CATALOG.filter((m) => m.subject === subject).length);
    }
  });

  it("ссылка в конструктор содержит параметры, которые он понимает", () => {
    for (const m of MATERIALS_CATALOG) {
      const href = materialConstructorHref(m);
      expect(href.startsWith("/constructor?")).toBe(true);
      const params = new URLSearchParams(href.split("?")[1]);
      expect(params.get("subject")).toBe(m.subject);
      expect(params.get("grade")).toBe(String(m.grade));
      expect(params.get("topic")).toBe(m.topicSlug);
      expect(params.get("difficulty")).toBe(m.difficulty);
      expect(params.get("count")).toBe(String(m.count));
      // `type` обязан быть в whitelist конструктора, иначе параметр молча игнорируется.
      expect(CONSTRUCTOR_DEEP_LINK_TYPES).toContain(params.get("type"));
    }
  });

  it("materialToSitemapEntry даёт URL с priority 0.7 и monthly", () => {
    const m: MaterialEntry = MATERIALS_CATALOG[0];
    const entry = materialToSitemapEntry(m, "https://uchlist.ru");
    expect(entry.url).toBe(`https://uchlist.ru/material/${m.slug}/`);
    expect(entry.priority).toBe(0.7);
    expect(entry.changeFrequency).toBe("monthly");
    expect(entry.lastModified).toBeInstanceOf(Date);
    expect((entry.lastModified as Date).toISOString().slice(0, 10)).toBe(m.updatedAt);
  });
});

describe("Банк материалов: транслитерация", () => {
  it("переводит кириллицу в латиницу (всегда в нижний регистр — только для слагов)", () => {
    expect(translit("Дроби")).toBe("drobi");
    expect(translit("Что вы получите")).toBe("chto vy poluchite");
    expect(translit("Щавель и объезд")).toBe("shchavel i obezd");
    expect(translit("Ёлка")).toBe("elka");
  });
});
