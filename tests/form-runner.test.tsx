/**
 * TZ-12, этап 3 — страница ученика: `FormRunner`.
 *
 * Закрываем ровно те состояния, из-за которых страница может упасть в проде:
 *   1. токена в ссылке нет        → понятный текст, а не белый экран;
 *   2. форма грузится             → скелетон «Загружаем задания…» (первая секунда
 *                                   на мобильном интернете);
 *   3. учитель задал код класса   → сначала код, потом имя;
 *   4. имя                        → обязательное, пустое блокирует «Начать»;
 *   5. ответы                     → элемент ввода по типу задания + прогресс;
 *   6. отправка                   → «Готово! N из M · S баллов из K»;
 *   7. форму закрыли во время     → экран ошибки, а не потерянные ответы.
 *
 * Сеть не мокаем на уровне fetch: мокается сам клиент `@/lib/forms/api`
 * (его контракт — типизированный union, он проверяется отдельно).
 * `next/navigation` тоже мокается — `useSearchParams()` в jsdom есть,
 * но его значение здесь задаёт сценарий, а не роутер Next.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  loadPublicForm: vi.fn(),
  submitPublicForm: vi.fn(),
  search: "",
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mocks.search),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/forms/api", () => ({
  loadPublicForm: mocks.loadPublicForm,
  submitPublicForm: mocks.submitPublicForm,
}));

import { FormRunner } from "@/app/form/FormRunner";

/** Форма без кода класса — самый частый случай. */
function makeForm(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    form: {
      title: "Рабочий лист: дроби",
      subject: "Математика",
      grade: 5,
      tasks: [
        { number: 1, text: "Найди значение 3/4 + 1/8", type: "computation", points: 2 },
        {
          number: 2,
          text: "Выбери верный ответ",
          type: "multiple-choice",
          options: ["1/2", "1/3"],
          points: 1,
        },
        { number: 3, text: "Вставь числа: 3, __, 5, __, 7", type: "fill-blank", points: 1 },
      ],
      expiresAt: 0,
      needsCode: false,
      ...overrides,
    },
  };
}

/** Промис, который мы разрешим сами — чтобы поймать состояние loading. */
const pending = () => new Promise(() => {});

/**
 * Токен задаётся через НАСТОЯЩИЙ `window.location.search`: FormRunner больше
 * не читает `useSearchParams()` — хук требовал границу <Suspense> при статическом
 * экспорте, а её fallback закрывал страницу до гидратации. Пока тест подсовывал
 * токен через мок хука, компонент его не видел и уходил в состояние «без
 * токена»: 8 тестов падали, а полный прогон это скрывал.
 */
function setSearch(value: string): void {
  window.history.replaceState({}, "", value ? `/form?${value}` : "/form");
}

beforeEach(() => {
  setSearch("t=tok123");
  mocks.loadPublicForm.mockReset();
  mocks.submitPublicForm.mockReset();
});

describe("FormRunner — состояния страницы ученика", () => {
  it("без токена в ссылке показывает понятную ошибку, а не пустой экран", async () => {
    setSearch("");
    render(<FormRunner />);

    const box = await screen.findByTestId("form-error");
    expect(box).toHaveTextContent(/Ссылка неполная/);
    expect(mocks.loadPublicForm).not.toHaveBeenCalled();
  });

  it("на загрузке показывает скелетон «Загружаем задания…»", () => {
    mocks.loadPublicForm.mockReturnValue(pending());
    render(<FormRunner />);

    expect(screen.getByTestId("form-loading")).toHaveTextContent("Загружаем задания…");
  });

  it("форма с кодом класса: сначала код, потом имя", async () => {
    const user = userEvent.setup();
    mocks.loadPublicForm.mockResolvedValue(
      makeForm({ needsCode: true, tasks: [{ number: 1, text: "2+2", type: "computation", points: 1 }] }),
    );
    render(<FormRunner />);

    const codeInput = await screen.findByTestId("form-code");
    expect(screen.queryByTestId("form-name")).not.toBeInTheDocument();

    // Пустой код не пускает дальше — код написан учителем на доске.
    await user.click(screen.getByRole("button", { name: "Дальше" }));
    expect(await screen.findByText(/Введите код, который написал учитель/)).toBeInTheDocument();

    await user.type(codeInput, "5А");
    await user.click(screen.getByRole("button", { name: "Дальше" }));
    expect(await screen.findByTestId("form-name")).toBeInTheDocument();
  });

  it("пустое имя блокирует переход к заданиям", async () => {
    const user = userEvent.setup();
    mocks.loadPublicForm.mockResolvedValue(makeForm());
    render(<FormRunner />);

    await user.click(await screen.findByRole("button", { name: "Начать" }));
    expect(await screen.findByText(/Напишите, как вас зовут/)).toBeInTheDocument();
    expect(screen.queryByTestId("form-tasks")).not.toBeInTheDocument();

    await user.type(screen.getByTestId("form-name"), "Аня");
    await user.click(screen.getByRole("button", { name: "Начать" }));
    expect(await screen.findByTestId("form-tasks")).toBeInTheDocument();
  });

  it("по типу задания выбирает свой элемент ввода", async () => {
    const user = userEvent.setup();
    mocks.loadPublicForm.mockResolvedValue(makeForm());
    render(<FormRunner />);

    await user.type(await screen.findByTestId("form-name"), "Аня");
    await user.click(screen.getByRole("button", { name: "Начать" }));
    await screen.findByTestId("form-tasks");

    // computation → текстовое поле с числовой клавиатурой
    expect(screen.getByTestId("task-input-1")).toHaveAttribute("inputmode", "decimal");
    // multiple-choice → два radio-варианта, сверяется индекс, а не текст
    expect(screen.getByTestId("task-option-2-0")).toHaveAttribute("value", "0");
    expect(screen.getByTestId("task-option-2-1")).toHaveAttribute("value", "1");
    // fill-blank → по одному полю на каждый пропуск в тексте
    expect(screen.getByTestId("task-blank-3-0")).toBeInTheDocument();
    expect(screen.getByTestId("task-blank-3-1")).toBeInTheDocument();
  });

  it("прогресс считает отвеченные задания", async () => {
    const user = userEvent.setup();
    mocks.loadPublicForm.mockResolvedValue(makeForm());
    render(<FormRunner />);

    await user.type(await screen.findByTestId("form-name"), "Аня");
    await user.click(screen.getByRole("button", { name: "Начать" }));
    await screen.findByTestId("form-tasks");

    expect(screen.getByTestId("form-progress-text")).toHaveTextContent("Отвечено 0 из 3");

    await user.type(screen.getByTestId("task-input-1"), "0,875");
    expect(screen.getByTestId("form-progress-text")).toHaveTextContent("Отвечено 1 из 3");

    await user.click(screen.getByTestId("task-option-2-1"));
    expect(screen.getByTestId("form-progress-text")).toHaveTextContent("Отвечено 2 из 3");
  });

  it("после отправки показывает результат с баллами", async () => {
    const user = userEvent.setup();
    mocks.loadPublicForm.mockResolvedValue(makeForm());
    mocks.submitPublicForm.mockResolvedValue({
      ok: true,
      scoreTotal: 3,
      scoreMax: 4,
      perTask: [
        { taskNumber: 1, status: "correct" },
        { taskNumber: 2, status: "wrong" },
        { taskNumber: 3, status: "unreviewed" },
      ],
    });
    render(<FormRunner />);

    await user.type(await screen.findByTestId("form-name"), "Аня");
    await user.click(screen.getByRole("button", { name: "Начать" }));
    await screen.findByTestId("form-tasks");

    // Пустое имя тут уже не пустило бы — нажимаем «Отправить» с неполными ответами.
    await user.click(screen.getByTestId("form-submit"));

    const done = await screen.findByTestId("form-submitted");
    expect(done).toHaveTextContent("Готово!");
    expect(screen.getByTestId("form-result-summary")).toHaveTextContent(
      "Аня: 1 из 3 заданий · 3 баллов из 4",
    );

    // На сервер ушли только непустые ответы — пропущенные отправлять незачем.
    const [, body] = mocks.submitPublicForm.mock.calls[0];
    expect(mocks.submitPublicForm.mock.calls[0][0]).toBe("tok123");
    expect(body.answers).toEqual([]);
  });

  it("закрытая во время работы форма не даёт потерять ответы молча", async () => {
    const user = userEvent.setup();
    mocks.loadPublicForm.mockResolvedValue(makeForm());
    mocks.submitPublicForm.mockResolvedValue({ ok: false, error: "closed" });
    render(<FormRunner />);

    await user.type(await screen.findByTestId("form-name"), "Аня");
    await user.click(screen.getByRole("button", { name: "Начать" }));
    await screen.findByTestId("form-tasks");
    await user.type(screen.getByTestId("task-input-1"), "0,875");

    await user.click(screen.getByTestId("form-submit"));

    await waitFor(() =>
      expect(screen.getByTestId("form-error")).toHaveTextContent("Форма закрыта учителем"),
    );
  });

  it("ошибка сети при отправке оставляет ученика на заполненном листе", async () => {
    const user = userEvent.setup();
    mocks.loadPublicForm.mockResolvedValue(makeForm());
    mocks.submitPublicForm.mockResolvedValue({ ok: false, error: "network" });
    render(<FormRunner />);

    await user.type(await screen.findByTestId("form-name"), "Аня");
    await user.click(screen.getByRole("button", { name: "Начать" }));
    await screen.findByTestId("form-tasks");
    await user.type(screen.getByTestId("task-input-1"), "0,875");

    await user.click(screen.getByTestId("form-submit"));

    // Не выкидываем в экран ошибки: ответы на месте, кнопка «Отправить» снова доступна.
    await screen.findByTestId("form-progress");
    expect(screen.queryByTestId("form-error")).not.toBeInTheDocument();
    expect(screen.getByTestId("task-input-1")).toHaveValue("0,875");
    expect(screen.getByTestId("form-submit")).toBeEnabled();
  });
});
