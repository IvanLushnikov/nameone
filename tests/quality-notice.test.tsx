/**
 * Учитель ВИДИТ потери материала (ТЗ-25, разрыв 5 / AD-7).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ЛОВИТСЯ
 * ─────────────────────────────────────────────────────────────────────────────
 * Бэк теперь честно отдаёт `quality` и `variants`. Но этого мало: если фронт эти
 * поля игнорирует, учитель по-прежнему получит укороченный лист и узнает об
 * этом дома — то есть весь бэкенд ТЗ-25 будет работать вхолостую.
 *
 * Раньше обе потери были молчаливыми:
 *   · контрольная без второго варианта — фронт не отличал «второй не нужен» от
 *     «второй не получился» и просто не рисовал переключатель;
 *   · укороченный материал — вообще нигде не отмечался.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ПОЧЕМУ ЧИСТАЯ ФУНКЦИЯ, А НЕ ТОЛЬКО ТЕСТ КОМПОНЕНТА
 * ─────────────────────────────────────────────────────────────────────────────
 * Текст предупреждения собирается в `buildQualityNotice` — и именно там
 * принимается решение, ПОКАЗЫВАТЬ ЛИ БЛОК ВООБЩЕ. Если это решение живёт в JSX,
 * его нельзя проверить списком таблиц: «блок не нарисован» и «блок нарисован с
 * пустым текстом» выглядят на скриншоте одинаково.
 */
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  buildQualityNotice,
  type QualityNotice as Notice,
} from "@/lib/constructor/quality-notice";
import { QualityNoticeBanner } from "@/components/constructor/QualityNoticeBanner";
import type { QualityLoss, VariantStatus } from "@/lib/client/llm";

/** Признаки «ничего не потеряно». */
const clean: QualityLoss = {
  requested: 10,
  delivered: 10,
  dropped: 0,
  droppedPatternRef: [],
  droppedForeignMath: [],
  cleanedAnswer: [],
  topUpAdded: 0,
  stillMissing: 0,
  filterBackedOff: false,
    repeatedSkills: 0,
};

const noVariants: VariantStatus = { expected: 1, delivered: 1, degraded: false, retried: false };

describe("buildQualityNotice: когда блок появляется, а когда нет", () => {
  it("чистый материал — блока нет (пустое «всё в порядке» было бы тем же молчанием)", () => {
    expect(buildQualityNotice(clean, noVariants)).toBeNull();
  });

  it("нехватка заданий — блок ЕСТЬ, и в нём названы оба числа", () => {
    const notice = buildQualityNotice(
      { ...clean, requested: 15, delivered: 11, dropped: 4, stillMissing: 4 },
      noVariants,
    );
    expect(notice).not.toBeNull();
    // Учитель должен видеть РОВНО то, чего просил, и то, что получил.
    expect(notice?.title).toContain("15");
    expect(notice?.title).toContain("11");
    expect(notice?.tone).toBe("warning");
    // И понимать, что попытка добрать уже была.
    expect(notice?.lines.join(" ")).toContain("4");
  });

  it("причина потери названа прямо, а не «часть заданий пропала»", () => {
    const notice = buildQualityNotice(
      {
        ...clean,
        requested: 12,
        delivered: 9,
        dropped: 3,
        stillMissing: 3,
        droppedPatternRef: [4, 5, 6],
      },
      noVariants,
    );
    // «Выкинули» без причины выглядит как «учитель попросил не то».
    expect(notice?.lines.join(" ")).toContain("образец");
    // Согласование: «3 задания», а не «3 заданий» — иначе учитель видит в
    // блоке предупреждения чужеродный текст и перестаёт его читать.
    expect(notice?.lines.join(" ")).toContain("3 задания отклонено");
  });

  it("существительное согласуется с числом: 1 / 2 / 5 / 11 / 21", () => {
    const txt = (dropped: number) =>
      buildQualityNotice(
        { ...clean, requested: dropped, delivered: 0, dropped, stillMissing: dropped },
        noVariants,
      )?.lines.join(" ") ?? "";
    expect(txt(1)).toContain("1 задание отклонено");
    expect(txt(2)).toContain("2 задания отклонено");
    expect(txt(5)).toContain("5 заданий отклонено");
    expect(txt(11)).toContain("11 заданий отклонено"); // 11 → «заданий», не «задание»
    expect(txt(21)).toContain("21 задание отклонено");
  });

  it("дозапрос, закрывший нехватку, НЕ пугает учителя", () => {
    // Дозапрос сделал работу — сообщение об исчезнувших заданиях было бы ложью.
    const notice = buildQualityNotice(
      { ...clean, requested: 12, delivered: 12, dropped: 3, topUpAdded: 3 },
      noVariants,
    );
    expect(notice).toBeNull();
  });

  it("контрольная без второго варианта — блок ЕСТЬ и говорит про сравнимость", () => {
    const notice = buildQualityNotice(clean, {
      expected: 2,
      delivered: 1,
      degraded: true,
      degradedReason: "модель вернула один вариант вместо двух",
      retried: false,
    });
    expect(notice).not.toBeNull();
    expect(notice?.lines.join(" ")).toContain("сравнивать");
    expect(notice?.lines.join(" ")).toContain("один вариант");
  });

  it("о деградации сказано, что повторная попытка была", () => {
    const notice = buildQualityNotice(clean, {
      expected: 2,
      delivered: 1,
      degraded: true,
      degradedReason: "второй вариант повторил первый",
      retried: true,
    });
    expect(notice?.lines.join(" ")).toContain("перегенерировать");
  });

  it("нехватка заданий и провал вариантов не теряют друг друга", () => {
    // Обе потери сразу — обе обязаны попасть в текст, а не одна «победить».
    const notice = buildQualityNotice(
      { ...clean, requested: 20, delivered: 15, stillMissing: 5 },
      { expected: 2, delivered: 1, degraded: true, retried: true },
    );
    const text = notice?.lines.join(" ") ?? "";
    expect(text).toContain("20");
    expect(text).toContain("15");
    expect(notice?.lines.length).toBeGreaterThan(2);
  });
});

describe("QualityNoticeBanner: блок виден без нажатий", () => {
  it("рисуется как alert с заголовком и списком строк", () => {
    const notice: Notice = {
      tone: "warning",
      title: "Получено 11 заданий из 15",
      lines: ["Вы просили 15 заданий, в материале 11."],
    };
    render(<QualityNoticeBanner notice={notice} />);
    // role=alert — чтобы скринридер прочитал сразу, а не «когда дойдёт».
    const el = screen.getByRole("alert");
    expect(el).toBeTruthy();
    expect(el.textContent).toContain("11 заданий из 15");
    expect(el.textContent).toContain("в материале 11");
  });

  it("находится по стабильному testid, а не по тексту-рыбе", () => {
    const notice: Notice = { tone: "warning", title: "Т", lines: ["строка"] };
    render(<QualityNoticeBanner notice={notice} />);
    expect(screen.getByTestId("quality-notice")).toBeTruthy();
  });

  it("пустой текст не рисуется вовсе — вызывающий код обязан решить сам", () => {
    // null = «показывать нечего». Компонент с пустым содержимым был бы блоком,
    // который занимает место и ничего не говорит.
    expect(buildQualityNotice(clean, noVariants)).toBeNull();
  });
});