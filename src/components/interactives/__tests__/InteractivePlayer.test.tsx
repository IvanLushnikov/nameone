/**
 * Диспетчер плееров (ТЗ §4.3, пункт 2) + поведение движка на минимальных
 * конфигах каждого формата.
 *
 * Главное, что тут ловится: новый формат, добавленный в `InteractiveFormat`,
 * но забытый в `InteractivePlayer` — покажет пустой экран ученику. Поэтому
 * тест перебирает ВСЕ шесть форматов из реестра и требует, чтобы каждый
 * отрендерил свой корневой маркер `data-interactive-format`.
 *
 * jsdom не умеет `elementFromPoint` (нужен для pointer-drag) — здесь его не
 * трогаем: проверяем рендер и логику, а перетаскивание живёт в отдельном
 * тесте `useDragSort.test.tsx`.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { InteractivePlayer } from "../InteractivePlayer";
import { INTERACTIVE_FORMATS, type InteractiveConfig } from "@/lib/interactives/types";

/** Минимальный, но валидный конфиг под каждый формат. */
const CONFIG: Record<string, InteractiveConfig> = {
  "quiz-race": {
    format: "quiz-race",
    title: "Викторина",
    options: { itemCount: 2, secondsPerItem: 0, shuffleOptions: false },
    items: [
      { id: "q1", prompt: "2 + 2 = ?", options: ["4", "5"], correctIndex: 0 },
      { id: "q2", prompt: "3 + 3 = ?", options: ["6", "7"], correctIndex: 0 },
    ],
  },
  "sort-baskets": {
    format: "sort-baskets",
    title: "Корзины",
    options: { baskets: ["Свой", "Чужой"] },
    items: [
      { id: "b1", prompt: "Собака", correctBucket: "Свой" },
      { id: "b2", prompt: "Луна", isTrap: true },
    ],
  },
  "jump-truth": {
    format: "jump-truth",
    title: "Правда",
    options: { itemCount: 2, boardSize: 6, mines: 2 },
    items: [
      { id: "j1", prompt: "5 больше 3", isTrue: true },
      { id: "j2", prompt: "У квадрата 5 сторон", isTrue: false },
    ],
  },
  "fortune-wheel": {
    format: "fortune-wheel",
    title: "Колесо",
    options: { sectors: ["Сложение", "Вычитание"], questionsPerSector: 1 },
    items: [
      { id: "w1", prompt: "2+2", bucket: "Сложение", options: ["4", "5"], correctIndex: 0 },
      { id: "w2", prompt: "7−2", bucket: "Вычитание", options: ["5", "4"], correctIndex: 0 },
    ],
  },
  jeopardy: {
    format: "jeopardy",
    title: "Своя игра",
    options: { categories: ["Лёгкое", "Сложное"], rows: 1, pointLadder: [100, 200], mode: "solo" },
    items: [
      { id: "p1", prompt: "Лёгкий вопрос", bucket: "Лёгкое", points: 100, options: ["да", "нет"], correctIndex: 0 },
      { id: "p2", prompt: "Сложный вопрос", bucket: "Сложное", points: 200, options: ["да", "нет"], correctIndex: 1 },
    ],
  },
  "sort-sequence": {
    format: "sort-sequence",
    title: "Порядок",
    options: { itemCount: 3, mode: "order", principle: "ascending" },
    items: [
      { id: "s1", prompt: "один", orderIndex: 0 },
      { id: "s2", prompt: "два", orderIndex: 1 },
      { id: "s3", prompt: "три", orderIndex: 2 },
    ],
  },
};

afterEach(() => cleanup());

function renderPlayer(config: InteractiveConfig) {
  return render(
    <InteractivePlayer
      config={config}
      initial={null}
      onChange={vi.fn()}
      onFinish={vi.fn()}
    />,
  );
}

describe("InteractivePlayer — исчерпывающий диспетчер", () => {
  it.each(INTERACTIVE_FORMATS)("формат %s отрендерил свой плеер", (format) => {
    const config = CONFIG[format];
    expect(config, `нет тестового конфига для ${format}`).toBeTruthy();
    const { container } = renderPlayer(config);
    const node = container.querySelector(`[data-interactive-format="${format}"]`);
    expect(node, `формат ${format} не отрендерился`).toBeTruthy();
  });

  it("у всех шести форматов есть тестовый конфиг — новый формат не забудем", () => {
    for (const format of INTERACTIVE_FORMATS) expect(CONFIG[format], format).toBeTruthy();
  });

  it("неизвестный формат не роняет страницу, а показывает понятный текст", () => {
    const config = { ...CONFIG["quiz-race"], format: "не-такой" } as unknown as InteractiveConfig;
    renderPlayer(config);
    expect(screen.getByText(/пока не поддерживается/i)).toBeTruthy();
  });

  it("пустой конфиг формата не показывает белый экран", () => {
    const config: InteractiveConfig = {
      ...CONFIG["quiz-race"],
      items: [],
    };
    renderPlayer(config);
    expect(screen.getByText(/В интерактиве нет вопросов/)).toBeTruthy();
  });
});

describe("плееры зовут onChange (снапшот для восстановления)", () => {
  it.each(INTERACTIVE_FORMATS.filter((f) => f !== "jeopardy"))(
    "формат %s сообщает своё состояние наружу",
    (format) => {
      const onChange = vi.fn();
      render(
        <InteractivePlayer
          config={CONFIG[format]}
          initial={null}
          onChange={onChange}
          onFinish={vi.fn()}
        />,
      );
      expect(onChange).toHaveBeenCalled();
    },
  );

  it("jeopardy начинает с экрана имён и сохраняет состояние только после старта", () => {
    // Особый случай: пока имена не введены, сохранять нечего — снапшот пустой.
    const onChange = vi.fn();
    render(
      <InteractivePlayer
        config={CONFIG.jeopardy}
        initial={null}
        onChange={onChange}
        onFinish={vi.fn()}
      />,
    );
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("jeopardy-name")).toBeTruthy();
  });
});

describe("устойчивость к мусорному снапшоту", () => {
  it.each(INTERACTIVE_FORMATS)("формат %s не падает на чужом снапшоте", (format) => {
    const junk = { index: 999, order: ["нет-такого"], chosen: { "нет-такого": 1 } };
    expect(() =>
      render(
        <InteractivePlayer
          config={CONFIG[format]}
          initial={junk}
          onChange={vi.fn()}
          onFinish={vi.fn()}
        />,
      ),
    ).not.toThrow();
  });
});
