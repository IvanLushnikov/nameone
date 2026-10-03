/**
 * Ручные отметки учителя в интерфейсе (ТЗ-19).
 *
 * Закрывает дыру, которую не видит ни один бэкенд-тест: раньше блок «Проверьте
 * сами» был локальным состоянием, и текст прямо говорил учителю «эти отметки
 * остаются только на этом экране». То есть фича работала ровно до первого
 * закрытия вкладки.
 *
 * Что здесь защищаем — поведение, без которого интерфейс вводит в заблуждение:
 *   1. кнопка сохранения уходит с тем телом, которое ждёт бэк, и только по
 *      явному клику (никакого автосейва на чекбокс);
 *   2. после успеха учитель видит «Сохранено» и итоговую отметку, а отметка
 *      учителя помечена как «вы» — это и есть требование «в выгрузке видно, чья
 *      это отметка»;
 *   3. при ошибке показан текст С ПРИЧИНОЙ, а поля остались заполненными —
 *      иначе учитель заново расставляет галочки из-за сети;
 *   4. неполный разбор честно говорит «не разобрано» и не рисует отметку.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ManualMarksEditor } from "@/components/f06/ManualMarksEditor";
import { PhotoCheckResultView } from "@/components/f06/PhotoCheckResult";
import { partitionByDecision } from "@/lib/photo-check/confidence";
import type {
  PhotoCheckItem,
  PhotoCheckManualMark,
  PhotoCheckResult,
} from "@/lib/photo-check/types";

const saveManualMarks = vi.fn();
const runPhotoCheck = vi.fn();

vi.mock("@/lib/photo-check/api", () => ({
  saveManualMarks: (...args: unknown[]) => saveManualMarks(...args),
  runPhotoCheck: (...args: unknown[]) => runPhotoCheck(...args),
  deletePhotoCheck: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

// Таблица результата тянет «Спроси ученика» (F-06.1) — тот ходит в API за
// вопросами, а здесь мы проверяем колонку «Решил», а не интервью.
vi.mock("@/components/f06/InterviewQuestions", () => ({
  InterviewQuestions: () => null,
}));

beforeEach(() => {
  saveManualMarks.mockReset();
  runPhotoCheck.mockReset();
});

function item(
  number: number,
  verdict: PhotoCheckItem["verdict"],
  needsReview: boolean,
  maxPoints = 1,
): PhotoCheckItem {
  return {
    number,
    taskText: `Задание ${number}`,
    expected: "10",
    studentAnswer: verdict === "correct" ? "10" : "8",
    correct: verdict === "correct",
    verdict,
    pointsAwarded: verdict === "correct" ? maxPoints : 0,
    maxPoints,
    confidence: needsReview ? 0.4 : 0.9,
    needsReview,
    comment: null,
    decidedBy: "model",
    modelVerdict: verdict,
    modelPoints: verdict === "correct" ? maxPoints : 0,
    teacherAccepted: null,
    teacherPoints: null,
    manualUpdatedAt: null,
  };
}

/** Три задания: одно машина решила, два ждут учителя. */
const ITEMS: PhotoCheckItem[] = [
  item(1, "correct", false, 2),
  item(2, "incorrect", true),
  item(3, "unclear", true),
];

const NO_MARKS: PhotoCheckManualMark[] = [];

function renderEditor(overrides: {
  onSave?: (marks: Array<{ taskNumber: number; accepted: boolean; points: number }>) => Promise<void>;
  initialMarks?: PhotoCheckManualMark[];
  errorMessage?: string | null;
} = {}) {
  const onSave = overrides.onSave ?? vi.fn().mockResolvedValue(undefined);
  return {
    onSave,
    ...render(
      <ManualMarksEditor
        partition={partitionByDecision(ITEMS, overrides.initialMarks ?? NO_MARKS)}
        initialMarks={overrides.initialMarks ?? NO_MARKS}
        onSave={onSave}
        errorMessage={overrides.errorMessage}
      />,
    ),
  };
}

describe("ManualMarksEditor — отметки учителя (ТЗ-19)", () => {
  it("кнопка сохранения уходит с нужным телом и только по клику", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderEditor({ onSave });

    // До клика ничего не уходит — никакого автосохранения.
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("manual-mark-2"));
    fireEvent.click(screen.getByTestId("manual-marks-save"));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    // Уходит ровно то, к чему учитель прикоснулся: задание 3 он не трогал,
    // и отправлять «не засчитано» за него нельзя — это было бы его решением,
    // которого не было.
    expect(onSave).toHaveBeenCalledWith([{ taskNumber: 2, accepted: true, points: 1 }]);
  });

  it("после успеха — «Сохранено», кнопка гаснет до изменения отметок", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderEditor({ onSave });

    fireEvent.click(screen.getByTestId("manual-mark-2"));
    fireEvent.click(screen.getByTestId("manual-marks-save"));

    await waitFor(() => expect(screen.getByTestId("manual-marks-saved")).toBeTruthy());
    expect(document.body.textContent).toContain("Сохранено");
    // Повторный клик по неактивной кнопке ничего не отправляет.
    expect((screen.getByTestId("manual-marks-save") as HTMLButtonElement).disabled).toBe(true);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("при ошибке показан текст с причиной, а поля НЕ очищены", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("boom"));
    renderEditor({
      onSave,
      errorMessage: "Сеть недоступна. Проверьте соединение.",
    });

    fireEvent.click(screen.getByTestId("manual-mark-2"));
    fireEvent.click(screen.getByTestId("manual-marks-save"));

    await waitFor(() => expect(screen.getByTestId("manual-marks-error")).toBeTruthy());
    // Причина, а не «что-то пошло не так».
    expect(document.body.textContent).toContain("Сеть недоступна");
    // Галочка на месте — учителю не нужно расставлять всё заново.
    expect((screen.getByTestId("manual-mark-2") as HTMLInputElement).checked).toBe(true);
    // И «Сохранено» не показано.
    expect(screen.queryByTestId("manual-marks-saved")).toBeNull();
    // Кнопка снова активна: повторить можно.
    expect((screen.getByTestId("manual-marks-save") as HTMLButtonElement).disabled).toBe(false);
  });

  it("неполный разбор честно говорит, сколько ждёт, и не рисует отметку", () => {
    renderEditor();
    expect(document.body.textContent).toContain("Осталось без вашего решения: 2");
    // Ключевое: учитель не видит «4», которой никто не ставил.
    expect(document.body.textContent).not.toContain("оценка");
  });

  it("уже сохранённые отметки открываются отмеченными и помечены как ваши", () => {
    const saved: PhotoCheckManualMark[] = [
      { taskNumber: 2, accepted: true, points: 1, updatedAt: 1_700_000_000 },
    ];
    renderEditor({ initialMarks: saved });

    expect((screen.getByTestId("manual-mark-2") as HTMLInputElement).checked).toBe(true);
    expect(document.body.textContent).toContain("Сохранено вами");
    // Ждать осталось одно, а не два.
    expect(document.body.textContent).toContain("Осталось без вашего решения: 1");
  });

  it("без изменений кнопка неактивна — учитель не отправляет пустоту", () => {
    renderEditor();
    expect((screen.getByTestId("manual-marks-save") as HTMLButtonElement).disabled).toBe(true);
    expect(document.body.textContent).toContain("остаются только на этом экране");
  });
});

/**
 * Требование ТЗ-19: «в выгрузке видно, какие отметки поставил учитель, а какие
 * — модель». Выгрузка здесь — это то, что уходит на печать: `window.print()`
 * печатает страницу целиком вместе с таблицей. Значит слово «вы»/«ИИ» должно
 * быть в разметке самой таблицы, а не в подсказке при наведении.
 */
describe("выгрузка результата: чья это отметка (ТЗ-19 §2)", () => {
  const result = {
    ok: true as const,
    checkId: "pc_print01",
    status: "ok" as const,
    totalPoints: 3,
    earnedPoints: 3,
    percentage: 100,
    gradeMark: "5" as const,
    needsReview: false,
    items: [
      { ...ITEMS[0] }, // машина справилась сама
      { ...ITEMS[1], verdict: "correct" as const, pointsAwarded: 1, decidedBy: "teacher" as const, modelVerdict: "incorrect" as const },
    ],
    manualMarks: [{ taskNumber: 2, accepted: true, points: 1, updatedAt: 1_700_000_000 }],
    pendingReview: 0,
    model: {},
    photoDeleted: false,
    photoDeleteAt: null,
    createdAt: 1_700_000_000,
    completedAt: 1_700_000_100,
  };

  it("рядом с отметкой стоит, кто её поставил, и видно, что было до правки", () => {
    render(
      <PhotoCheckResultView
        result={result as unknown as PhotoCheckResult}
        onDeletePhoto={vi.fn()}
        onPrint={vi.fn()}
        checkId="pc_print01"
      />,
    );

    expect(document.body.textContent).toContain("Решил");
    // Машинная строка помечена как ИИ, ручная — как «вы».
    expect(screen.getAllByText("ИИ").length).toBeGreaterThan(0);
    expect(screen.getByText("вы")).toBeTruthy();
    // Учитель согласился с заданием, которое машина посчитала неверным —
    // это обязано быть видно, иначе правка выглядит как ошибка распознавания.
    expect(document.body.textContent).toContain("ИИ считал: Неверно");
  });
});
