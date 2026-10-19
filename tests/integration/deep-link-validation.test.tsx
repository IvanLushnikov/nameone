/**
 * Deep-link с темой и классом проверяется по каталогу.
 *
 * Аудит 18.10.2026, BUG-029/BUG-030:
 *   - `?subject=math&grade=99` приводил в тупик: «Готовы сгенерировать
 *     математику 99 класса», а списка тем и кнопки перехода нет;
 *   - `?topic=neravenstva` (а валидный идентификатор — `m-neravenstva-9`)
 *     уходил в запрос как есть — учителю собирали то, чего он не просил.
 *
 * Теперь несуществующая тема ведёт к выбору темы с честным объяснением, а
 * несуществующий класс — к выбору предмета и класса. Ни то, ни другое не
 * доходит до запроса на генерацию.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement, type ComponentType } from "react";
import { render, screen } from "@testing-library/react";
import ConstructorPage from "@/app/constructor/page";
import { flushPageTimers, setDevice } from "./helpers/constructor-flow";

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
  toastCalls = [];
  setDevice({ coarse: false, touchPoints: 0, width: 1600 });
});

describe("deep-link проверяется по каталогу", () => {
  it("темы, которой нет, ведёт к выбору темы и говорит об этом", async () => {
    window.history.replaceState({}, "", "/constructor?subject=math&grade=5&topic=nesushchestvuyushchaya-tema");
    renderConstructor();

    // Учитель видит список тем (а не «параметры» для несуществующей темы).
    await screen.findByTestId("topics-list", undefined, { timeout: 10_000 });
    await flushPageTimers(600);

    const notFound = toastCalls.filter((t) => /такой темы нет/i.test(t.title));
    expect(notFound.length).toBeGreaterThan(0);
    expect(notFound[0]!.description).toMatch(/выберите тему/i);
  }, 40_000);

  it("класса, которого нет, ведёт к выбору предмета и класса", async () => {
    window.history.replaceState({}, "", "/constructor?subject=math&grade=99&topic=drobi-obyknovennye");
    renderConstructor();

    await screen.findByText("Что и для кого", undefined, { timeout: 10_000 });
    await flushPageTimers(600);

    const notFound = toastCalls.filter((t) => /такого класса нет/i.test(t.title));
    expect(notFound.length).toBeGreaterThan(0);
  }, 40_000);

  it("настоящая тема по ссылке открывает шаг параметров", async () => {
    window.history.replaceState({}, "", "/constructor?subject=math&grade=5&topic=drobi-obyknovennye");
    renderConstructor();

    // Шаг «параметры» — значит, тема принята и дошла до настройки листа.
    const generate = await screen.findByRole(
      "button",
      { name: /Создать рабочий лист/i },
      { timeout: 10_000 },
    );
    expect(generate).toBeTruthy();

    await flushPageTimers(600);
  }, 40_000);
});
