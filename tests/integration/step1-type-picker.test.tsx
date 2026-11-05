/**
 * AD-1 (constructor honesty UX): тип материала — на шаге «Параметры»,
 * после выбора темы. На первом шаге пикера нет.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ЗАЩИЩАЕМ
 *
 *  1. На шаге «Предмет» нет блока «Что делаем» / ArtifactTypePicker.
 *  2. После предмет → класс → тема пикер появляется на configure.
 *  3. Ежедневные форматы и группа «К уроку» достижимы на configure.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import {
  goToTopicStep,
  mockApi,
  openConstructor,
  setDevice,
} from "./helpers/constructor-flow";

beforeEach(() => {
  mockApi();
  setDevice({ coarse: false, touchPoints: 0, width: 1440 });
});

afterEach(() => {
  window.history.replaceState({}, "", "/constructor/");
});

describe("конструктор · тип материала после темы", () => {
  it("на шаге предмета нет пикера типа", async () => {
    await openConstructor();
    expect(screen.getByText("Что и для кого")).toBeTruthy();
    expect(screen.queryByText("Что делаем")).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Тип материала" })).toBeNull();
    expect(screen.queryByTestId("pick-type-interactive-step1")).toBeNull();
  });

  it("после темы на configure доступны ежедневные форматы и интерактив", async () => {
    const user = await openConstructor();
    await goToTopicStep(user, "math", 5);

    const list = screen.getByTestId("topics-list");
    const firstTopic = list.querySelectorAll("button")[0];
    expect(firstTopic).toBeTruthy();
    await user.click(firstTopic!);

    await screen.findByRole("radiogroup", { name: "Тип материала" });
    for (const label of ["Лист", "Тест", "Карточки", "Контрольная"]) {
      expect(screen.getAllByRole("radio", { name: new RegExp(label) }).length).toBeGreaterThan(0);
    }
  });

  it("форматы «К уроку» достижимы на configure: план урока, презентация, КТП", async () => {
    const user = await openConstructor();
    await goToTopicStep(user, "math", 5);
    const list = screen.getByTestId("topics-list");
    await user.click(list.querySelectorAll("button")[0]!);

    const group = await screen.findByTestId("artifact-group-lesson");
    const opener = group.querySelector("button[aria-expanded]") as HTMLButtonElement;
    expect(opener.getAttribute("aria-expanded")).toBe("true");

    await user.click(opener);
    await waitFor(() => {
      expect(group.querySelector("button[aria-expanded]")?.getAttribute("aria-expanded")).toBe(
        "false"
      );
    });
    await user.click(opener);
    await waitFor(() => {
      expect(group.querySelector("button[aria-expanded]")?.getAttribute("aria-expanded")).toBe("true");
    });

    for (const label of ["План урока", "Презентация", "КТП"]) {
      expect(screen.getAllByRole("radio", { name: new RegExp(label) }).length).toBeGreaterThan(0);
    }
  });
});
