/**
 * Переработанный флоу «Проверка домашней работы по фото».
 *
 * Здесь закрываются изменения, которые НЕ про распознавание, а про то, как
 * учитель принимает решение: полоса шагов, отметка «кто поставил» с
 * сохранённой прежней отметкой, выход вместо тупика при отказе по доступу и
 * тихая строка лимита.
 *
 * Отдельно проверяется УТВЕРЖДЁННОЕ ПОВЕДЕНИЕ, а не разметка:
 *  1. Шаги видны на всех экранах и подсвечен текущий.
 *  2. При правке прежняя отметка остаётся зачёркнутой, а в колонке «Кто
 *     поставил» — «было: ИИ»: через месяц по печати видно, чья это отметка.
 *  3. При отказе по доступу НЕТ кнопки «Проверить ещё раз» — она даёт тот же
 *     отказ. Есть вход, тарифы и уход без входа, и видно, что фото не теряется.
 *  4. Лимит — тихой строкой без цен, а не карточкой, спорящей с ошибкой.
 *  5. В журнале четыре метки, включая «ждёт вас», и расшифровка каждой.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PhotoCheckPanel } from "@/components/f06/PhotoCheckPanel";
import { PhotoCheckResultView } from "@/components/f06/PhotoCheckResult";
import { CheckJournal } from "@/components/f06/CheckJournal";
import { journalBadge, type JournalEntry } from "@/lib/photo-check/journal";
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

vi.mock("@/components/f06/InterviewQuestions", () => ({
  InterviewQuestions: () => null,
}));

vi.mock("@/lib/utils/image", () => ({
  compressImage: async (blob: Blob) => blob,
  formatBytes: () => "120 КБ",
}));

const TASKS = [
  { number: 1, taskText: "Сложение", correctAnswer: "10", maxPoints: 1 },
  { number: 2, taskText: "Уравнение", correctAnswer: "22", maxPoints: 1 },
];

const RESULT: PhotoCheckResult = {
  ok: true,
  checkId: "chk-flow",
  status: "ok",
  totalPoints: 2,
  earnedPoints: 2,
  percentage: 100,
  gradeMark: "5",
  needsReview: false,
  items: [
    {
      number: 1,
      taskText: "Сложение",
      expected: "10",
      studentAnswer: "10",
      correct: true,
      verdict: "correct",
      pointsAwarded: 1,
      maxPoints: 1,
      confidence: 0.95,
      needsReview: false,
      comment: null,
      decidedBy: "model",
      modelVerdict: "correct",
    },
    {
      number: 2,
      taskText: "Уравнение",
      expected: "22",
      studentAnswer: "80",
      correct: false,
      verdict: "correct",
      pointsAwarded: 1,
      maxPoints: 1,
      confidence: 0.9,
      needsReview: false,
      comment: null,
      // Учитель поправил модель: она считала «Неверно», он поставил «Верно».
      decidedBy: "teacher",
      modelVerdict: "incorrect",
    },
  ],
  model: "test",
  photoDeleteAt: 0,
};

async function submitPhoto(quota?: { left: number; limit: number | null }) {
  const { container } = render(
    <PhotoCheckPanel assignmentId="local-ws_1" demoTasks={TASKS} quota={quota} />,
  );
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, {
    target: { files: [new File(["x"], "page.jpg", { type: "image/jpeg" })] },
  });
  await waitFor(() => expect(screen.getByText(/page\.jpg/)).toBeInTheDocument());
  fireEvent.click(screen.getByRole("checkbox", { name: /понимаю, что загружаю фото/i }));
  fireEvent.click(screen.getByRole("button", { name: /^Проверить$/ }));
  return { container };
}

beforeAll(() => {
  if (!URL.createObjectURL) URL.createObjectURL = () => "blob:preview";
  if (!URL.revokeObjectURL) URL.revokeObjectURL = () => undefined;
});

beforeEach(() => {
  runPhotoCheck.mockReset();
  deletePhotoCheck.mockReset();
  saveManualMarks.mockReset();
  loadInterviewQuestions.mockResolvedValue({ ok: true, questions: [] });
});

describe("полоса шагов", () => {
  it("на старте подсвечен первый шаг, у остальных — номера", () => {
    render(<PhotoCheckPanel assignmentId="local-ws_1" demoTasks={TASKS} />);

    const steps = screen.getByRole("navigation", { name: /шаги проверки/i });
    expect(steps).toBeInTheDocument();
    // Текущий шаг помечен для скринридера, а не только цветом.
    const current = steps.querySelector('[aria-current="step"]');
    expect(current?.textContent).toContain("Сфотографировать");
    // Все три шага названы словами.
    expect(steps.textContent).toContain("Проверить");
    expect(steps.textContent).toContain("Разобрать");
  });

  it("после проверки пройденные шаги закрыты галочкой, текущим стал «Разобрать»", async () => {
    runPhotoCheck.mockResolvedValue(RESULT);
    await submitPhoto();

    await waitFor(() => expect(screen.getByText(/Работа проверена/)).toBeInTheDocument());
    const steps = screen.getByRole("navigation", { name: /шаги проверки/i });
    expect(steps.querySelector('[aria-current="step"]')?.textContent).toContain("Разобрать");
    // Галочки на первых двух шагах — видно, сколько шагов пройдено.
    expect(steps.textContent?.match(/✓/g)?.length).toBe(2);
  });
});

describe("отказ по доступу: выход, а не тупик", () => {
  beforeEach(() => {
    runPhotoCheck.mockResolvedValue({
      ok: false,
      error: "unauthorized",
      message: "Нужен вход в аккаунт",
    });
  });

  it("вместо «Проверить ещё раз» — вход, тарифы и уход без входа", async () => {
    await submitPhoto();

    await waitFor(() =>
      expect(screen.getByTestId("photo-check-login-required")).toBeInTheDocument(),
    );

    // Главное: кнопки, которая даёт тот же отказ, на экране нет.
    expect(screen.queryByRole("button", { name: /Проверить ещё раз/ })).toBeNull();

    expect(screen.getByRole("link", { name: /Войти/ })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: /Посмотреть тарифы/ })).toHaveAttribute(
      "href",
      "/pricing",
    );
    expect(screen.getByRole("button", { name: /Выйти без входа/ })).toBeInTheDocument();
  });

  it("учитель видит, что фото не потеряно и что будет после входа", async () => {
    await submitPhoto();

    await waitFor(() =>
      expect(screen.getByTestId("photo-check-login-required")).toBeInTheDocument(),
    );
    const block = screen.getByTestId("photo-check-login-required");
    // Что останется на месте.
    expect(block.textContent).toContain("1 — остались на месте");
    expect(block.textContent).toContain("ничего");
    // И что произойдёт после входа — три пункта, а не одно «удалите фото».
    expect(block.textContent).toContain("Что произойдёт после входа");
    expect(block.textContent).toContain("останутся выбранными");
    // Не «запустится сама»: после входа учитель жмёт «Проверить» сам —
    // панель не переживает переход через /login. Обещать то, чего нет, нельзя.
    expect(block.textContent).toContain("когда вы нажмёте «Проверить»");
    expect(block.textContent).toContain("Журнал");
  });

  it("«Выйти без входа» возвращает к фото, а не выбрасывает его", async () => {
    await submitPhoto();

    await waitFor(() =>
      expect(screen.getByTestId("photo-check-login-required")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /Выйти без входа/ }));

    await waitFor(() =>
      expect(screen.queryByTestId("photo-check-login-required")).toBeNull(),
    );
    // Снимок остался выбранным: переснимать заново учителю не нужно.
    expect(screen.getByText(/page\.jpg/)).toBeInTheDocument();
  });

  it("на экране отказа шаг «Проверить» назван словами, а не номером", async () => {
    await submitPhoto();

    await waitFor(() =>
      expect(screen.getByTestId("photo-check-login-required")).toBeInTheDocument(),
    );
    const steps = screen.getByRole("navigation", { name: /шаги проверки/i });
    // Второй шаг заблокирован и называет, что именно мешает.
    expect(steps.textContent).toContain("Войти в аккаунт");
  });
});

describe("лимит генераций — тихой строкой", () => {
  it("показывает остаток и ссылку на тарифы, но не цены", async () => {
    runPhotoCheck.mockResolvedValue({ ok: false, error: "quota", message: "Лимит исчерпан" });
    await submitPhoto({ left: 2, limit: 3 });

    await waitFor(() =>
      expect(screen.getByTestId("photo-check-login-required")).toBeInTheDocument(),
    );
    expect(screen.getByText(/Осталось 2 из 3 бесплатных генераций/)).toBeInTheDocument();
    // Цен на экране отказа нет: они спорят с текстом ошибки.
    expect(document.body.textContent).not.toMatch(/₽/);
  });

  it("без счётчика строка не рисуется — панель работает и без него", () => {
    render(<PhotoCheckPanel assignmentId="local-ws_1" demoTasks={TASKS} />);
    expect(screen.queryByText(/бесплатных генераций/)).toBeNull();
  });

  it("на безлимите говорит словами, а не числом «из ∞»", async () => {
    runPhotoCheck.mockResolvedValue({ ok: false, error: "quota", message: "Лимит" });
    await submitPhoto({ left: 0, limit: null });

    await waitFor(() => expect(screen.getByText(/Безлимит на вашем тарифе/)).toBeInTheDocument());
  });
});

describe("журнал: метки «кто поставил»", () => {
  const entry = (over: Partial<JournalEntry> = {}): JournalEntry => ({
    id: "j1",
    checkId: "c1",
    subject: "Математика",
    grade: 5,
    mark: "4",
    percentage: 75,
    earnedPoints: 9,
    totalPoints: 12,
    source: "machine",
    pendingTasks: 0,
    occurredAt: 1_757_000_000,
    ...over,
  });

  it("незакрытая работа помечена «ждёт вас», а не «проверил ИИ»", () => {
    expect(journalBadge({ source: "machine", pendingTasks: 1 })).toBe("pending");
    expect(journalBadge({ source: "teacher", pendingTasks: 2 })).toBe("pending");
    // Закрытая работа показывает источник.
    expect(journalBadge({ source: "machine", pendingTasks: 0 })).toBe("machine");
    expect(journalBadge({ source: "teacher", pendingTasks: 0 })).toBe("teacher");
    expect(journalBadge({ source: "mixed", pendingTasks: 0 })).toBe("mixed");
  });

  it("на экране есть все четыре метки и расшифровка каждой", () => {
    render(
      <CheckJournal
        entries={[
          entry({ id: "a", source: "teacher", mark: "5" }),
          entry({ id: "b", source: "machine" }),
          entry({ id: "c", source: "mixed", mark: null }),
          entry({ id: "d", pendingTasks: 1, mark: null }),
        ]}
      />,
    );

    expect(screen.getAllByText("вы правили вручную").length).toBeGreaterThan(0);
    expect(screen.getAllByText("проверил ИИ").length).toBeGreaterThan(0);
    expect(screen.getAllByText("частично вручную").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ждёт вас").length).toBeGreaterThan(0);

    // Расшифровка — словами и для всех четырёх, а не в подсказке при наведении.
    const legend = screen.getByText("Что значат метки").closest("div")!;
    expect(legend.textContent).toContain("вы не смотрели");
    expect(legend.textContent).toContain("спорное решили сами");
    expect(legend.textContent).toContain("часть поправили вы");
    expect(legend.textContent).toContain("отметки ещё нет");
  });
});

describe("колонка «Кто поставил» в результате", () => {
  it("прежняя отметка зачёркнута, новая рядом, в колонке — «было: ИИ»", () => {
    const { container } = render(
      <PhotoCheckResultView
        result={RESULT}
        onDeletePhoto={vi.fn()}
        onPrint={vi.fn()}
        checkId="chk-flow"
      />,
    );

    // Строка 2 — правка учителя: модель считала «Неверно».
    const struck = container.querySelectorAll(".line-through");
    expect(struck.length).toBeGreaterThan(0);
    expect(struck[0].textContent).toContain("Неверно");
    // Новая отметка стоит рядом со старой, а не заменяет её молча.
    expect(screen.getAllByText("Верно").length).toBeGreaterThan(0);
    expect(document.body.textContent).toContain("было:");
  });
});