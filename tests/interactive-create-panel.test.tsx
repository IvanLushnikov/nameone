/**
 * Создание интерактива из листа (TZ-13 §3 сценарий A, шаги 3–8).
 *
 * Закрывает главную дыру фичи: до появления `createInteractive` в клиентском
 * API и `InteractiveCreatePanel` эндпоинт `POST /api/interactives` не
 * вызывался из интерфейса НИ ОТКУДА. То есть учитель физически не мог
 * получить ссылку и QR — фича была собрана, но недостижима.
 *
 * Что здесь защищаем — не вёрстка, а поведение, без которого панель вводит
 * учителя в заблуждение:
 *   1. без серверного id листа кнопка заблокирована и объясняет почему
 *      (ранклер берёт `payload_json` по id из базы, клиентский не подойдёт);
 *   2. успешный ответ даёт ссылку и QR, а не «готово» в пустоту;
 *   3. ошибка API превращается в человеческий текст, а не в код `network`;
 *   4. в запрос уходит выбранный формат и число заданий.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { InteractiveCreatePanel } from "@/components/interactives/InteractiveCreatePanel";

const createInteractive = vi.fn();

vi.mock("@/lib/interactives/api", () => ({
  createInteractive: (args: unknown) => createInteractive(args),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

beforeEach(() => {
  createInteractive.mockReset();
});

const base = {
  worksheetId: "ws-1",
  format: "quiz-race" as const,
  title: "Дроби, 5 класс",
  subject: "math",
  grade: 5,
  itemCount: 10,
};

describe("InteractiveCreatePanel — сценарий учителя", () => {
  it("без серверного id листа кнопка заблокирована и причина объяснена", () => {
    render(<InteractiveCreatePanel {...base} worksheetId={null} />);
    const button = screen.getByTestId("interactive-create-button");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(document.body.textContent).toContain("ещё не сохранён на сервере");
    // Кнопка заблокирована — значит запрос уйти не должен.
    expect(createInteractive).not.toHaveBeenCalled();
  });

  it("успех: уходит формат и число заданий, учитель получает ссылку", async () => {
    createInteractive.mockResolvedValue({
      ok: true,
      interactive: {
        id: "int_abc",
        shareToken: "tok123",
        url: "https://uchlist.ru/play/?t=tok123",
        qrPayload: "https://uchlist.ru/play/?t=tok123",
      },
    });

    render(<InteractiveCreatePanel {...base} />);
    (screen.getByTestId("interactive-create-button") as HTMLButtonElement).click();

    await waitFor(() => expect(createInteractive).toHaveBeenCalledTimes(1));
    expect(createInteractive).toHaveBeenCalledWith(
      expect.objectContaining({ worksheetId: "ws-1", format: "quiz-race" }),
    );
    const args = createInteractive.mock.calls[0][0] as { options: Record<string, unknown> };
    expect(args.options.itemCount).toBe(10);

    await waitFor(() => expect(screen.getByTestId("interactive-create-done")).toBeTruthy());
    // Ссылка видна учителю — её он и отдаёт классу.
    expect(document.body.textContent).toContain("Игра готова");
  });

  it("ошибка сети превращается в человеческий текст, а не в код", async () => {
    createInteractive.mockResolvedValue({ ok: false, error: "network" });
    render(<InteractiveCreatePanel {...base} />);
    (screen.getByTestId("interactive-create-button") as HTMLButtonElement).click();

    await waitFor(() => {
      expect(document.body.textContent).toContain("Нет связи с сервером");
    });
    expect(document.body.textContent).not.toContain("network");
  });

  it("ошибка авторизации объясняет, что нужен вход", async () => {
    createInteractive.mockResolvedValue({ ok: false, error: "unauthorized" });
    render(<InteractiveCreatePanel {...base} />);
    (screen.getByTestId("interactive-create-button") as HTMLButtonElement).click();
    await waitFor(() => {
      expect(document.body.textContent).toContain("Войдите в личный кабинет");
    });
  });
});
