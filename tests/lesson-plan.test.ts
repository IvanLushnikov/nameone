/**
 * Тесты для мока lesson-plan (Q1-2027, Worker A, TZ-01).
 *
 * Edge cases (минимум 2 — по TZ):
 *   1. happy-path — корректный req → возвращается валидный LessonPlan
 *      с 6 шагами (3+5+15+15+5+2 = 45 мин), целями и ДЗ.
 *   2. topic-not-found — несуществующий slug темы → план всё равно
 *      генерируется (fallback на семейство предмета), UX не падает.
 *
 * Дополнительно проверяем:
 *   3. DOCX-экспорт: generateLessonPlanDocx возвращает непустой Blob
 *      с правильным MIME-типом.
 *   4. Граница тайминга: сумма длительностей шагов ≈ 45 ± 2 мин.
 */
import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import type { GenerationRequest, LessonPlan } from "@/lib/types";
import { generateLessonPlan } from "@/lib/mock/lesson-plan";
import { generateLessonPlanDocx } from "@/lib/utils/lesson-plan-docx";
import { LessonPlanPreview } from "@/components/constructor/LessonPlanPreview";

const baseReq = (
  overrides: Partial<GenerationRequest> = {}
): GenerationRequest => ({
  subject: "math",
  grade: 5,
  topic: "drobi-obyknovennye",
  difficulty: "medium",
  count: 5,
  type: "lesson-plan",
  withAnswers: false,
  withExplanations: false,
  ...overrides,
});

describe("generateLessonPlan — happy path", () => {
  it("math/5/drobi-obyknovennye → валидный LessonPlan", async () => {
    const plan: LessonPlan = await generateLessonPlan(baseReq());

    // Базовые поля
    expect(plan.id).toBeTruthy();
    expect(plan.subject).toBe("math");
    expect(plan.grade).toBe(5);
    expect(plan.topic).toBe("drobi-obyknovennye");
    expect(plan.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(typeof plan.generationMs).toBe("number");

    // Заголовок
    expect(plan.title).toContain("Обыкновенные дроби");

    // ФГОС-раздел (для этой темы он задан в subjects.ts)
    expect(plan.fgosRef).toBeTruthy();

    // Цели — 2–3 обучающие / 1–2 развивающие / 1 воспитательная
    expect(plan.goals.educational.length).toBeGreaterThanOrEqual(2);
    expect(plan.goals.educational.length).toBeLessThanOrEqual(3);
    expect(plan.goals.developmental.length).toBeGreaterThanOrEqual(1);
    expect(plan.goals.developmental.length).toBeLessThanOrEqual(2);
    expect(plan.goals.nurturing.length).toBe(1);
    expect(plan.goals.educational[0]).toContain("Обыкновенные дроби");

    // Оборудование — 1–3 строки
    expect(plan.equipment.length).toBeGreaterThanOrEqual(1);
    expect(plan.equipment.length).toBeLessThanOrEqual(3);

    // Шаги — 5–6 штук, все нужные kind, тайминг ≈ 45 ± 2 мин
    expect(plan.stages.length).toBeGreaterThanOrEqual(5);
    expect(plan.stages.length).toBeLessThanOrEqual(6);
    const kinds = plan.stages.map((s) => s.kind);
    expect(kinds).toContain("org-moment");
    expect(kinds).toContain("motivation");
    expect(kinds).toContain("new-topic");
    expect(kinds).toContain("practice");
    expect(kinds).toContain("reflex");
    expect(kinds).toContain("homework");
    const totalMin = plan.stages.reduce((s, st) => s + st.durationMin, 0);
    expect(totalMin).toBeGreaterThanOrEqual(43);
    expect(totalMin).toBeLessThanOrEqual(47);

    // ДЗ — текст + 1–2 альтернативы
    expect(plan.homework.text.length).toBeGreaterThan(10);
    expect(plan.homework.alternatives?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(plan.homework.alternatives?.length ?? 0).toBeLessThanOrEqual(2);
  });
});

describe("generateLessonPlan — topic not found", () => {
  it("несуществующий slug темы → fallback на семейство, без падения", async () => {
    const plan: LessonPlan = await generateLessonPlan(
      baseReq({ topic: "ne-suschestvuyuschiy-slug-xyz" })
    );

    // Базовые поля заполнены, заголовок использует slug как fallback
    expect(plan.id).toBeTruthy();
    expect(plan.subject).toBe("math");
    expect(plan.grade).toBe(5);
    expect(plan.topic).toBe("ne-suschestvuyuschiy-slug-xyz");
    expect(plan.title).toContain("ne-suschestvuyuschiy-slug-xyz");

    // Нет ФГОС-раздела — null/undefined (не падаем)
    expect(plan.fgosRef).toBeFalsy();

    // Цели всё равно сгенерированы (по семейству math)
    expect(plan.goals.educational.length).toBeGreaterThan(0);
    expect(plan.goals.educational[0]).toContain("ne-suschestvuyuschiy-slug-xyz");
    expect(plan.goals.nurturing.length).toBe(1);

    // Оборудование и шаги на месте
    expect(plan.equipment.length).toBeGreaterThan(0);
    expect(plan.stages.length).toBe(6);
    const kinds = plan.stages.map((s) => s.kind);
    expect(kinds).toContain("new-topic");
    expect(kinds).toContain("practice");
  });

  it("неизвестный subject slug → fallback на default family", async () => {
    const plan: LessonPlan = await generateLessonPlan(
      baseReq({ subject: "unknown-subject" as GenerationRequest["subject"] })
    );
    // Не упали, шаги и goals всё равно есть
    expect(plan.stages.length).toBe(6);
    expect(plan.goals.educational.length).toBeGreaterThan(0);
    expect(plan.goals.nurturing.length).toBe(1);
  });
});

describe("generateLessonPlan — DOCX-экспорт", () => {
  it("возвращает непустой Blob с правильным MIME-типом", async () => {
    const plan = await generateLessonPlan(baseReq());
    const blob = await generateLessonPlanDocx(plan);

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(2000); // ZIP-контейнер DOCX с контентом
    // docx.Packer использует octet-stream как самый совместимый type
    expect(blob.type).toMatch(/zip|octet-stream|word/);
  });
});

describe("LessonPlanPreview — рендер", () => {
  it("happy plan: рендерит заголовок, цели, таблицу шагов и ДЗ", async () => {
    const plan = await generateLessonPlan(baseReq());
    const { container } = render(React.createElement(LessonPlanPreview, { plan }));

    // Заголовок плана
    expect(container.textContent).toContain("Обыкновенные дроби");
    expect(container.textContent).toContain("Цели урока");
    expect(container.textContent).toContain("Ход урока");
    expect(container.textContent).toContain("Домашнее задание");

    // Все 6 этапов присутствуют в таблице
    expect(container.textContent).toContain("1. Орг. момент");
    expect(container.textContent).toContain("2. Мотивация");
    expect(container.textContent).toContain("3. Новая тема");
    expect(container.textContent).toContain("4. Отработка");
    expect(container.textContent).toContain("5. Рефлексия");
    expect(container.textContent).toContain("6. Домашка");

    // Итог по времени — 45 мин
    expect(container.textContent).toContain("45 мин");
  });

  it("пустой план: показывает empty state 'Скоро будет'", () => {
    const emptyPlan: LessonPlan = {
      id: "test",
      title: "Пустой план",
      subject: "math",
      grade: 5,
      topic: "x",
      goals: { educational: [], developmental: [], nurturing: [] },
      equipment: [],
      stages: [],
      homework: { text: "" },
      createdAt: new Date().toISOString(),
    };
    const { container } = render(React.createElement(LessonPlanPreview, { plan: emptyPlan }));
    expect(container.textContent).toContain("Скоро будет");
    expect(container.textContent).not.toContain("Ход урока");
  });
});