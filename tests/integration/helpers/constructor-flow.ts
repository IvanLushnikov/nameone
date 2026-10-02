/**
 * Общие хелперы для интеграционных тестов конструктора (папка tests/integration).
 *
 * Почему отдельный файл. `src/app/constructor/page.tsx` — это ~2600 строк
 * client-компонента с useSearchParams, useRouter, useUsage, генерацией артефакта
 * и экспортом в DOCX. Проверить З4/З8/З9 (устройство, счётчик тем, УМК-чипы)
 * можно только прогнав реальный визард, поэтому нужен общий «прогон по шагам».
 * Дублировать его в трёх тестах — гарантированный рассинхрон.
 *
 * Файл НЕ подпадает под include vitest (маска `*.test.ts` / `*.test.tsx`) — это
 * поддержка, а не тест. При этом он входит в `tsconfig.json` (раздел `include`,
 * маска `tests` + расширение `.ts`), поэтому написан на TypeScript и проверяется
 * командой `npm run typecheck`.
 */

import { createElement, type ComponentType } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { expect, vi } from "vitest";
import ConstructorPage from "@/app/constructor/page";
import { subjects } from "@/lib/content/subjects";
import type { SubjectSlug } from "@/lib/types";

/**
 * Ставит сетевые стабы: страница на mount делает GET /api/users/usage и
 * POST /api/worksheets. Реальной сети в тестах быть не должно, поэтому
 * отвечаем локально. `NEXT_PUBLIC_API_URL` в тестах не задан → генерация
 * идёт через мок-генератор (`src/lib/mock/*`), то есть полностью офлайн.
 */
export function mockApi(): void {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(
      typeof input === "string" ? input : input instanceof Request ? input.url : input
    );

    if (url.includes("/api/users/usage")) {
      return new Response(
        JSON.stringify({ generationsToday: 0, generationsLimit: 3, plan: "free" }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

export interface DeviceStub {
  /** Что отвечает `matchMedia("(pointer: coarse)")`. */
  coarse: boolean;
  /** `navigator.maxTouchPoints`. */
  touchPoints: number;
  /** `window.innerWidth`. */
  width: number;
  /** Подмена `navigator.userAgent` для проверки iPadOS-маски. */
  userAgent?: string;
}

/**
 * UA iPadOS 13+: притворяется десктопом (`Macintosh`), поэтому распознаётся
 * только по `maxTouchPoints > 1`. Именно этот случай ломает `pointer`-медиа:
 * iPad с подключённой мышью отдаёт `pointer: fine`.
 */
/** UA по умолчанию в jsdom — восстанавливаем его, если подмена не задана. */
const JSDOM_UA = navigator.userAgent;

export const IPADOS_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

/**
 * Подменяет признаки устройства. Важно: у `isTouchDevice()` есть фолбэк по
 * ширине окна (≤1024px = тач), а дефолтный `innerWidth` в jsdom ровно 1024 —
 * поэтому для «десктопа» ширину обязательно выставляем больше 1024, иначе
 * тест будет врать. iPad-случай (`Macintosh` + `maxTouchPoints > 1`) тут не
 * воспроизводим: подменять `navigator.userAgent` в jsdom нельзя надёжно,
 * этот путь закрыт в `tests/unit/device.test.ts`-подобном виде отдельно.
 */
export function setDevice(stub: DeviceStub): void {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query.includes("coarse") ? stub.coarse : false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
  Object.defineProperty(navigator, "maxTouchPoints", {
    value: stub.touchPoints,
    configurable: true,
  });
  Object.defineProperty(window, "innerWidth", {
    value: stub.width,
    configurable: true,
    writable: true,
  });
  // UA всегда переустанавливается: подмена одного теста не должна утекать
  // в следующий, а дефолт jsdom безопаснее «iPad» из предыдущего сценария.
  Object.defineProperty(navigator, "userAgent", {
    value: stub.userAgent ?? JSDOM_UA,
    configurable: true,
  });
}

/** Рендерит конструктор и дожидается первого шага визарда. */
export async function openConstructor(): Promise<UserEvent> {
  const user = userEvent.setup();
  render(createElement(ConstructorPage as ComponentType));
  await screen.findByText("Что и для кого");
  return user;
}

/**
 * Прогоняет визард до шага «Выберите тему»: предмет → класс → «Свой вариант»
 * → «Перейти к выбору темы».
 *
 * Путь именно такой, потому что с лета 2026 между шагом 1 и шагом «Тема»
 * стоит выбор сценария (PresetGrid, F-02).
 */
export async function goToTopicStep(
  user: UserEvent,
  subjectSlug: SubjectSlug,
  grade: number
): Promise<void> {
  const subject = subjects.find((s) => s.slug === subjectSlug);
  if (!subject) throw new Error(`Неизвестный предмет: ${subjectSlug}`);

  await user.click(screen.getByTitle(subject.title));
  await user.click(screen.getByTitle(`${grade} класс`));
  await user.click(await screen.findByRole("tab", { name: "Свой вариант" }));
  await user.click(screen.getByRole("button", { name: /Перейти к выбору темы/ }));
  await screen.findByText("Выберите тему");
}

/**
 * Выбирает первую тему и жмёт «Создать рабочий лист» — попадает на экран
 * результата, где живут кнопки экспорта (З4).
 */
export async function generateWorksheet(user: UserEvent): Promise<void> {
  const list = screen.getByTestId("topics-list");
  const firstTopic = list.querySelectorAll("button")[0];
  if (!firstTopic) throw new Error("Список тем пуст — нечего выбирать");

  await user.click(firstTopic);
  await user.click(await screen.findByRole("button", { name: /Создать рабочий лист/ }));
  // Экран результата: тулбар действий с кнопкой «Новый вариант».
  // Матчер toBeInTheDocument доступен только в .tsx-тестах (типы jest-dom),
  // поэтому здесь — обычная проверка наличия узла.
  await waitFor(() => {
    expect(screen.getByRole("button", { name: /Новый вариант/ })).toBeTruthy();
  }, { timeout: 10_000 });
}

/**
 * Даёт отработать отложенным таймерам страницы (скрытие прогресса — 200 мс).
 * Обёрнуто в `act`, иначе React получает setState после теста и vitest
 * считает прогон упавшим (плюс шумит предупреждением про act).
 * Пауза меньше секунды, сеть не задействована.
 */
export async function flushPageTimers(ms = 400): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}
