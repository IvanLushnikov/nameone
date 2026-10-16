/**
 * Блок «Темы, где просели» и карточка темы (ТЗ-27, интерфейсная часть).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ЗДЕСЬ ЛОВИТСЯ
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. Пустой срез НЕ рисует блок. Листы, созданные до меток, должны вести себя
 *      как раньше — без заголовка «тем, где просели: 0», который выглядел бы
 *      как поломка.
 *   2. Худшая тема сверху, и клик открывает карточку именно этой темы.
 *   3. Карточка показывает три последние проверки, приглашение поговорить и
 *      разбор по заданиям — и КНОПКУ «сделать проверочную по теме», у которой
 *      проверяется, что в конструктор уехали тема и класс.
 *   4. Список ошибающихся — приглашение, а не вывод: ни процентов, ни баллов,
 *      только фамилия и две даты.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ЗАМОКНО И ПОЧЕМУ
 * ─────────────────────────────────────────────────────────────────────────────
 * Замокнут `@/lib/lk/skills-api` — потому что числа приезжают с сервера уже
 * посчитанными (AD-3 ТЗ-27), и проверять тут надо ИНТЕРФЕЙС: порядок строк
 * пришёл таким, каким пришёл, и ни одна цифра не пересчитывается в браузере.
 * Если бы компонент сам делил проценты, расхождение с сервером было бы
 * невозможно заметить — а именно его ТЗ-27 и запрещает.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { loadClassSkills, loadSkillDetail } = vi.hoisted(() => ({
  loadClassSkills: vi.fn(),
  loadSkillDetail: vi.fn(),
}));

vi.mock("@/lib/lk/skills-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/lk/skills-api")>(
    "@/lib/lk/skills-api",
  );
  return { ...actual, loadClassSkills, loadSkillDetail };
});

import { SkillBreakdown } from "@/components/lk/SkillBreakdown";
import type { ClassSkillRow, SkillDetailData } from "@/lib/journal/types";

const DAY_ONE = Date.UTC(2026, 9, 14) / 1000;
const DAY_TWO = Date.UTC(2026, 9, 15) / 1000;

function row(over: Partial<ClassSkillRow> = {}): ClassSkillRow {
  return {
    skill: "Давление твёрдых тел",
    correct: 20,
    total: 28,
    attempts: 28,
    percent: 71,
    lastCheckedAt: DAY_TWO,
    ...over,
  };
}

function detail(over: Partial<SkillDetailData> = {}): SkillDetailData {
  return {
    skill: "Давление твёрдых тел",
    recent: [
      { formId: "frm_2", title: "Проверочная №4", checkedAt: DAY_TWO, percent: 71 },
      { formId: "frm_1", title: "Контрольная №3", checkedAt: DAY_ONE, percent: 50 },
    ],
    struggling: [
      { studentId: "cst_1", studentName: "Иванов Иван", dates: ["2026-10-14", "2026-10-15"] },
    ],
    tasks: [
      { formId: "frm_2", taskNumber: 1, prompt: "Сила давления", correct: 6, total: 28 },
    ],
    trend: { previous: 50, latest: 71, percent: 21 },
    ...over,
  };
}

function renderBlock() {
  return render(
    <SkillBreakdown classId="cls_1" className="7Б" subject="Физика" grade={7} />,
  );
}

describe("ТЗ-27 · блок «Темы, где просели»", () => {
  beforeEach(() => {
    loadClassSkills.mockReset();
    loadSkillDetail.mockReset();
  });
  afterEach(() => vi.clearAllMocks());

  it("лист без меток: блок не рисуется вовсе, а не показывает «0 тем»", async () => {
    loadClassSkills.mockResolvedValue({ ok: true, value: [] });
    renderBlock();
    await waitFor(() => expect(loadClassSkills).toHaveBeenCalled());
    expect(screen.queryByTestId("skill-breakdown")).toBeNull();
    expect(screen.queryByText("Темы, где просели")).toBeNull();
  });

  it("строки приходят в том порядке, в каком их отдал сервер", async () => {
    // Порядок — худшая сверху — это решение сервера (AD-3). Здесь мы его НЕ
    // переставляем: проверка падает, если компонент начнёт сортировать сам.
    loadClassSkills.mockResolvedValue({
      ok: true,
      value: [
        row({ skill: "Площадь прямоугольника", correct: 10, total: 28, percent: 36 }),
        row(),
      ],
    });
    renderBlock();

    await waitFor(() => expect(screen.getByTestId("skill-breakdown")).toBeTruthy());
    const rows = screen.getAllByTestId("skill-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain("Площадь прямоугольника");
    expect(rows[1]!.textContent).toContain("Давление твёрдых тел");
    // Числа подписаны словами: «18 ошибок» — прочитывается глазом, «18» нет.
    expect(rows[0]!.textContent).toContain("18 ошибок");
    expect(rows[1]!.textContent).toContain("8 ошибок");
  });

  it("клик по теме открывает карточку этой темы", async () => {
    loadClassSkills.mockResolvedValue({
      ok: true,
      value: [row({ skill: "Площадь прямоугольника", percent: 36 }), row()],
    });
    loadSkillDetail.mockResolvedValue({ ok: true, value: detail({ skill: "Площадь прямоугольника" }) });

    renderBlock();
    await waitFor(() => expect(screen.getAllByTestId("skill-row")).toHaveLength(2));
    await userEvent.click(screen.getAllByTestId("skill-row")[0]!);

    await waitFor(() => expect(screen.getByTestId("skill-detail-title")).toBeTruthy());
    expect(loadSkillDetail).toHaveBeenCalledWith("cls_1", "Площадь прямоугольника");
  });

  it("ошибка загрузки объясняется словами, а не кодом", async () => {
    loadClassSkills.mockResolvedValue({ ok: false, error: "network" });
    renderBlock();
    await waitFor(() => expect(screen.getByTestId("skill-breakdown-unavailable")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toMatch(/нет связи с сервером/i);
  });
});

describe("ТЗ-27 · карточка темы", () => {
  beforeEach(() => {
    loadClassSkills.mockResolvedValue({ ok: true, value: [row()] });
    loadSkillDetail.mockReset();
    loadSkillDetail.mockResolvedValue({ ok: true, value: detail() });
  });
  afterEach(() => vi.clearAllMocks());

  it("три блока на месте, стрелка показывает рост процента", async () => {
    renderBlock();
    await waitFor(() => expect(screen.getAllByTestId("skill-row")).toHaveLength(1));
    await userEvent.click(screen.getByTestId("skill-row"));

    await waitFor(() => expect(screen.getByTestId("skill-recent")).toBeTruthy());
    expect(screen.getByTestId("skill-struggling")).toBeTruthy();
    expect(screen.getByTestId("skill-tasks")).toBeTruthy();
    expect(screen.getByTestId("skill-trend").textContent).toMatch(/вырос/);
    expect(screen.getByTestId("skill-trend").textContent).toContain("50% → 71%");
  });

  it("список ошибающихся — приглашение без процентов и баллов", async () => {
    renderBlock();
    await waitFor(() => expect(screen.getAllByTestId("skill-row")).toHaveLength(1));
    await userEvent.click(screen.getByTestId("skill-row"));
    await waitFor(() => expect(screen.getByTestId("skill-struggling")).toBeTruthy());

    const block = screen.getByTestId("skill-struggling");
    expect(block.textContent).toMatch(/приглашение посмотреть вместе/i);
    expect(within(block).getByText("Иванов Иван")).toBeTruthy();
    // Даты по-русски и без года: «14 окт. и 15 окт.» — то, что учитель назовёт
    // вслух, называя дни разговора.
    expect(block.textContent).toContain("14 окт. и 15 окт.");
    expect(block.textContent).not.toMatch(/\d+\s*%/);
  });

  it("кнопка «проверочная по теме» уводит в конструктор с темой и классом", async () => {
    renderBlock();
    await waitFor(() => expect(screen.getAllByTestId("skill-row")).toHaveLength(1));
    await userEvent.click(screen.getByTestId("skill-row"));
    // Кнопка — это ссылка на конструктор: ищем по словам, а не по testid,
    // потому что `Button as="link"` не пробрасывает служебные атрибуты дальше.
    await waitFor(() =>
      expect(screen.getByText("Сделать проверочную по теме")).toBeTruthy(),
    );
    const href = screen.getByText("Сделать проверочную по теме").closest("a")!.getAttribute("href")!;
    expect(href).toContain("/constructor?");
    const params = new URL(href, "https://uclist.test").searchParams;
    expect(params.get("topic")).toBe("Давление твёрдых тел");
    expect(params.get("subject")).toBe("Физика");
    expect(params.get("grade")).toBe("7");
  });

  it("кнопка «назад» закрывает карточку", async () => {
    renderBlock();
    await waitFor(() => expect(screen.getAllByTestId("skill-row")).toHaveLength(1));
    await userEvent.click(screen.getByTestId("skill-row"));
    await waitFor(() => expect(screen.getByTestId("skill-detail-title")).toBeTruthy());

    await userEvent.click(screen.getByText("Вернуться к ведомости"));
    await waitFor(() => expect(screen.queryByTestId("skill-detail-title")).toBeNull());
  });

  it("одна проверка — стрелки нет: сравнивать не с чем", async () => {
    loadSkillDetail.mockResolvedValue({
      ok: true,
      value: detail({
        recent: [{ formId: "frm_1", title: "Контрольная №3", checkedAt: DAY_ONE, percent: 71 }],
        trend: null,
      }),
    });
    renderBlock();
    await waitFor(() => expect(screen.getAllByTestId("skill-row")).toHaveLength(1));
    await userEvent.click(screen.getByTestId("skill-row"));

    await waitFor(() => expect(screen.getByTestId("skill-recent")).toBeTruthy());
    expect(screen.queryByTestId("skill-trend")).toBeNull();
    // И проверить всё равно есть что: одна проверка названа своей датой.
    expect(screen.getByTestId("skill-recent").textContent).toContain("Контрольная №3");
  });

  it("пустые состояния называют ПРИЧИНУ, а не «ничего не нашлось»", async () => {
    loadSkillDetail.mockResolvedValue({
      ok: true,
      value: detail({ recent: [], struggling: [], tasks: [] }),
    });
    renderBlock();
    await waitFor(() => expect(screen.getAllByTestId("skill-row")).toHaveLength(1));
    await userEvent.click(screen.getByTestId("skill-row"));

    await waitFor(() => expect(screen.getByTestId("skill-recent-empty")).toBeTruthy());
    expect(screen.getByTestId("skill-recent-empty").textContent).toMatch(/ещё нет проверок/i);
    expect(screen.getByTestId("skill-struggling").textContent).toMatch(/нет ученика с двумя/i);
    expect(screen.getByTestId("skill-tasks").textContent).toMatch(/могло не быть в листе/i);
  });
});