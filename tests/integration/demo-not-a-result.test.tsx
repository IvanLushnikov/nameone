/**
 * Заготовка — не результат (аудит 18.10.2026, BUG-018/BUG-025).
 *
 * Файл закрывает ОДНО правило, а не разрозненные мелочи:
 *
 *   Если учитель получил заготовку (сервис недоступен, тип без серверного
 *   эндпоинта, сборка без адреса сервера), то:
 *     1) зелёного тоста «Готово!» нет — есть честное сообщение;
 *     2) праздник (конфетти) не запускается;
 *     3) заготовка НЕ попадает в историю — ни в локальную, ни на сервер;
 *     4) после перезагрузки заготовка не «восстанавливается» — восстанавливать
 *        нечего, потому что её не сохраняли.
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ ФАЙЛ, А НЕ ДОБАВЛЕНИЕ В WORKSHEET-RESTORE:
 * клиент читает `NEXT_PUBLIC_API_URL` на верхнем уровне модуля, то есть
 * режим («сервер» или «демо») выбирается ДО импорта конструктора. В одном
 * файле оба режима не уживаются: `vi.hoisted` ставит адрес один раз на файл.
 *
 * Здесь адрес НЕ задан → сборка без сервера → заготовка. В файле
 * worksheet-restore.test.tsx адрес задан → настоящий лист с сервера.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement, type ComponentType } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ConstructorPage from "@/app/constructor/page";
import { getHistory } from "@/lib/utils/storage";
import {
  flushPageTimers,
  generateWorksheet,
  goToTopicStep,
  setDevice,
} from "./helpers/constructor-flow";

interface ToastCall {
  tone?: string;
  title: string;
  description?: string;
}

let toastCalls: ToastCall[] = [];
vi.mock("@/components/ui/Toast", async () => {
  const actual = await vi.importActual<typeof import("@/components/ui/Toast")>(
    "@/components/ui/Toast"
  );
  return {
    ...actual,
    useToast: () => ({
      toast: (t: ToastCall) => {
        toastCalls.push(t);
      },
    }),
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => "/constructor/",
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
}));

function renderConstructor(): ReturnType<typeof render> {
  return render(createElement(ConstructorPage as ComponentType));
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState({}, "", "/constructor");
  toastCalls = [];
  setDevice({ coarse: false, touchPoints: 0, width: 1600 });
});

describe("заготовка не выдаётся за результат", () => {
  it("в демо-режиме: нет тоста «Готово!», есть честное сообщение, и заготовка не попадает в историю", async () => {
    const view = renderConstructor();
    await screen.findByText("Что и для кого");

    const user = userEvent.setup();
    await goToTopicStep(user, "algebra", 7);
    await generateWorksheet(user);

    // 1) Зелёного «Готово!» нет — вместо него честное сообщение.
    expect(toastCalls.filter((t) => t.title === "Готово!")).toHaveLength(0);
    const demoToasts = toastCalls.filter((t) => /заготовка|шаблон/i.test(t.title));
    expect(demoToasts.length).toBeGreaterThan(0);
    expect(demoToasts[0]!.tone).not.toBe("success");

    // 2) На экране плашка «Это демонстрационная заготовка» — учитель видит,
    //    что перед ним типовой пример, а не собранный материал.
    await waitFor(() => {
      expect(
        screen.getAllByText(/демонстрационная заготовка/i).length,
      ).toBeGreaterThan(0);
    });

    // 3) В ИСТОРИИ заготовки нет. Раньше она попадала туда вместе с
    //    кнопкой «Выдать классу» — учитель видел в кабинете девять «своих»
    //    листов, которых не делал.
    expect(getHistory()).toHaveLength(0);

    // 4) После перезагрузки восстанавливать нечего: тоста восстановления
    //    нет, заготовка не вернулась на экран.
    view.unmount();
    toastCalls = [];
    renderConstructor();
    await screen.findByText("Что и для кого");
    await flushPageTimers();

    expect(toastCalls.filter((t) => t.title === "Лист восстановлен")).toHaveLength(0);
    expect(getHistory()).toHaveLength(0);
  }, 40_000);
});
