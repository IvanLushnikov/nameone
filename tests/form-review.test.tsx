/**
 * Ручная проверка ответа в сводке по выданной форме (12.10.2026).
 *
 * Закрывает тот самый тупик, из-за которого флоу учителя не работал: сводка
 * показывала «ждут проверки N», и закрыть её было НЕЧЕМ — ни кнопок в
 * интерфейсе, ни эндпоинта на сервере. Учитель физически не мог выставить
 * оценку присланной работе.
 *
 * Что здесь защищаем — не вёрстка, а поведение:
 *   1. панель проверки появляется там, где ответ ждёт учителя, и НЕ появляется
 *      там, где всё уже решено (иначе экран превращается в простыню кнопок);
 *   2. кнопка сохранения заблокирована, пока учитель не выбрал верно/неверно —
 *      иначе можно сохранить пустую оценку и потерять ответ;
 *   3. поле балла есть только когда за задание больше одного балла;
 *   4. балл проверяется на границах: больше максимума — ошибка, запрос не уходит;
 *   5. успешное сохранение перечитывает сводку, чтобы «Ждут проверки» и средний
 *      балл обновились — иначе учитель видит старые нули;
 *   6. ошибка API показывается текстом, а не молча проглатывается.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { FormSummary } from "@/components/teacher/FormSummary";
import type { FormResponseAnswer } from "@/lib/forms/types";

const getForm = vi.fn();
const reviewAnswer = vi.fn();
const patchForm = vi.fn();
const fetchFormCsv = vi.fn();

vi.mock("@/lib/forms/api", () => ({
  getForm: (id: string) => getForm(id),
  reviewAnswer: (args: unknown) => reviewAnswer(args),
  patchForm: (id: string, action: string) => patchForm(id, action),
  fetchFormCsv: (id: string) => fetchFormCsv(id),
}));

beforeEach(() => {
  getForm.mockReset();
  reviewAnswer.mockReset();
  patchForm.mockReset();
  fetchFormCsv.mockReset();
});

const FORM = {
  id: "frm_1",
  token: "tok",
  title: "Дроби, 5 класс",
  subject: "Математика",
  grade: 5,
  status: "open" as const,
  showAnswers: false,
  checkMode: "auto",
  accessCode: null,
  closedAt: null,
  createdAt: 1_700_000_000,
  expiresAt: 1_700_100_000,
  responsesCount: 1,
  scoreAvg: 0,
  scoreMaxAvg: 2,
  tasks: [
    { number: 1, text: "Что такое атмосфера?", type: "short-answer" as const, answer: "воздух", points: 2 },
  ],
};

const RESPONSE_ANSWERS: FormResponseAnswer[] = [
  {
    taskNumber: 1,
    studentAnswer: "Воздух",
    isCorrect: null,
    pointsAwarded: 0,
    pointsMax: 2,
    needsReview: true,
    checkMethod: "manual",
    teacherComment: null,
  },
];

const RESPONSE = {
  id: "rsp_1",
  studentName: "Аня",
  studentLabel: "5А",
  scoreTotal: 0,
  scoreMax: 2,
  durationSec: 240,
  submittedAt: 1_700_000_100,
  answers: RESPONSE_ANSWERS,
};

function renderSummary(answers: FormResponseAnswer[] = RESPONSE_ANSWERS) {
  getForm.mockResolvedValue({
    ok: true,
    form: FORM,
    responses: [{ ...RESPONSE, answers }],
  });
  return render(<FormSummary formId="frm_1" />);
}

/** Открыть раскрытый ответ ученика. */
async function openResponse() {
  const row = await screen.findByTestId("response-row-rsp_1");
  fireEvent.click(row);
}

describe("Сводка по форме — ручная проверка ответа", () => {
  it("автоматический минус тоже можно перебить — блокирующая находка ревью", async () => {
    // Сверка поставила ✗ и 0 баллов: needsReview = false, панели не было, и
    // учитель не мог ничего изменить — ответ закрывался навсегда. Именно этот
    // тупик коммит и чинил, только в другой форме.
    renderSummary([
      {
        taskNumber: 1,
        studentAnswer: "7 / 8",
        isCorrect: false,
        pointsAwarded: 0,
        pointsMax: 2,
        needsReview: false,
        checkMethod: "auto",
        teacherComment: null,
      },
    ]);
    await openResponse();

    const box = screen.getByTestId("review-box-1");
    expect(box.textContent).toContain("Автопроверка не засчитала ответ");
  });

  it("пропущенное задание панели не получает — «записал иначе» тут бессмысленно", async () => {
    renderSummary([
      {
        taskNumber: 1,
        studentAnswer: null,
        isCorrect: false,
        pointsAwarded: 0,
        pointsMax: 2,
        needsReview: false,
        checkMethod: "auto",
        teacherComment: null,
      },
    ]);
    await openResponse();

    expect(screen.queryByTestId("review-box-1")).toBeNull();
    expect(document.body.textContent).toContain("без ответа");
  });

  it("у верного ответа с баллами панели нет — незачем учителю трогать то, что верно", async () => {
    renderSummary([
      {
        taskNumber: 1,
        studentAnswer: "воздух",
        isCorrect: true,
        pointsAwarded: 2,
        pointsMax: 2,
        needsReview: false,
        checkMethod: "auto",
        teacherComment: null,
      },
    ]);
    await openResponse();

    expect(screen.queryByTestId("review-box-1")).toBeNull();
  });

  it("пустое поле балла при «Верно» = полный балл, а не ноль", async () => {
    renderSummary();
    await openResponse();

    reviewAnswer.mockResolvedValue({ ok: true, taskNumber: 1, scoreTotal: 2 });

    fireEvent.click(screen.getByTestId("review-yes-1"));
    // Поле оставили пустым — учитель просто не стал его трогать.
    fireEvent.click(screen.getByTestId("review-save-1"));

    await waitFor(() => {
      expect(reviewAnswer).toHaveBeenCalledWith({
        formId: "frm_1",
        responseId: "rsp_1",
        taskNumber: 1,
        isCorrect: true,
      });
    });
    // pointsAwarded не отправляется — сервер возьмёт полный балл.
    const call = reviewAnswer.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.pointsAwarded).toBeUndefined();
  });
  it("учитель видит текст задания и правильный ответ, которых раньше не было", async () => {
    renderSummary();
    await openResponse();

    expect(document.body.textContent).toContain("Что такое атмосфера?");
    expect(document.body.textContent).toContain("Правильный ответ:");
  });

  it("сохранить нельзя, пока не выбран верно/неверно", async () => {
    renderSummary();
    await openResponse();

    const save = await screen.findByTestId("review-save-1");
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(save);
    expect(reviewAnswer).not.toHaveBeenCalled();
  });

  it("поле балла есть, когда за задание больше одного балла", async () => {
    renderSummary();
    await openResponse();
    expect(screen.getByTestId("review-points-1")).toBeTruthy();
  });

  it("поля балла нет, когда за задание один балл — «верно» и есть «1 балл»", async () => {
    renderSummary([{ ...RESPONSE.answers[0]!, pointsMax: 1 }]);
    await openResponse();
    expect(screen.queryByTestId("review-points-1")).toBeNull();
  });

  it("балл больше максимума — понятная ошибка, запрос не уходит", async () => {
    renderSummary();
    await openResponse();

    fireEvent.click(screen.getByTestId("review-yes-1"));
    fireEvent.change(screen.getByTestId("review-points-1"), { target: { value: "5" } });
    fireEvent.click(screen.getByTestId("review-save-1"));

    await waitFor(() => {
      expect(document.body.textContent).toContain("Балл должен быть целым числом от 0 до 2");
    });
    expect(reviewAnswer).not.toHaveBeenCalled();
  });

  it("верно с частичным баллом и комментарием уходит на сервер и сводка перечитывается", async () => {
    getForm.mockResolvedValue({ ok: true, form: FORM, responses: [{ ...RESPONSE }] });
    render(<FormSummary formId="frm_1" />);
    await openResponse();

    reviewAnswer.mockResolvedValue({ ok: true, taskNumber: 1, scoreTotal: 1 });

    fireEvent.click(screen.getByTestId("review-yes-1"));
    fireEvent.change(screen.getByTestId("review-points-1"), { target: { value: "1" } });
    fireEvent.change(screen.getByTestId("review-comment-1"), {
      target: { value: "Хорошо, но без запятой" },
    });
    fireEvent.click(screen.getByTestId("review-save-1"));

    await waitFor(() => {
      expect(reviewAnswer).toHaveBeenCalledWith({
        formId: "frm_1",
        responseId: "rsp_1",
        taskNumber: 1,
        isCorrect: true,
        pointsAwarded: 1,
        comment: "Хорошо, но без запятой",
      });
    });
    // Сводка обязана перечитаться — иначе «Ждут проверки» и балл останутся старыми.
    await waitFor(() => {
      expect(getForm.mock.calls.length).toBeGreaterThan(1);
    });
  });

  it("ошибка сервера показывается текстом, а не проглатывается", async () => {
    renderSummary();
    await openResponse();

    reviewAnswer.mockResolvedValue({ ok: false, error: "internal" });

    fireEvent.click(screen.getByTestId("review-no-1"));
    fireEvent.click(screen.getByTestId("review-save-1"));

    await waitFor(() => {
      expect(document.body.textContent).toContain("Что-то сломалось на нашей стороне");
    });
  });

  it("уже проверенный ответ: панели нет, комментарий виден", async () => {
    renderSummary([
      {
        taskNumber: 1,
        studentAnswer: "воздух",
        isCorrect: true,
        pointsAwarded: 2,
        pointsMax: 2,
        needsReview: false,
        checkMethod: "auto",
        teacherComment: "Отлично",
      },
    ]);
    await openResponse();

    expect(screen.queryByTestId("review-box-1")).toBeNull();
    // Комментарий учителя при этом виден.
    expect(document.body.textContent).toContain("Отлично");
  });
});

/**
 * Ответ с выбором варианта учитель должен видеть текстом, а не индексом.
 *
 * Ученик отправляет индекс («2»), и раньше в сводке светилось ровно «2» —
 * учитель не знал, что за «2» стоит, и сверял работу по невидимому правильному
 * ответу. Для multiple-choice показываем текст выбранного варианта и эталон.
 */
describe("Сводка по форме — ответ с выбором варианта", () => {
  const CHOICE_FORM = {
    ...FORM,
    tasks: [
      {
        number: 1,
        text: "Сколько дней в неделе?",
        type: "multiple-choice" as const,
        options: ["5", "6", "7"],
        answer: "2",
        points: 1,
      },
    ],
  };

  function renderChoice(studentAnswer: string) {
    getForm.mockResolvedValue({
      ok: true,
      form: CHOICE_FORM,
      responses: [
        {
          ...RESPONSE,
          scoreMax: 1,
          answers: [
            {
              taskNumber: 1,
              studentAnswer,
              isCorrect: null,
              pointsAwarded: 0,
              pointsMax: 1,
              needsReview: true,
              checkMethod: "manual",
              teacherComment: null,
            },
          ],
        },
      ],
    });
    return render(<FormSummary formId="frm_1" />);
  }

  it("учитель видит текст выбранного варианта, а не индекс", async () => {
    renderChoice("2");
    await openResponse();

    expect(document.body.textContent).toContain("7");
    // Индекс сам по себе больше не светится.
    expect(screen.queryByText("2", { exact: true })).toBeNull();
  });

  it("правильный ответ показан текстом варианта", async () => {
    renderChoice("2");
    await openResponse();

    const box = screen.getByTestId("review-box-1");
    // «Правильный ответ: 7», а не «Правильный ответ: 2».
    expect(box.textContent).toContain("Правильный ответ: 7");
  });

  it("индекс вне границ не ломает экран — показываем сырое значение", async () => {
    renderChoice("99");
    await openResponse();

    expect(screen.getByTestId("review-box-1")).toBeTruthy();
    expect(document.body.textContent).toContain("99");
  });
});