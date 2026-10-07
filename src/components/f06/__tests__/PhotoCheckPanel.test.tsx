/**
 * Панель проверки: честная неуверенность распознавания (ТЗ-18, блок В).
 *
 * Проверяем то, что реально ломает доверие, а не разметку:
 *  1. Сомнительное задание уходит в блок «Проверьте сами» В НАЧАЛО, а из
 *     общей таблицы пропадает — иначе учитель видит обычную галочку там, где
 *     мы сами не доверяем чтению.
 *  2. Поля отметки пустые: значение модели не подставляется никогда.
 *  3. При неполном разборе итоговой отметки и процента на экране нет.
 *  4. Ошибка сети и ошибка распознавания дают разные тексты и разные кнопки.
 *  5. Проверка, которая не состоялась (`status: "failed"`), не превращается в
 *     нули и пустую отметку.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PhotoCheckPanel } from "../PhotoCheckPanel";
import type { PhotoCheckItem, PhotoCheckResult } from "@/lib/photo-check/types";

const runPhotoCheck = vi.fn();
const deletePhotoCheck = vi.fn();
const loadInterviewQuestions = vi.fn();
const generateInterviewQuestions = vi.fn();
const saveManualMarks = vi.fn();

vi.mock("@/lib/photo-check/api", () => ({
  runPhotoCheck: (...args: unknown[]) => runPhotoCheck(...args),
  deletePhotoCheck: (...args: unknown[]) => deletePhotoCheck(...args),
  loadInterviewQuestions: (...args: unknown[]) => loadInterviewQuestions(...args),
  generateInterviewQuestions: (...args: unknown[]) => generateInterviewQuestions(...args),
  saveManualMarks: (...args: unknown[]) => saveManualMarks(...args),
}));

// Сжатие через canvas в jsdom не работает — подменяем на no-op, чтобы тест
// про фото, а не про пиксели.
vi.mock("@/lib/utils/image", () => ({
  compressImage: async (blob: Blob) => blob,
  formatBytes: () => "120 КБ",
}));

function item(over: Partial<PhotoCheckItem>): PhotoCheckItem {
  return {
    number: 1,
    taskText: `Задание ${over.number ?? 1}`,
    expected: "10",
    studentAnswer: "10",
    correct: true,
    verdict: "correct",
    pointsAwarded: 1,
    maxPoints: 1,
    confidence: 0.95,
    needsReview: false,
    comment: null,
    ...over,
  };
}

/**
 * 1 — сервер уверен, 2 — сервер попросил учителя, 3 — не найдено.
 *
 * ПРОМЕНЕНО при слиянии с ТЗ-19: раньше фикстура изображала ситуацию «бэк
 * уверен, но мы сомневаемся» (`status: "ok"`, `needsReview: false` у всех),
 * и блок появлялся по клиентскому порогу. Решение владельца от 04.10.2026:
 * решает сервер. Поэтому фикстура — честный частичный ответ: сервер сам
 * просит учителя разобрать 2 и 3, и итоговой отметки у него нет.
 */
const RESULT: PhotoCheckResult = {
  ok: true,
  checkId: "chk-1",
  status: "partial",
  totalPoints: 3,
  earnedPoints: 1,
  percentage: null,
  gradeMark: null,
  needsReview: true,
  items: [
    item({ number: 1, taskText: "Сложение", confidence: 0.95, needsReview: false }),
    item({ number: 2, taskText: "Уравнение", confidence: 0.6, needsReview: true }),
    item({
      number: 3,
      taskText: "Задача",
      studentAnswer: null,
      verdict: "unclear",
      correct: false,
      pointsAwarded: 0,
      confidence: null,
      needsReview: true,
    }),
  ],
  model: "gpt-6-luna",
  quota: { used: 1, limit: 10, resetAt: 0 },
  photoDeleteAt: 0,
};

const TASKS = [
  { number: 1, taskText: "Сложение", correctAnswer: "10", maxPoints: 1 },
  { number: 2, taskText: "Уравнение", correctAnswer: "10", maxPoints: 1 },
  { number: 3, taskText: "Задача", correctAnswer: "10", maxPoints: 1 },
];

async function submitPhoto() {
  const { container } = render(
    <PhotoCheckPanel assignmentId="local-ws_1" demoTasks={TASKS} />,
  );
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(["x"], "page.jpg", { type: "image/jpeg" });
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(screen.getByText(/page\.jpg/)).toBeInTheDocument());
  fireEvent.click(screen.getByRole("checkbox", { name: /понимаю, что загружаю фото/i }));
  fireEvent.click(screen.getByRole("button", { name: /^Проверить$/ }));
  return { container };
}

beforeAll(() => {
  // jsdom не умеет object URL, а загрузчик без него падает на превью.
  if (!URL.createObjectURL) URL.createObjectURL = () => "blob:preview";
  if (!URL.revokeObjectURL) URL.revokeObjectURL = () => undefined;
});

beforeEach(() => {
  runPhotoCheck.mockReset();
  deletePhotoCheck.mockReset();
  loadInterviewQuestions.mockReset();
  generateInterviewQuestions.mockReset();
  loadInterviewQuestions.mockResolvedValue({ ok: true, questions: [] });
  saveManualMarks.mockReset();
});

describe("Проверьте сами", () => {
  it("блок с сомнительными идёт первым, и в общей таблице их нет", async () => {
    runPhotoCheck.mockResolvedValue(RESULT);
    const { container } = await submitPhoto();

    const block = await screen.findByRole("heading", { name: /Проверьте сами/ });
    expect(block).toBeInTheDocument();
    expect(block.textContent).toContain("2"); // 2 и 3 — к проверке

    // Сомнительные задания видны в блоке…
    expect(screen.getByText("Уравнение")).toBeInTheDocument();
    expect(screen.getByText("Задача")).toBeInTheDocument();

    // …и их НЕТ в таблице: в ней осталось только уверенно прочитанное задание.
    const rows = container.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("Сложение");

    // Блок стоит ДО таблицы, а не после неё.
    const table = container.querySelector("table") as HTMLElement;
    const section = block.closest("section") as HTMLElement;
    expect(section.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("показывает, что именно модель прочитала, и с какой уверенностью", async () => {
    runPhotoCheck.mockResolvedValue(RESULT);
    await submitPhoto();

    // Что модель нашла — учитель сверяет глазом, ничего не зачитывая заново.
    expect(await screen.findByText(/Модель прочитала: 10/)).toBeInTheDocument();
    // Уверенность показываем числом; где её нет — говорим «нет данных»,
    // а не прочерк и не «всё хорошо».
    expect(screen.getByText(/Уверенность чтения: 60%/)).toBeInTheDocument();
    expect(screen.getByText(/Модель не нашла здесь ответа/)).toBeInTheDocument();
    // Эталон виден: без него нечего сверять с работой. Он одинаков у обоих
    // заданий, поэтому ищем «хотя бы один», а не единственный.
    expect(screen.getAllByText(/Эталон: 10/).length).toBeGreaterThan(0);
  });

  it("confidence = null не превращается в уверенное задание", async () => {
    // Модель не прислала число: это «неизвестно», а не «всё хорошо».
    runPhotoCheck.mockResolvedValue({
      ...RESULT,
      items: [item({ number: 1, studentAnswer: "10", confidence: null, needsReview: true })],
    });
    const { container } = await submitPhoto();

    expect(await screen.findByRole("heading", { name: /Проверьте сами/ })).toBeInTheDocument();
    // «Нет данных» — это «неизвестно», а не «уверенно». Прочерк был бы
    // неразличим с уверенным ответом на глаз.
    expect(screen.getByText(/Уверенность чтения: нет данных/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Уверенность чтения: 100%/);
    // В общую таблицу оно не попало — строк нет.
    expect(container.querySelectorAll("tbody tr")).toHaveLength(0);
  });

  it("поля отметки пустые — значение модели не подставляется", async () => {
    runPhotoCheck.mockResolvedValue(RESULT);
    await submitPhoto();

    // Пустые поля: отметка учителя, а не предзаполненный вердикт модели.
    // Галочка — всегда пустая: чужое решение не подставляется никогда.
    const check = (await screen.findByTestId("manual-mark-2")) as HTMLInputElement;
    const points = (await screen.findByTestId("manual-points-2")) as HTMLInputElement;
    expect(check.checked).toBe(false);
    // Балл по умолчанию равен ПОЛНОМУ баллу задания, а не тому, что насчитал
    // модель: «зачтено» без числа = полный балл (ТЗ-19). Значение модели в
    // поле не подставляется никогда — учитель может не знать, сколько там
    // начислено, и не должен это видеть как своё решение.
    expect(points.value).toBe("1");

    fireEvent.click(check);
    expect((screen.getByTestId("manual-mark-2") as HTMLInputElement).checked).toBe(true);

    // Главное отличие от прежнего поведения: галочка НЕ сохранилась сама.
    // До ТЗ-19 отметки жили в состоянии экрана и умирали с вкладкой.
    expect(saveManualMarks).not.toHaveBeenCalled();
  });

  it("отметки уходят на сервер только по кнопке и возвращают пересчитанный итог", async () => {
    runPhotoCheck.mockResolvedValue(RESULT);
    // Ответ сервера после сохранения: учитель закрыл оба сомнительных задания,
    // итог посчитан по объединённым данным.
    saveManualMarks.mockResolvedValue({
      ...RESULT,
      status: "ok",
      earnedPoints: 3,
      percentage: 100,
      gradeMark: "5",
      needsReview: false,
      pendingReview: 0,
      manualMarks: [
        { taskNumber: 2, accepted: true, points: 1, updatedAt: 1 },
        { taskNumber: 3, accepted: true, points: 1, updatedAt: 1 },
      ],
      items: RESULT.items.map((i) =>
        i.number === 1 ? i : { ...i, needsReview: false, decidedBy: "teacher" as const },
      ),
      ok: true,
    });
    await submitPhoto();

    fireEvent.click((await screen.findByTestId("manual-mark-2")) as HTMLInputElement);
    // Пока кнопка не нажата, на сервер не уходит НИЧЕГО: автосейв означал бы,
    // что учитель согласился с чужой оценкой, кликнув мимоходом.
    expect(saveManualMarks).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("manual-marks-save"));

    await waitFor(() => expect(saveManualMarks).toHaveBeenCalledTimes(1));
    expect(saveManualMarks).toHaveBeenCalledWith(
      "chk-1",
      expect.arrayContaining([expect.objectContaining({ taskNumber: 2, accepted: true })]),
    );
    // Успех показан словами, а не только исчезновением кнопки.
    expect(await screen.findByTestId("manual-marks-saved")).toBeInTheDocument();
    // Итог пересчитан сервером и показан. Ищем по textContent, а не по
    // findByText: «оценка» и сама отметка — разные текстовые узлы JSX, и
    // поиск по узлу такой фразе не находит.
    await waitFor(() => expect(document.body.textContent).toContain("оценка 5"));
  });

  it("неполный разбор не показывает итоговую отметку и процент", async () => {
    runPhotoCheck.mockResolvedValue(RESULT);
    await submitPhoto();

    await screen.findByRole("heading", { name: /Проверьте сами/ });
    // По той же причине — по textContent: queryByText по регулярке на
    // многоузловую фразу даёт ложное «нет такой отметки» даже когда она есть.
    expect(document.body.textContent).not.toContain("оценка 3");
    expect(screen.queryByText("67%")).not.toBeInTheDocument();
  });

  it("все задания прочитаны уверенно — блока нет, отметка на месте", async () => {
    runPhotoCheck.mockResolvedValue({
      ...RESULT,
      status: "ok",
      items: RESULT.items.filter((i) => i.confidence !== null && i.confidence >= 0.85),
    });
    await submitPhoto();

    expect(await screen.findByText("Верно")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Проверьте сами/ })).not.toBeInTheDocument();
  });
});

describe("несколько страниц работы", () => {
  it("три страницы уходят одной проверкой в выбранном порядке", async () => {
    runPhotoCheck.mockResolvedValue(RESULT);
    const { container } = render(
      <PhotoCheckPanel assignmentId="local-ws_1" demoTasks={TASKS} />,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: {
        files: [
          new File(["1"], "page-1.jpg", { type: "image/jpeg" }),
          new File(["2"], "page-2.jpg", { type: "image/jpeg" }),
          new File(["3"], "page-3.jpg", { type: "image/jpeg" }),
        ],
      },
    });
    await waitFor(() => expect(screen.getByText(/page-3\.jpg/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("checkbox", { name: /понимаю, что загружаю фото/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Проверить$/ }));

    await waitFor(() => expect(runPhotoCheck).toHaveBeenCalledTimes(1));
    // Один запрос на всю работу, и страницы идут в том порядке, в каком их
    // выбрали: перестановка тихо переставила бы страницы тетради.
    const sent = runPhotoCheck.mock.calls[0][0].blobs as File[];
    expect(sent.map((f) => f.name)).toEqual(["page-1.jpg", "page-2.jpg", "page-3.jpg"]);
  });

  it("без выбранных страниц проверка не запускается", async () => {
    const { container } = render(
      <PhotoCheckPanel assignmentId="local-ws_1" demoTasks={TASKS} />,
    );
    expect(container.querySelector('input[type="file"]')).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /понимаю, что загружаю фото/i }));

    expect(screen.getByRole("button", { name: /^Проверить$/ })).toBeDisabled();
    expect(runPhotoCheck).not.toHaveBeenCalled();
  });
});

describe("ошибка сети ≠ ошибка распознавания", () => {
  it("сервис недоступен: фото цело, предлагаем повтор", async () => {
    runPhotoCheck.mockResolvedValue({ ok: false, error: "network", message: "Сеть недоступна. Проверьте соединение." });
    await submitPhoto();

    expect(await screen.findByText("Сервис проверки сейчас недоступен")).toBeInTheDocument();
    expect(screen.getByText(/Фото цело/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Повторить" })).toBeInTheDocument();
  });

  it("фото не прочиталось: повтор бессмыслен, предлагаем переснять", async () => {
    runPhotoCheck.mockResolvedValue({ ok: false, error: "bad_request", message: "Не удалось прочитать фото. Попробуйте переснять." });
    await submitPhoto();

    expect(await screen.findByText("Не получилось прочитать фото")).toBeInTheDocument();
    expect(screen.getByText(/повторять с тем же файлом смысла нет/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Сфотографировать заново" })).toBeInTheDocument();
  });
});

describe("проверка не состоялась", () => {
  it("статус failed не превращается в нули и отметку", async () => {
    runPhotoCheck.mockResolvedValue({
      ...RESULT,
      status: "failed",
      totalPoints: 0,
      earnedPoints: 0,
      percentage: null,
      gradeMark: null,
      items: [],
    });
    await submitPhoto();

    expect(await screen.findByText("Не удалось распознать работу")).toBeInTheDocument();
    expect(screen.getByText(/Мы их не ставим вместо вас/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
