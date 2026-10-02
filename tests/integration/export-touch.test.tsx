/**
 * З4: экспорт по типу устройства — `src/app/constructor/page.tsx`.
 *
 * Правило: на тач-устройстве (iPad / планшет / телефон) кнопки «Скачать DOCX»
 * НЕТ вообще — на iPad скачивание файла неудобно, печать работает через
 * системный диалог «Сохранить в PDF». На десктопе DOCX на месте, чтобы
 * учитель мог скачать файл для редактирования. На таче вместо кнопки
 * показывается строка-объяснение.
 *
 * ПОЧЕМУ ТАК СЛОЖНО С ПОДМЕНОЙ. `isTouchDevice()` (`src/lib/utils/device.ts`)
 * проверяет признаки по порядку, и порядок важен:
 *   1) iPad/iOS по UA + `maxTouchPoints > 1` — единственный случай, когда
 *      pointer-медиа врёт (iPad с мышью отдаёт `pointer: fine`);
 *   2) `matchMedia("(pointer: coarse)")` ИЛИ `maxTouchPoints > 0`;
 *   3) фолбэк по ширине окна: ≤1024px = тач.
 * Дефолтный `window.innerWidth` в jsdom равен ровно 1024, поэтому «десктоп»
 * без явной подмены ширины получился бы тачем — подменяем все три признака
 * явно (см. `setDevice` в хелпере).
 *
 * Тест прямой: реальный визард доходит до экрана результата, и мы смотрим
 * на DOM тулбара экспорта.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import {
  flushPageTimers,
  generateWorksheet,
  goToTopicStep,
  IPADOS_UA,
  mockApi,
  openConstructor,
  setDevice,
  type DeviceStub,
} from "./helpers/constructor-flow";

// next/navigation — концерн jsdom: страница читает useSearchParams/useRouter.
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/constructor/",
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

// canvas-confetti после успешной генерации рисует частицы через rAF.
// В jsdom `canvas.getContext("2d")` возвращает null, и ошибка прилетает уже
// после теста (uncaught), из-за чего vitest считает прогон упавшим. Сами
// частицы в логике экспорта не участвуют — глушим.
vi.mock("canvas-confetti", () => ({ default: () => {} }));

/** Тач: coarse-указатель, 5 точек касания, узкое окно — все признаки сходятся. */
const TOUCH: DeviceStub = { coarse: true, touchPoints: 5, width: 1024 };
/** Десктоп: fine-указатель, нет точек касания, широкое окно. */
const DESKTOP: DeviceStub = { coarse: false, touchPoints: 0, width: 1600 };

const PDF_BUTTON = /Сохранить в PDF/;
const DOCX_BUTTON = /Скачать DOCX/;
const TOUCH_HINT = /На планшете файл сохраняется как PDF/;

beforeEach(() => {
  window.localStorage.clear();
  mockApi();
});

/** Полный путь до готового рабочего листа: визард + мок-генерация. */
async function makeWorksheetOn(stub: DeviceStub): Promise<void> {
  setDevice(stub);
  const user = await openConstructor();
  await goToTopicStep(user, "algebra", 7);
  await generateWorksheet(user);
}

describe("экспорт по типу устройства (З4)", () => {
  it("на тач-устройстве кнопки «Скачать DOCX» нет", async () => {
    await makeWorksheetOn(TOUCH);

    expect(screen.getByRole("button", { name: PDF_BUTTON })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: DOCX_BUTTON })).not.toBeInTheDocument();
    // Кнопки нет вообще в разметке, а не просто под другим именем.
    expect(document.body.innerHTML).not.toContain("Скачать DOCX");

    await flushPageTimers();
  });

  it("на таче есть кнопка PDF и строка-объяснение, почему нет DOCX", async () => {
    await makeWorksheetOn(TOUCH);

    expect(screen.getByRole("button", { name: PDF_BUTTON })).toBeInTheDocument();
    expect(screen.getByText(TOUCH_HINT)).toBeInTheDocument();

    await flushPageTimers();
  });

  it("на десктопе кнопка «Скачать DOCX» есть, а подсказки про планшет нет", async () => {
    await makeWorksheetOn(DESKTOP);

    expect(screen.getByRole("button", { name: DOCX_BUTTON })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: PDF_BUTTON })).toBeInTheDocument();
    expect(screen.queryByText(TOUCH_HINT)).not.toBeInTheDocument();

    await flushPageTimers();
  });

  it("iPad с мышью (pointer: fine, но maxTouchPoints > 1) считается тачем", async () => {
    // Главная причина, ради которой `isTouchDevice()` проверяет iPad ДО
    // pointer-медиа: с подключённой мышью iPad отдаёт `pointer: fine`, и
    // без UA-маски кнопка DOCX показалась бы на планшете.
    await makeWorksheetOn({
      coarse: false, // ← мышь подключена
      touchPoints: 5,
      width: 1600, // ← и окно широкое (не сработал бы фолбэк по ширине)
      userAgent: IPADOS_UA,
    });

    expect(screen.queryByRole("button", { name: DOCX_BUTTON })).not.toBeInTheDocument();
    expect(screen.getByText(TOUCH_HINT)).toBeInTheDocument();

    await flushPageTimers();
  });
});
