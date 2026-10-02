/**
 * Тесты для мока карточек (TZ-16 §3.1, Этап 2).
 *
 * Файл БЕЗ DOM: гоняется с `--environment node` (быстрый старт, не ест память).
 * Рендер `CardsPreview` вынесен в `tests/cards-preview.test.ts` (ему нужен jsdom).
 *
 * Покрытие:
 *   1. happy path — валидный req → CardSet с 8–40 карточками,
 *      соблюдением лимитов длины (front ≤ 80, back ≤ 120) и
 *      осмысленной категорией.
 *   2. первая треть карточек действительно из `topic.examples`.
 *   3. topic-not-found — несуществующий slug → `cards: []`,
 *      title со fallback на слаг, без исключения.
 *   4. DOCX-экспорт возвращает непустой Blob.
 *   5. печать A4: CSS-правила и разбивка по 10 карточек.
 */
import { describe, it, expect } from "vitest";
import type { CardSet, GenerationRequest } from "@/lib/types";
import { mockCards, MAX_FRONT_LEN, MAX_BACK_LEN, clipCardText } from "@/lib/mock/cards";
import { generateCardsDocx } from "@/lib/utils/cards-docx";
import { CARDS_PRINT_CSS, paginateCards } from "@/lib/utils/cards-print";
import { getTopic } from "@/lib/content/subjects";

const baseReq = (overrides: Partial<GenerationRequest> = {}): GenerationRequest => ({
  subject: "math",
  grade: 5,
  topic: "drobi-obyknovennye",
  difficulty: "medium",
  count: 12,
  type: "cards",
  withAnswers: true,
  withExplanations: false,
  ...overrides,
});

describe("mockCards — happy path", () => {
  it("возвращает валидный CardSet с карточками в диапазоне 8–40", async () => {
    const set: CardSet = await mockCards(baseReq());

    expect(set.id).toBeTruthy();
    expect(set.subject).toBe("math");
    expect(set.grade).toBe(5);
    expect(set.topic).toBe("drobi-obyknovennye");
    expect(set.difficulty).toBe("medium");
    expect(set.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(typeof set.generationMs).toBe("number");
    expect(set.title).toContain("Обыкновенные дроби");

    // Количество — ровно как просил учитель, в рамках 8–40
    expect(set.cards.length).toBe(12);
    expect(set.cards.length).toBeGreaterThanOrEqual(8);
    expect(set.cards.length).toBeLessThanOrEqual(40);

    // Каждая карточка непустая и в рамках жёстких лимитов длины
    for (const card of set.cards) {
      expect(card.front.length).toBeGreaterThan(0);
      expect(card.front.length).toBeLessThanOrEqual(MAX_FRONT_LEN);
      expect(card.back.length).toBeGreaterThan(0);
      expect(card.back.length).toBeLessThanOrEqual(MAX_BACK_LEN);
    }

    // Категория проставлена осмысленно
    expect(set.cards.every((c) => Boolean(c.category))).toBe(true);
    expect(new Set(set.cards.map((c) => c.category)).size).toBeGreaterThan(0);
  });

  it("count зажимается в 8–40: 3 → 8, 999 → 40", async () => {
    const low = await mockCards(baseReq({ count: 3 }));
    const high = await mockCards(baseReq({ count: 999 }));
    expect(low.cards.length).toBe(8);
    expect(high.cards.length).toBe(40);
  });

  it("предметные шаблоны: russian/history/english", async () => {
    const rus = await mockCards(
      baseReq({ subject: "russian", grade: 2, topic: "bezudarnye-glasnye", count: 9 })
    );
    expect(rus.cards.some((c) => c.front.startsWith("Корень слова"))).toBe(true);
    expect(rus.cards.every((c) => c.category === "Словарь")).toBe(true);

    const hist = await mockCards(
      baseReq({ subject: "history", grade: 5, topic: "drevnyaya-rus", count: 9 })
    );
    expect(hist.cards.some((c) => /\d{3,4} год/.test(c.front))).toBe(true);

    const eng = await mockCards(
      baseReq({ subject: "english", grade: 5, topic: "hobbies-vocabulary", count: 9 })
    );
    expect(eng.cards.some((c) => c.back.startsWith("Перевод:"))).toBe(true);
    expect(eng.cards.every((c) => c.category === "Лексика")).toBe(true);
  });
});

describe("mockCards — первая треть из topic.examples", () => {
  it("первая треть карточек = front=example.text, back=example.answer", async () => {
    const set = await mockCards(baseReq({ count: 12 }));
    const topic = getTopic("math", 5, "drobi-obyknovennye");
    expect(topic).toBeDefined();

    const firstThird = Math.round(12 / 3); // 4 карточки из примеров
    const examples = topic!.examples;

    // Берём столько примеров, сколько есть (с циклическим повтором)
    for (let i = 0; i < firstThird; i++) {
      const ex = examples[i % examples.length];
      expect(set.cards[i].front).toBe(ex.text);
      expect(set.cards[i].back).toBe(ex.answer ?? ex.hint ?? "");
    }

    // Хвост — не из примеров (шаблоны предмета)
    const exampleTexts = new Set(examples.map((e) => e.text));
    const tail = set.cards.slice(firstThird);
    expect(tail.length).toBe(8);
    expect(tail.every((c) => !exampleTexts.has(c.front))).toBe(true);
  });
});

describe("mockCards — ограничения длины", () => {
  it("clipCardText режет по границе слова и укладывается в лимит", () => {
    // Строка заведомо ДЛИННЕЕ лимита. В прошлой версии теста здесь была фраза
    // длиной 79 символов при MAX_FRONT_LEN = 80 — обрезка не срабатывала,
    // многоточие не появлялось, и тест падал вовсе не из-за кода.
    const long =
      "Корень слова «Обыкновенные дроби и смежные темы курса математики пятого класса школьной программы»";

    const clipped = clipCardText(long, MAX_FRONT_LEN);
    expect(clipped.length).toBeLessThanOrEqual(MAX_FRONT_LEN);
    expect(clipped.endsWith("…")).toBe(true);

    // Главный инвариант обрезки: текст БЕЗ многоточия — точный префикс
    // исходной строки, оборванный по границе слова (никаких «математ…»).
    // Прежняя проверка `not.toMatch(/\S…$/)` была бессмысленной: любая
    // правильно обрезанная строка по определению кончается «буква + …».
    const base = clipped.replace(/…$/, "");
    expect(long.startsWith(base)).toBe(true);
    // Перед многоточием не должно быть висящего пробела.
    expect(base).not.toMatch(/\s$/);
  });

  it("короткий текст не трогается", () => {
    expect(clipCardText("Сократи дробь: 8/12 = __", MAX_FRONT_LEN)).toBe(
      "Сократи дробь: 8/12 = __"
    );
  });

  it("на 40 карточках лимиты не нарушаются ни для одного предмета", async () => {
    // Тема ОБЯЗАНА соответствовать предмету: `baseReq` жёстко задаёт
    // «drobi-obyknovennye» (тема математики), и если подставить её к истории
    // или английскому, `getTopic` не найдёт тему → вернётся 0 карточек.
    // Раньше тест менял только предмет и получал пустой набор.
    const cases = [
      { subject: "math", topic: "drobi-obyknovennye" },
      { subject: "russian", topic: "orfografiya-korney" },
      { subject: "history", topic: "drevnyaya-rus" },
      { subject: "english", topic: "hobbies-vocabulary" },
      { subject: "biology", topic: "kletochnoe-stroenie" },
      { subject: "geography", topic: "litosfera" },
    ] as const;

    for (const { subject, topic } of cases) {
      const set = await mockCards(baseReq({ subject, grade: 5, topic, count: 40 }));
      expect(set.cards.length, `${subject}/${topic} должен дать 40 карточек`).toBe(40);
      for (const card of set.cards) {
        expect(card.front.length).toBeLessThanOrEqual(MAX_FRONT_LEN);
        expect(card.back.length).toBeLessThanOrEqual(MAX_BACK_LEN);
      }
    }
  });
});

describe("mockCards — topic not found", () => {
  it("несуществующий slug темы → cards: [], без исключения", async () => {
    const set: CardSet = await mockCards(
      baseReq({ topic: "ne-suschestvuyuschiy-slug-xyz" })
    );

    expect(set.cards).toEqual([]);
    // Заголовок и topic — со fallback на слаг из запроса
    expect(set.topic).toBe("ne-suschestvuyuschiy-slug-xyz");
    expect(set.title).toContain("ne-suschestvuyuschiy-slug-xyz");
    // Базовые поля на месте
    expect(set.id).toBeTruthy();
    expect(set.subject).toBe("math");
    expect(set.grade).toBe(5);
    expect(set.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("несуществующий предмет (тема не найдена) → тоже cards: []", async () => {
    const set = await mockCards(
      baseReq({ subject: "unknown-subject" as GenerationRequest["subject"], topic: "x" })
    );
    expect(set.cards).toEqual([]);
    expect(set.title).toContain("x");
  });
});

describe("generateCardsDocx — DOCX-экспорт", () => {
  it("возвращает непустой Blob", async () => {
    const set = await mockCards(baseReq({ count: 12 }));
    const blob = await generateCardsDocx(set);

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(1024);
  });

  it("пустой CardSet не роняет экспорт", async () => {
    const set = await mockCards(baseReq({ topic: "ne-suschestvuyuschiy-slug-xyz" }));
    const blob = await generateCardsDocx(set);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });
});

describe("cards-print — печать A4", () => {
  it("CSS-правила содержат сетку 2 колонки и рамку с линией сгиба", () => {
    expect(CARDS_PRINT_CSS).toContain("@media print");
    expect(CARDS_PRINT_CSS).toContain("grid-template-columns: repeat(2, 1fr)");
    expect(CARDS_PRINT_CSS).toContain(".cards-print-card");
    expect(CARDS_PRINT_CSS).toContain("border: 1px solid #000");
    expect(CARDS_PRINT_CSS).toContain("__fold");
    // Не конфликтует с общим блоком печати: @page и .no-print не дублируем
    expect(CARDS_PRINT_CSS).not.toContain("@page");
    expect(CARDS_PRINT_CSS).not.toContain(".no-print");
  });

  it("карточки разбиваются по 10 на лист", () => {
    const cards = Array.from({ length: 24 }, (_, i) => i);
    const sheets = paginateCards(cards);
    expect(sheets).toHaveLength(3);
    expect(sheets[0]).toHaveLength(10);
    expect(sheets[2]).toHaveLength(4);
  });
});
