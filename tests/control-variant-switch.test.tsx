/**
 * Два варианта контрольной работы — регрессия от 08.10.2026.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ЗДЕСЬ ЛОВИТСЯ
 * ─────────────────────────────────────────────────────────────────────────────
 * Жалоба учительницы: «Когда создаёшь контрольную работу на 2 варианта,
 * генерится только один. И тот кривой».
 *
 * Первый фикс сделал две вещи правильно (генерация двух листов, второй мимо
 * кэша) и одну — неправильно. Переключатель брал «вариант 1» из `worksheet`:
 *
 *     const next = n === 1 ? worksheet : controlVariant2;
 *
 * Но `worksheet` — это лист, который СЕЙЧАС НА ЭКРАНЕ, и клик по «Вариант 2»
 * записывал в него второй лист. После этого `worksheet` и «вариант 1» — это
 * одно и то же, и возврат к первому варианту был невозможен: учитель видел
 * подпись «Вариант 1» с содержимым варианта 2, и так же назывался файл.
 *
 * Тестов на это не было: в плане исправлений стояла проверка «по testid»,
 * что проверкой не является. Тест кликает по настоящему компоненту.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ControlVariantSwitch } from "@/components/constructor/ControlVariantSwitch";

/** Лист-заглушка: варианты различаем заголовком и текстом задания. */
function sheet(n: 1 | 2) {
  return {
    id: `ws_variant${n}`,
    title: `Контрольная вариант ${n}`,
    subject: "biology",
    grade: 9,
    topic: "t",
    tasks: [
      { number: 1, text: `Задание варианта ${n}`, type: "short-answer", answer: "x", points: 1 },
    ],
  };
}

/**
 * Обёртка: повторяет, как страница использует компонент, — держит «что сейчас
 * показано» и передаёт выбранный вариант наружу.
 */
function Harness() {
  const [active, setActive] = React.useState<1 | 2>(1);
  const [shown, setShown] = React.useState(sheet(1));
  return (
    <>
      <ControlVariantSwitch
        variant1={sheet(1)}
        variant2={sheet(2)}
        active={active}
        onVariantChange={(n) => {
          setActive(n);
          setShown(n === 1 ? sheet(1) : sheet(2));
        }}
      />
      <div data-testid="shown">{shown.title}</div>
    </>
  );
}

describe("переключатель вариантов контрольной", () => {
  it("после перехода на вариант 2 показывает ИМЕННО его задания", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("control-variant-2"));
    expect(screen.getByTestId("shown").textContent).toBe("Контрольная вариант 2");
  });

  it("ВОЗВРАЩАЕТ вариант 1 после перехода на вариант 2 (тот самый баг)", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("control-variant-2"));
    expect(screen.getByTestId("shown").textContent).toBe("Контрольная вариант 2");

    // Возврат. В сломанной версии здесь снова был бы вариант 2.
    fireEvent.click(screen.getByTestId("control-variant-1"));
    expect(screen.getByTestId("shown").textContent).toBe("Контрольная вариант 1");
  });

  it("переключается туда-обратно пять раз и каждый раз показывает верное", () => {
    render(<Harness />);
    for (let i = 0; i < 5; i += 1) {
      fireEvent.click(screen.getByTestId("control-variant-2"));
      expect(screen.getByTestId("shown").textContent).toBe("Контрольная вариант 2");
      fireEvent.click(screen.getByTestId("control-variant-1"));
      expect(screen.getByTestId("shown").textContent).toBe("Контрольная вариант 1");
    }
  });

  it("помечает активный вариант для доступности", () => {
    render(<Harness />);
    expect(screen.getByTestId("control-variant-1")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("control-variant-2")).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByTestId("control-variant-2"));
    expect(screen.getByTestId("control-variant-1")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("control-variant-2")).toHaveAttribute("aria-pressed", "true");
  });

  it("не рисуется, если второго варианта нет — обещать нечего", () => {
    // Иначе учитель увидел бы кнопку «Вариант 2» у работы, у которой варианта
    // два нет (второй проход упал).
    const onChange = vi.fn();
    render(
      <ControlVariantSwitch variant1={sheet(1)} variant2={null} active={1} onVariantChange={onChange} />,
    );
    expect(screen.queryByTestId("control-variant-switch")).toBeNull();
  });
});