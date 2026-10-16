/**
 * ТЗ-28, фронт: страница ученика по коду класса и черновик ответов.
 *
 * Закрываем состояния, из-за которых реальный ученик с телефоном не сдаст работу:
 *   1. код в адресе не подошёл   → понятный текст, а не белый экран;
 *   2. кода в адресе нет         → тоже текст, а не вечная загрузка;
 *   3. сервер спросил «кто сдаёт» → одно поле, пустое имя не пускает дальше;
 *   4. чужая фамилия             → серверный текст показываем как есть;
 *   5. задания загрузились       → список работ и переход к ответу по `c=код`;
 *   6. черновик                  → ответы восстанавливаются, сервер о нём не знает.
 *
 * Сеть не мокаем на уровне fetch: мокается клиент `@/components/student/api`
 * (он же вскрывает, что страница вообще зовёт нужные эндпоинты).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  loadClass: vi.fn(),
  loginByName: vi.fn(),
  loadCodeForm: vi.fn(),
  submitCodeForm: vi.fn(),
  uploadTaskPhoto: vi.fn(),
  loadPublicForm: vi.fn(),
  submitPublicForm: vi.fn(),
  search: "",
}));

vi.mock("@/components/student/api", () => ({
  loadClass: mocks.loadClass,
  loginByName: mocks.loginByName,
  loadCodeForm: mocks.loadCodeForm,
  submitCodeForm: mocks.submitCodeForm,
  uploadTaskPhoto: mocks.uploadTaskPhoto,
}));

vi.mock("@/lib/forms/api", () => ({
  loadPublicForm: mocks.loadPublicForm,
  submitPublicForm: mocks.submitPublicForm,
}));

import { StudentClassPage } from "@/components/student/StudentClassPage";
import { FormRunner } from "@/app/form/FormRunner";
import { DRAFT_PREFIX, clearDraft, draftHasContent, loadDraft, saveDraft } from "@/components/student/draft";

const CODE = "K7P2QM";

function setSearch(search: string) {
  mocks.search = search;
  window.history.replaceState({}, "", `/${search}`);
}

beforeEach(() => {
  window.localStorage.clear();
  mocks.loadClass.mockReset();
  mocks.loginByName.mockReset();
  mocks.loadCodeForm.mockReset();
  mocks.submitCodeForm.mockReset();
  mocks.uploadTaskPhoto.mockReset();
  setSearch("");
});

/** Ответ сервера на «кто сдаёт» — код не запомнил ученика. */
const NEED_NAME = { ok: true as const, needName: true as const };

const WITH_TASKS = {
  ok: true as const,
  needName: false as const,
  className: "5А",
  studentName: "Петрова Аня",
  tasks: [
    {
      token: "form-token-1",
      title: "Дроби",
      subject: "Математика",
      grade: 5,
      open: true,
      answered: false,
      answeredAt: null,
      scoreTotal: null,
      scoreMax: null,
    },
  ],
};

describe("ТЗ-28: страница класса по коду", () => {
  it("1: код не подошёл — понятный текст и кнопка перезагрузки", async () => {
    setSearch("?c=ZZZZZZ");
    mocks.loadClass.mockResolvedValue({ ok: false, error: "not_found" });
    render(<StudentClassPage />);

    await waitFor(() => expect(screen.getByTestId("class-error")).toBeInTheDocument());
    expect(screen.getByText(/Код не подошёл/)).toBeInTheDocument();
    expect(mocks.loadClass).toHaveBeenCalledWith("ZZZZZZ");
  });

  it("2: кода в адресе нет — страница объясняет, а не крутит загрузку", async () => {
    render(<StudentClassPage />);
    await waitFor(() => expect(screen.getByTestId("class-error")).toBeInTheDocument());
    expect(screen.getByText(/в ней должен быть код с доски/)).toBeInTheDocument();
    expect(mocks.loadClass).not.toHaveBeenCalled();
  });

  it("3: без cookie сервер спрашивает имя, пустое имя не пускает дальше", async () => {
    setSearch(`?c=${CODE}`);
    mocks.loadClass.mockResolvedValue(NEED_NAME);
    const user = userEvent.setup();
    render(<StudentClassPage />);

    await waitFor(() => expect(screen.getByTestId("class-need-name")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Дальше" }));
    expect(screen.getByText(/например, Иванов Иван/)).toBeInTheDocument();
    expect(mocks.loginByName).not.toHaveBeenCalled();

    await user.type(screen.getByTestId("class-name"), "Петрова Аня");
    mocks.loginByName.mockResolvedValue({ ok: true, studentName: "Петрова Аня", className: "5А" });
    mocks.loadClass.mockResolvedValue(WITH_TASKS);
    await user.click(screen.getByRole("button", { name: "Дальше" }));

    await waitFor(() => expect(screen.getByTestId("class-tasks")).toBeInTheDocument());
    expect(mocks.loginByName).toHaveBeenCalledWith(CODE, "Петрова Аня");
  });

  it("4: чужая фамилия — показываем текст сервера как есть", async () => {
    setSearch(`?c=${CODE}`);
    mocks.loadClass.mockResolvedValue(NEED_NAME);
    mocks.loginByName.mockResolvedValue({ ok: false, error: "ambiguous" });
    const user = userEvent.setup();
    render(<StudentClassPage />);

    await waitFor(() => expect(screen.getByTestId("class-need-name")).toBeInTheDocument());
    await user.type(screen.getByTestId("class-name"), "Петров");
    await user.click(screen.getByRole("button", { name: "Дальше" }));

    await waitFor(() =>
      expect(screen.getByText(/несколько учеников с такой фамилией/)).toBeInTheDocument(),
    );
  });

  it("5: задание открывается по коду класса, а не по токену ученика", async () => {
    setSearch(`?c=${CODE}`);
    mocks.loadClass.mockResolvedValue(WITH_TASKS);
    render(<StudentClassPage />);

    await waitFor(() => expect(screen.getByTestId("class-tasks")).toBeInTheDocument());
    const link = screen.getByRole("link");
    // href проверяем по строке целиком: Next может отдать абсолютный URL.
    const href = link.getAttribute("href") ?? "";
    expect(href).toContain(`c=${CODE}`);
    expect(href).toContain("t=form-token-1");
    // Токена ученика в адресе быть не должно: он лежит в httpOnly-cookie.
    expect(href).not.toContain("st=");
  });
});

describe("ТЗ-28: черновик ответа", () => {
  it("6: ответы сохраняются в localStorage и восстанавливаются при следующем открытии", async () => {
    const user = userEvent.setup();
    mocks.loadCodeForm.mockResolvedValue({
      ok: true,
      form: {
        title: "Дроби",
        subject: "Математика",
        grade: 5,
        tasks: [{ number: 1, text: "2+2", type: "computation", points: 2 }],
      },
    });
    mocks.submitCodeForm.mockResolvedValue({
      ok: true,
      scoreTotal: 2,
      scoreMax: 2,
      photosSaved: 0,
      perTask: [{ taskNumber: 1, status: "correct" }],
    });

    setSearch(`?t=form-token-1&c=${CODE}`);
    const { unmount } = render(<FormRunner />);

    await waitFor(() => expect(screen.getByTestId("form-tasks")).toBeInTheDocument());
    await user.type(screen.getByRole("textbox"), "4");
    expect(
      JSON.parse(window.localStorage.getItem(`${DRAFT_PREFIX}:${CODE}`) ?? "{}"),
      "сервер о черновике не знает — он лежит только в телефоне",
    ).toMatchObject({ answers: { "1": "4" } });

    // Перезаходим на ту же страницу — ответы должны вернуться.
    unmount();
    render(<FormRunner />);
    await waitFor(() => expect(screen.getByTestId("form-draft-restored")).toBeInTheDocument());
    expect(screen.getByRole("textbox")).toHaveValue("4");
  });

  it("6: отправка по коду идёт без имени, а черновик после неё стирается", async () => {
    const user = userEvent.setup();
    saveDraft({ code: CODE, studentName: "Петрова Аня", answers: { "1": "4" }, photos: {}, updatedAt: 1 });
    mocks.loadCodeForm.mockResolvedValue({
      ok: true,
      form: {
        title: "Дроби",
        subject: "Математика",
        grade: 5,
        tasks: [{ number: 1, text: "2+2", type: "computation", points: 2 }],
      },
    });
    mocks.submitCodeForm.mockResolvedValue({
      ok: true,
      scoreTotal: 2,
      scoreMax: 2,
      photosSaved: 0,
      perTask: [{ taskNumber: 1, status: "correct" }],
    });

    setSearch(`?t=form-token-1&c=${CODE}`);
    render(<FormRunner />);

    await waitFor(() => expect(screen.getByTestId("form-tasks")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Отправить/ }));

    await waitFor(() => expect(screen.getByTestId("form-submitted")).toBeInTheDocument());
    const call = mocks.submitCodeForm.mock.calls[0] as unknown as [string, string, unknown];
    expect(call[1], "токен формы едет в запрос").toBe("form-token-1");
    expect(
      JSON.stringify(mocks.submitCodeForm.mock.calls[0]),
      "имя ученика сервер подставляет сам, клиент его не шлёт",
    ).not.toContain("Петрова");
    expect(draftHasContent(loadDraft(CODE)), "после сдачи черновик удалён").toBe(false);
  });

  it("6: пустой и битый черновик не ломают страницу", () => {
    expect(loadDraft(CODE)).toBeNull();
    window.localStorage.setItem(`${DRAFT_PREFIX}:${CODE}`, "{ это не json");
    expect(loadDraft(CODE)).toBeNull();
    expect(draftHasContent(null)).toBe(false);

    saveDraft({ code: CODE, studentName: "", answers: {}, photos: {}, updatedAt: 0 });
    expect(draftHasContent(loadDraft(CODE))).toBe(false);
    clearDraft(CODE);
    expect(loadDraft(CODE)).toBeNull();
  });
});