/**
 * F-06.1 «Спроси ученика» — тесты панели вопросов (TZ-17 §11).
 *
 * Проверяем не «красиво ли отрендерилось», а три вещи, которые ломают фичу
 * по-настоящему:
 *
 *  1. Отбор по умолчанию берёт НЕВЕРНЫЕ и НЕРАЗОБРАННЫЕ задания, а не все
 *     подряд и не только неверные.
 *  2. Ошибка генерации НЕ ломает уже показанный результат проверки — панель
 *     уходит в одну строку, таблица результата остаётся.
 *  3. В UI нет слов «списал» / «детектор» / «похоже на ИИ» и нет процентов
 *     рядом с вопросами. Это продуктовое требование, а не стилистика: именно
 *     этими словами фича превращается в детектор, который мы сознательно не
 *     делаем (POSITIONING.md §10, 2026-10-02).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { InterviewQuestions } from "../InterviewQuestions";
import type { PhotoCheckResult } from "@/lib/photo-check/types";

const generate = vi.fn();
const load = vi.fn();

vi.mock("@/lib/photo-check/api", () => ({
  generateInterviewQuestions: (...args: unknown[]) => generate(...args),
  loadInterviewQuestions: (...args: unknown[]) => load(...args),
}));

function item(
  number: number,
  verdict: PhotoCheckResult["items"][number]["verdict"],
): PhotoCheckResult["items"][number] {
  return {
    number,
    taskText: `Задание ${number}`,
    expected: "10",
    studentAnswer: verdict === "correct" ? "10" : "8",
    correct: verdict === "correct",
    verdict,
    pointsAwarded: verdict === "correct" ? 1 : 0,
    maxPoints: 1,
    confidence: verdict === "unclear" ? 0.4 : 0.9,
    needsReview: verdict === "unclear",
    comment: null,
  };
}

/** 1 и 2 верные, 3 неверное, 4 неразобранное, 5 верное. */
const RESULT: PhotoCheckResult = {
  ok: true,
  checkId: "chk-1",
  status: "partial",
  totalPoints: 5,
  earnedPoints: 3,
  percentage: 60,
  gradeMark: "3",
  needsReview: true,
  items: [
    item(1, "correct"),
    item(2, "correct"),
    item(3, "incorrect"),
    item(4, "unclear"),
    item(5, "correct"),
  ],
  model: "gpt-6-luna",
  quota: { used: 1, limit: 10, resetAt: 0 },
  photoDeleteAt: 0,
};

const OK = {
  ok: true as const,
  questions: [
    { taskNumber: 3, taskText: "Задание 3", question: "Как ты получил это число?", verdictAtGeneration: "incorrect" as const, createdAt: 1 },
    { taskNumber: 4, taskText: "Задание 4", question: "Что означает эта величина?", verdictAtGeneration: "unclear" as const, createdAt: 1 },
  ],
  model: "deepseek-v4-flash",
  quota: { used: 1, limit: 5, resetAt: 0 },
  disclaimer: "Это не проверка на списывание. Решение принимаете вы.",
};

beforeEach(() => {
  generate.mockReset();
  load.mockReset();
  load.mockResolvedValue({ ok: true, questions: [] });
});

describe("InterviewQuestions — отрисовка", () => {
  it("рисует заголовок и дисклеймер, но НЕ рисует панель без checkId", async () => {
    const { container, rerender } = render(
      <InterviewQuestions result={RESULT} checkId={undefined} />,
    );
    expect(container.firstChild).toBeNull();

    rerender(<InterviewQuestions result={RESULT} checkId="chk-1" />);
    expect(await screen.findByText("Спроси ученика")).toBeInTheDocument();
  });

  it("в текстах панели нет обещаний детектора", async () => {
    render(<InterviewQuestions result={RESULT} checkId="chk-1" />);
    await screen.findByText("Спроси ученика");

    const panel = document.body.textContent ?? "";
    for (const banned of ["списал", "детектор", "похоже на ИИ", "процент"]) {
      expect(panel.toLowerCase()).not.toContain(banned);
    }
  });

  it("восстанавливает уже сохранённый набор вопросов, не заставляя жать кнопку", async () => {
    load.mockResolvedValue({
      ok: true,
      questions: OK.questions,
      disclaimer: OK.disclaimer,
    });
    render(<InterviewQuestions result={RESULT} checkId="chk-1" />);
    expect(await screen.findByText("Как ты получил это число?")).toBeInTheDocument();
    expect(generate).not.toHaveBeenCalled();
  });

  it("ошибка чтения не ломает панель — просто не показывает вопросы", async () => {
    load.mockResolvedValue({ ok: false, code: "network", message: "нет сети" });
    render(<InterviewQuestions result={RESULT} checkId="chk-1" />);
    await waitFor(() => expect(load).toHaveBeenCalled());
    expect(
      await screen.findByRole("button", { name: /Составить вопросы/ }),
    ).toBeInTheDocument();
  });
});

describe("InterviewQuestions — отбор заданий", () => {
  it("по умолчанию отмечены неверные и неразобранные, но не верные", async () => {
    render(<InterviewQuestions result={RESULT} checkId="chk-1" />);
    fireEvent.click(await screen.findByRole("button", { name: /Составить вопросы/ }));

    const checked = screen
      .getAllByRole("checkbox") as HTMLInputElement[];
    expect(checked).toHaveLength(5);

    // 3 — неверное, 4 — неразобранное. Остальные верные и не отмечены.
    expect(checked[2].checked).toBe(true);
    expect(checked[3].checked).toBe(true);
    expect(checked[0].checked).toBe(false);
    expect(checked[1].checked).toBe(false);
    expect(checked[4].checked).toBe(false);
  });

  it("учитель может снять отметку вручную, и в запрос уйдёт его выбор", async () => {
    generate.mockResolvedValue(OK);
    render(<InterviewQuestions result={RESULT} checkId="chk-1" />);
    fireEvent.click(await screen.findByRole("button", { name: /Составить вопросы/ }));

    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    fireEvent.click(boxes[3]); // снимаем неразобранное задание 4
    fireEvent.click(boxes[0]); // добавляем верное задание 1 — это разрешено
    fireEvent.click(screen.getByRole("button", { name: /^Составить вопросы/ }));

    await waitFor(() => expect(generate).toHaveBeenCalled());
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ checkId: "chk-1", taskNumbers: [1, 3] }),
    );
  });
});

describe("InterviewQuestions — результат и отказ", () => {
  it("после генерации показывает вопросы и кнопки работы с ними", async () => {
    generate.mockResolvedValue(OK);
    render(<InterviewQuestions result={RESULT} checkId="chk-1" />);
    fireEvent.click(await screen.findByRole("button", { name: /Составить вопросы/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Составить вопросы/ }));

    expect(await screen.findByText("Как ты получил это число?")).toBeInTheDocument();
    expect(screen.getByText("Что означает эта величина?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Скопировать/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Печать/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Другие вопросы/ })).toBeInTheDocument();
  });

  it("дисклеймер берётся с сервера, а не из вёрстки", async () => {
    generate.mockResolvedValue({ ...OK, disclaimer: "Дисклеймер от бэка" });
    render(<InterviewQuestions result={RESULT} checkId="chk-1" />);
    fireEvent.click(await screen.findByRole("button", { name: /Составить вопросы/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Составить вопросы/ }));

    expect(await screen.findByText(/Дисклеймер от бэка/)).toBeInTheDocument();
  });

  it("при отказе бэка показывает одну строку и предлагает повторить", async () => {
    generate.mockResolvedValue({
      ok: false,
      code: "quota",
      message: "Месячный лимит вопросов исчерпан",
    });
    render(<InterviewQuestions result={RESULT} checkId="chk-1" />);
    fireEvent.click(await screen.findByRole("button", { name: /Составить вопросы/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Составить вопросы/ }));

    expect(
      await screen.findByText("Месячный лимит вопросов исчерпан"),
    ).toBeInTheDocument();
    // Вопросов нет — значит, панель не превратилась в выдуманный результат.
    expect(screen.queryByText("Как ты получил это число?")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Попробовать снова/ })).toBeInTheDocument();
  });
});
