/**
 * TZ-16 §3.2: тесты «Материалов» (мок + превью + ZIP-экспорт).
 *
 * Edge cases:
 *   1. happy path — 3 файла по умолчанию, форматы по ТЗ
 *      (glossary→docx, reference→csv, handout→docx), checklist НЕ генерится.
 *   2. topic-not-found — неизвестный slug темы → files: [] без исключения.
 *   3. ZIP-экспорт — в архиве ровно 3 файла с читаемыми ASCII-именами,
 *      CSV начинается с UTF-8 BOM (без него русский Excel показывает кракозябры).
 */
import React from "react";
import JSZip from "jszip";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { GenerationRequest, MaterialBundle } from "@/lib/types";
import { mockMaterials } from "@/lib/mock/materials";
import { generateMaterialsZip, materialFilename } from "@/lib/utils/materials-zip";
import { MaterialsPreview } from "@/components/constructor/MaterialsPreview";
import {
  MaterialsFilter,
  type MaterialFilterItem,
} from "@/components/materials/MaterialsFilter";
import {
  EDITORIAL_AUTHOR,
  isEditorialMaterial,
  materialRobots,
} from "@/components/materials/materialOrigin";
import { MATERIALS_CATALOG } from "@/lib/content/materials-catalog";
import { getMaterialBySlug } from "@/lib/content/materials-catalog";
import MaterialPage, { generateMetadata } from "@/app/material/[slug]/page";

const baseReq = (
  overrides: Partial<GenerationRequest> = {}
): GenerationRequest => ({
  subject: "math",
  grade: 5,
  topic: "drobi-obyknovennye",
  difficulty: "medium",
  count: 5,
  type: "materials",
  withAnswers: false,
  withExplanations: false,
  ...overrides,
});

/** Тема из subjects.ts обязана существовать — если нет, тест бессмыслен. */
const bundleOf = async (req: GenerationRequest): Promise<MaterialBundle> => mockMaterials(req);

describe("mockMaterials — happy path", () => {
  it("math/5/drobi-obyknovennye → 3 файла с форматами по ТЗ", async () => {
    const bundle = await bundleOf(baseReq());

    // Базовые поля
    expect(bundle.id).toBeTruthy();
    expect(bundle.subject).toBe("math");
    expect(bundle.grade).toBe(5);
    expect(bundle.topic).toBe("drobi-obyknovennye");
    expect(bundle.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(typeof bundle.generationMs).toBe("number");
    expect(bundle.title).toContain("Обыкновенные дроби");

    // Ровно 3 файла по умолчанию
    expect(bundle.files).toHaveLength(3);
    const kinds = bundle.files.map((f) => f.kind);
    expect(kinds).toEqual(["glossary", "reference", "handout"]);

    // Форматы жёстко по ТЗ
    const formats = Object.fromEntries(bundle.files.map((f) => [f.kind, f.format]));
    expect(formats).toEqual({ glossary: "docx", reference: "csv", handout: "docx" });

    // checklist не генерируется без явного выбора учителя
    expect(kinds).not.toContain("checklist");

    // У каждого файла есть id / title / непустой контент
    for (const f of bundle.files) {
      expect(f.id).toBeTruthy();
      expect(f.title.length).toBeGreaterThan(3);
      expect(f.content.trim().length).toBeGreaterThan(40);
      // Без markdown-разметки — тип обещает простой текст
      expect(f.content).not.toContain("**");
    }

    // Словарь: 8–15 записей (6 терминов + примеры из topic.examples)
    const glossary = bundle.files.find((f) => f.kind === "glossary")!;
    const termLines = glossary.content
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && l !== "Примеры по теме" && !l.startsWith("Словарь") && !l.startsWith("Математика ·"));
    expect(termLines.length).toBeGreaterThanOrEqual(8);
    expect(termLines.length).toBeLessThanOrEqual(15);
    // Термины опираются на примеры из темы, а не на случайный текст
    expect(glossary.content).toContain("Примеры по теме");

    // Reference — CSV с шапкой из 3 колонок
    const reference = bundle.files.find((f) => f.kind === "reference")!;
    const header = reference.content.split("\n")[0];
    expect(header.split(";")).toHaveLength(3);

    // Раздатка — памятка на одну страницу: короткие строки, есть разделы
    const handout = bundle.files.find((f) => f.kind === "handout")!;
    expect(handout.content).toContain("Памятка к теме");
    expect(handout.content).toContain("Проверь себя");
  });

  it("другой предмет/класс → те же 3 kind'а, но контент по своей теме", async () => {
    const bundle = await bundleOf(
      baseReq({ subject: "history", grade: 5, topic: "drevniy-egipet-5" })
    );

    expect(bundle.files.map((f) => f.kind)).toEqual(["glossary", "reference", "handout"]);
    expect(bundle.title).toContain("История");
    expect(bundle.title).toContain("Древний Египет");
    expect(bundle.files[0].content).toContain("Древний Египет");
  });
});

describe("mockMaterials — topic not found", () => {
  it("несуществующий slug темы → files: [], без исключения", async () => {
    const bundle = await bundleOf(baseReq({ topic: "ne-suschestvuyuschiy-slug-xyz" }));

    expect(bundle.files).toEqual([]);
    // Заголовок осмысленный, даже без файлов
    expect(bundle.id).toBeTruthy();
    expect(bundle.subject).toBe("math");
    expect(bundle.grade).toBe(5);
    expect(bundle.topic).toBe("ne-suschestvuyuschiy-slug-xyz");
    expect(bundle.title).toContain("ne-suschestvuyuschiy-slug-xyz");
    expect(bundle.title).toContain("Материалы");
  });

  it("неизвестный subject slug → тоже не падаем, файлов нет", async () => {
    const bundle = await bundleOf(baseReq({ subject: "unknown-subject" as GenerationRequest["subject"] }));
    expect(bundle.files).toEqual([]);
    expect(bundle.title).toContain("unknown-subject");
  });
});

describe("generateMaterialsZip — экспорт", () => {
  it("в архиве 3 файла с читаемыми ASCII-именами, CSV с BOM", async () => {
    const bundle = await bundleOf(baseReq());
    const blob = await generateMaterialsZip(bundle);

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(2000);

    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort();

    // Ровно 3 файла, никаких служебных записей
    expect(names).toHaveLength(3);
    expect(names).toEqual([
      "01-glossary-slovar.docx",
      "02-reference-spravka.csv",
      "03-handout-pamyatka.docx",
    ]);

    // Имена читаемые: только латиница, цифры, дефисы, точка
    for (const n of names) {
      expect(n).toMatch(/^[a-z0-9-]+\.(docx|csv|txt)$/);
    }

    // materialFilename собирает то же имя, что и архив
    expect(materialFilename(bundle.files[0], 0)).toBe("01-glossary-slovar.docx");

    // CSV: первые байты — UTF-8 BOM (EF BB BF), иначе русский Excel даёт кракозябры
    const csvBytes = await zip.file("02-reference-spravka.csv")!.async("uint8array");
    expect([...csvBytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const csvText = await zip.file("02-reference-spravka.csv")!.async("string");
    expect(csvText.charCodeAt(0)).toBe(0xfeff);
    expect(csvText).toContain(";");
    // `baseReq()` — это математика (тема «Обыкновенные дроби»), поэтому
    // ожидаем именно её текст. Раньше здесь стояло «Древн», хотя в тесте
    // использовалась история только в соседнем кейсе: проверяли чужой bundle.
    expect(csvText).toContain("дроб"); // кириллица на месте, не потерялась
    // Строки разделены CRLF — так Excel их корректно читает
    expect(csvText).toContain("\r\n");

    // DOCX — валидный ZIP-контейнер (внутри есть [Content_Types].xml)
    const docxBlob = await zip.file("01-glossary-slovar.docx")!.async("blob");
    const docxZip = await JSZip.loadAsync(await docxBlob.arrayBuffer());
    expect(docxZip.file("[Content_Types].xml")).toBeTruthy();
    expect(docxZip.file("word/document.xml")).toBeTruthy();
  });

  it("пустой комплект → валидный архив без файлов, без исключения", async () => {
    const bundle = await bundleOf(baseReq({ topic: "ne-suschestvuyuschiy-slug-xyz" }));
    const blob = await generateMaterialsZip(bundle);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(Object.keys(zip.files).filter((n) => !zip.files[n].dir)).toHaveLength(0);
  });
});

describe("MaterialsPreview — рендер", () => {
  it("happy bundle: показывает 3 файла с названиями, форматами и размерами", async () => {
    const bundle = await bundleOf(baseReq());
    const { container } = render(React.createElement(MaterialsPreview, { bundle }));

    expect(container.textContent).toContain("Материалы");
    expect(container.textContent).toContain("Обыкновенные дроби");

    // Человекочитаемые названия типов
    expect(container.textContent).toContain("Словарь");
    expect(container.textContent).toContain("Справочные данные");
    expect(container.textContent).toContain("Раздатка");

    // Форматы
    expect(container.textContent).toContain("Word (DOCX)");
    expect(container.textContent).toContain("Excel (CSV)");

    // Примерный размер
    expect(container.textContent).toContain("≈");
  });

  it("пустой комплект: показывает empty state, а не пустой экран", async () => {
    const bundle = await bundleOf(baseReq({ topic: "ne-suschestvuyuschiy-slug-xyz" }));
    const { container } = render(React.createElement(MaterialsPreview, { bundle }));

    expect(container.textContent).toContain("Файлы не собрались");
    expect(container.textContent).toContain("ne-suschestvuyuschiy-slug-xyz");
    expect(container.textContent).not.toContain("Скачать ZIP");
  });
});

/**
 * Фильтры по предмету и классу на `/materials/` (блок C, пункт C2).
 *
 * Сайт собирается статическим экспортом, поэтому фильтр работает на клиенте:
 * состояние в React, URL не меняется, отдельных страниц под фильтры нет.
 * Та же выдача, что и на сервере, — проекция строится из MATERIALS_CATALOG.
 */
describe("MaterialsFilter — фильтры по предмету и классу", () => {
  /** Небольшой набор из настоящего каталога — берём по 3 записи на пару. */
  const items: MaterialFilterItem[] = [
    { slug: "a-1", title: "Математика 5, тема один", subject: "math", grade: 5, purpose: "check" },
    { slug: "a-2", title: "Математика 5, тема два", subject: "math", grade: 5, purpose: "explain" },
    { slug: "a-3", title: "Математика 6, тема три", subject: "math", grade: 6, purpose: "check" },
    { slug: "b-1", title: "Русский 5, тема один", subject: "russian", grade: 5, purpose: "check" },
    { slug: "b-2", title: "Русский 7, тема два", subject: "russian", grade: 7, purpose: "ready" },
    { slug: "b-3", title: "Русский 5, тема три", subject: "russian", grade: 5, purpose: "decorate" },
  ];
  const purposeLabels = { check: "Проверить", explain: "Объяснить", ready: "Под ключ", decorate: "Оформить" };
  const subjectMeta = {
    math: { emoji: "🔢", shortTitle: "Математика" },
    russian: { emoji: "📖", shortTitle: "Русский" },
  };

  const setup = (pageSize?: number) =>
    render(
      React.createElement(MaterialsFilter, {
        items,
        purposeLabels,
        subjectMeta,
        pageSize,
      }),
    );

  it("без фильтров показывает всю выдачу", () => {
    setup();
    // Счётчик в формате «показано N из M»: 6 записей, все 6 в первой
    // отрисовке — ни одна не спрятана под «показать ещё».
    expect(screen.getByRole("status")).toHaveTextContent("показано 6 из 6");
    expect(screen.getByText("Математика 5, тема один")).toBeInTheDocument();
    expect(screen.getByText("Русский 7, тема два")).toBeInTheDocument();
  });

  it("выбор предмета сужает выдачу", () => {
    setup();
    fireEvent.change(screen.getByLabelText("Предмет"), { target: { value: "math" } });

    // Остались только записи математики
    expect(screen.getByText("Математика 5, тема один")).toBeInTheDocument();
    expect(screen.queryByText("Русский 7, тема два")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("показано 3 из 3");
  });

  it("предмет + класс сужают выдачу сильнее", () => {
    setup();
    fireEvent.change(screen.getByLabelText("Предмет"), { target: { value: "math" } });
    fireEvent.change(screen.getByLabelText("Класс"), { target: { value: "5" } });

    expect(screen.getByText("Математика 5, тема один")).toBeInTheDocument();
    expect(screen.getByText("Математика 5, тема два")).toBeInTheDocument();
    expect(screen.queryByText("Математика 6, тема три")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("показано 2 из 2");
  });

  it("выбор класса без предмета тоже сужает выдачу", () => {
    setup();
    fireEvent.change(screen.getByLabelText("Класс"), { target: { value: "5" } });

    expect(screen.getByRole("status")).toHaveTextContent("показано 4 из 4");
    expect(screen.queryByText("Математика 6, тема три")).not.toBeInTheDocument();
  });

  it("счётчик честно различает показано и всего: не выдаёт весь каталог за одну страницу", () => {
    // 30 записей, в первой отрисовке 12. Если бы счётчик показывал только
    // «30», учитель думал бы, что видит всю выдачу. Обязаны быть оба числа.
    const many: MaterialFilterItem[] = Array.from({ length: 30 }, (_, i) => ({
      slug: `s-${i}`,
      title: `Материал ${i}`,
      subject: "math",
      grade: 5 + (i % 2),
      purpose: "check",
    }));
    render(
      React.createElement(MaterialsFilter, {
        items: many,
        purposeLabels,
        subjectMeta,
      }),
    );

    expect(screen.getByRole("status")).toHaveTextContent("показано 12 из 30");
    // И кнопка, которая доводит выдачу до конца.
    expect(screen.getByRole("button", { name: /Показать ещё/ })).toBeInTheDocument();
  });

  it("сброс возвращает полную выдачу", () => {
    setup();
    fireEvent.change(screen.getByLabelText("Предмет"), { target: { value: "russian" } });
    expect(screen.getByRole("status")).toHaveTextContent("показано 3 из 3");

    fireEvent.click(screen.getByRole("button", { name: "Сбросить" }));
    expect(screen.getByRole("status")).toHaveTextContent("показано 6 из 6");
    expect(screen.getByText("Математика 5, тема один")).toBeInTheDocument();
  });

  // Пустая выдача — не ошибка, а понятное состояние: учитель видит, что
  // под этот выбор ничего нет, и получает ссылку в конструктор.
  //
  // Список классов строится только по тем классам, где материалы есть, поэтому
  // пустую выдачу воспроизводим данными, а не кликом по «несуществующему»
  // классу — такого варианта в списке просто нет.
  it("пустая выдача показывает понятное состояние, а не пустую страницу", () => {
    render(
      React.createElement(MaterialsFilter, {
        items: [],
        purposeLabels,
        subjectMeta,
      }),
    );

    expect(screen.getByText("По этому выбору материалов нет")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Открыть конструктор" })).toHaveAttribute(
      "href",
      "/constructor",
    );
  });

  // Доступность с клавиатуры: у обоих списков есть настоящие подписи,
  // связанные через label/for — выбор списка без мыши работает, и скринридер
  // читает «Предмет, список», а не «список, без имени».
  it("у фильтров есть подписи, доступные с клавиатуры", () => {
    setup();
    const subjectSelect = screen.getByLabelText("Предмет");
    const gradeSelect = screen.getByLabelText("Класс");

    expect(subjectSelect.tagName).toBe("SELECT");
    expect(gradeSelect.tagName).toBe("SELECT");
    expect(subjectSelect).toHaveAttribute("id", "materials-subject");
    expect(gradeSelect).toHaveAttribute("id", "materials-grade");
  });

  // Класс, для которого у выбранного предмета нет материалов, не предлагается:
  // пустой список выглядит как баг. После смены предмета несовместимый класс
  // сбрасывается, чтобы не показывать «0 материалов».
  it("классы предлагаются только те, где есть материалы выбранного предмета", () => {
    setup();
    fireEvent.change(screen.getByLabelText("Предмет"), { target: { value: "math" } });

    const gradeSelect = screen.getByLabelText("Класс") as unknown as HTMLSelectElement;
    const values = [...gradeSelect.options].map((o) => o.value);
    expect(values).toContain("5");
    expect(values).toContain("6");
    expect(values).not.toContain("7"); // у математики нет 7 класса
  });
});

/**
 * `/material/<slug>/` — robots и подпись автора (блок C, пункт C3).
 */
describe("Страница материала — robots и автор", () => {
  const editorial = MATERIALS_CATALOG[0];

  it("у материала учителя стоит noindex, follow", () => {
    // Авторские публикации учителей появятся в Фазе 2 (ТЗ-15 §14). Пока их
    // нет в каталоге, берём запись и меняем только автора — так проверяется
    // именно решение по автору, а не по маршруту.
    const teacherMaterial = { ...editorial, author: "Иванова Мария Петровна" };
    const meta = generateMetadata({ params: { slug: editorial.slug } });

    // Запись каталога редакционная — её индексируем.
    expect(meta.robots).toEqual({ index: true, follow: true });

    // Тот же материал от учителя — уже нет.
    expect(materialRobots(teacherMaterial)).toEqual({ index: false, follow: true });
  });

  it("robots редакционного материала — index, follow", () => {
    const meta = generateMetadata({ params: { slug: editorial.slug } });
    expect(meta.robots).toEqual({ index: true, follow: true });
  });

  it("несуществующий слаг отдаёт «Материал не найден» без robots", () => {
    const meta = generateMetadata({ params: { slug: "nesushchestvuyushchiy-slug" } });
    expect(meta.title).toBe("Материал не найден");
    expect(meta.robots).toBeUndefined();
  });

  it("редакционный материал отличается от материала учителя", () => {
    expect(isEditorialMaterial({ author: EDITORIAL_AUTHOR })).toBe(true);
    expect(isEditorialMaterial({ author: "Иванова Мария Петровна" })).toBe(false);
    // У всего каталога сейчас один автор — редакционный. Это проверка на то,
    // что разделение по автору вообще имеет смысл: если у записей появятся
    // другие авторы, тест начнёт ловить расхождение.
    for (const m of MATERIALS_CATALOG) {
      expect(m.author).toBe(EDITORIAL_AUTHOR);
    }
  });

  it("страница материала показывает автора", () => {
    const material = getMaterialBySlug(editorial.slug)!;
    // Автор на странице — настоящее имя из каталога, а не выдуманное ФИО.
    expect(material.author).toBe(EDITORIAL_AUTHOR);

    const { container } = render(
      React.createElement(MaterialPage, { params: { slug: editorial.slug } }),
    );
    expect(container.textContent).toContain(`Автор: ${EDITORIAL_AUTHOR}`);
    // Редакционная карточка не помечается как «материал учителя».
    expect(container.textContent).not.toContain("Материал учителя");
  });
});
