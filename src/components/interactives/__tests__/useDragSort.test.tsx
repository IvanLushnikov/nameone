/**
 * `useDragSort` — общий drag-and-drop движка (TZ-13 §4.3, пункт 4).
 *
 * Закрываем ровно то, из-за чего игра ломается у реального ученика:
 *   1. мышь/палец — pointer events с `elementFromPoint` (jsdom его не имеет,
 *      поэтому ставим стаб: без него тест не проверяет ничего, а с ним —
 *      проверяет ровно нашу логику «нашли зону → отпустили → отчёт»);
 *   2. клавиатура — взять/положить и Escape;
 *   3. blocked-состояние — когда игра окончена, перетаскивание выключено.
 *
 * Тот же хук обслуживает и «Группировку по корзинам», и «Сортировку»
 * (DoD фазы 2: «работает мышью, пальцем и с клавиатуры»).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import * as React from "react";
import { useDragSort } from "../useDragSort";

/** jsdom не реализует elementFromPoint — без стаба тест проверяет пустоту. */
function stubElementFromPoint(getTarget: (x: number, y: number) => Element | null) {
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    writable: true,
    value: vi.fn((x: number, y: number) => getTarget(x, y)),
  });
}

function Harness({ onDrop, disabled }: { onDrop: (a: string, b: string) => void; disabled?: boolean }) {
  const drag = useDragSort({ onDrop, disabled });
  return (
    <div>
      <span data-testid="active">{drag.activeId ?? "—"}</span>
      <span data-testid="grabbed">{drag.grabbedId ?? "—"}</span>
      <span data-testid="over">{drag.overId ?? "—"}</span>
      <button
        type="button"
        data-testid="handle-a"
        {...drag.handleProps("a")}
      >
        ручка a
      </button>
      <button type="button" data-testid="zone-b" {...drag.zoneProps("b")}>
        зона b
      </button>
      <button type="button" data-testid="grab-a" onClick={() => drag.grab("a")}>
        взять a
      </button>
      <button type="button" data-testid="release" onClick={() => drag.release()}>
        положить
      </button>
      <button type="button" data-testid="cancel" onClick={() => drag.cancel()}>
        отмена
      </button>
    </div>
  );
}

function firePointerDown(node: Element) {
  const event = new MouseEvent("pointerdown", {
    bubbles: true,
    cancelable: true,
    clientX: 1,
    clientY: 1,
  });
  // jsdom создаёт MouseEvent, а не PointerEvent; добавляем недостающее поле.
  Object.defineProperty(event, "pointerType", { value: "touch" });
  act(() => {
    node.dispatchEvent(event);
  });
}

function fireDocumentPointer(type: string, x = 10, y = 10) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  act(() => {
    document.dispatchEvent(event);
  });
}

beforeEach(() => {
  stubElementFromPoint(() => null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useDragSort — указатель (мышь и палец)", () => {
  it("ручка включает перетаскивание и подсвечивает зону под курсором", () => {
    const onDrop = vi.fn();
    render(<Harness onDrop={onDrop} />);
    const zone = screen.getByTestId("zone-b");
    stubElementFromPoint(() => zone);

    firePointerDown(screen.getByTestId("handle-a"));
    expect(screen.getByTestId("active").textContent).toBe("a");

    fireDocumentPointer("pointermove", 5, 5);
    expect(screen.getByTestId("over").textContent).toBe("b");
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("отпускание над зоной вызывает onDrop с id предмета и зоны", () => {
    const onDrop = vi.fn();
    render(<Harness onDrop={onDrop} />);
    stubElementFromPoint(() => screen.getByTestId("zone-b"));

    firePointerDown(screen.getByTestId("handle-a"));
    fireDocumentPointer("pointermove", 5, 5);
    fireDocumentPointer("pointerup", 5, 5);

    expect(onDrop).toHaveBeenCalledWith("a", "b");
    expect(screen.getByTestId("active").textContent).toBe("—");
    expect(screen.getByTestId("over").textContent).toBe("—");
  });

  it("отпускание мимо зоны не вызывает onDrop", () => {
    const onDrop = vi.fn();
    render(<Harness onDrop={onDrop} />);
    stubElementFromPoint(() => null);

    firePointerDown(screen.getByTestId("handle-a"));
    fireDocumentPointer("pointermove", 5, 5);
    fireDocumentPointer("pointerup", 5, 5);

    expect(onDrop).not.toHaveBeenCalled();
  });

  it("бросок в ту же зону, откуда взяли, игнорируется", () => {
    const onDrop = vi.fn();
    render(<Harness onDrop={onDrop} />);
    stubElementFromPoint(() => screen.getByTestId("handle-a"));

    firePointerDown(screen.getByTestId("handle-a"));
    fireDocumentPointer("pointerup", 5, 5);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("отмена указателя (pointercancel) сбрасывает состояние", () => {
    const onDrop = vi.fn();
    render(<Harness onDrop={onDrop} />);
    stubElementFromPoint(() => screen.getByTestId("zone-b"));

    firePointerDown(screen.getByTestId("handle-a"));
    fireDocumentPointer("pointercancel");
    expect(screen.getByTestId("active").textContent).toBe("—");

    fireDocumentPointer("pointerup");
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("выключенный хук (игра окончена) не начинает перетаскивание", () => {
    const onDrop = vi.fn();
    render(<Harness onDrop={onDrop} disabled />);
    stubElementFromPoint(() => screen.getByTestId("zone-b"));

    firePointerDown(screen.getByTestId("handle-a"));
    fireDocumentPointer("pointermove");
    fireDocumentPointer("pointerup");
    expect(onDrop).not.toHaveBeenCalled();
  });
});

describe("useDragSort — клавиатура", () => {
  function click(testId: string) {
    act(() => {
      screen.getByTestId(testId).click();
    });
  }

  it("взять и положить: grabbed появляется и исчезает", () => {
    render(<Harness onDrop={vi.fn()} />);
    expect(screen.getByTestId("grabbed").textContent).toBe("—");

    click("grab-a");
    expect(screen.getByTestId("grabbed").textContent).toBe("a");

    click("release");
    expect(screen.getByTestId("grabbed").textContent).toBe("—");
  });

  it("повторное нажатие снимает предмет с клавиатуры", () => {
    render(<Harness onDrop={vi.fn()} />);
    click("grab-a");
    click("grab-a");
    expect(screen.getByTestId("grabbed").textContent).toBe("—");
  });

  it("Escape-отмена сбрасывает и взятое, и перетаскивание", () => {
    render(<Harness onDrop={vi.fn()} />);
    click("grab-a");
    stubElementFromPoint(() => screen.getByTestId("zone-b"));
    firePointerDown(screen.getByTestId("handle-a"));
    expect(screen.getByTestId("active").textContent).toBe("a");

    click("cancel");
    expect(screen.getByTestId("active").textContent).toBe("—");
    expect(screen.getByTestId("grabbed").textContent).toBe("—");
  });

  it("в выключенном хуке взять нельзя", () => {
    render(<Harness onDrop={vi.fn()} disabled />);
    click("grab-a");
    expect(screen.getByTestId("grabbed").textContent).toBe("—");
  });
});
