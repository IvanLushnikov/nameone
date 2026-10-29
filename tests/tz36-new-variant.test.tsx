/**
 * ТЗ-36: «Новый вариант» должен просить НОВЫЙ материал.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ЗДЕСЬ ЛОВИТСЯ
 *
 * Жалоба учителя (исследование 29.10.2026, карточка M-02): он сделал лист по
 * «Обыкновенным дробям», ему не понравился третий вопрос, он нажал
 * «Новый вариант» — и получил ТОТ ЖЕ лист байт в байт: тот же id, та же дата
 * создания, `meta.model = "semantic-cache"`, `costUsd = 0`.
 *
 * Причина была не в кэше, а в том, что фронт про него не говорил. Обход
 * кэша (`bypassCache`) на сервере был всегда: `backend/src/routes/worksheets.ts`
 * честно передаёт `body.bypassCache ?? false` в `generateWorksheet`, а тот
 * при `true` не смотрит в кэш. Но `handleNewVariant` звал обычный `generate()`,
 * а тот уходил в `generateWorksheetSmart(body)` без флага — и фронт считал
 * запрос новым, а сервер отдавал прошлый ответ. Обе стороны были по-своему
 * правы, и вместе они ломали кнопку.
 *
 * Тест смотрит на ПЕРЕХВАЧЕННОЕ ТЕЛО ЗАПРОСА, а не на исходник: иначе это
 * будет проверка «есть ли строка `bypassCache` в файле», которая ничего не
 * говорит о поведении кнопки.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ЕЩЁ ПРОВЕРЯЕТСЯ
 *
 * 1. «Новый вариант» отправляет `bypassCache: true`.
 * 2. ОБЫЧНАЯ генерация флага НЕ отправляет: первая генерация по теме идёт
 *    через кэш (AD-5) — кэш это ускоритель, и он должен работать.
 * 3. Тип без серверного эндпоинта («урок целиком», `/api/bundles/generate`
 *    на сервере 404) по-прежнему отдаёт заготовку и не падает — даже когда
 *    флаг обхода кэша проставлен.
 *
 * Сеть не используется: адрес бэка задан через `vi.hoisted` (клиент читает
 * `NEXT_PUBLIC_API_URL` на верхнем уровне модуля), а ответы — локальные.
 */
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";

import ConstructorPage from "@/app/constructor/page";
import { generateBundleSmart } from "@/lib/client/llm";
import type { GenerationRequest } from "@/lib/types";
import {
  flushPageTimers,
  generateWorksheet,
  goToTopicStep,
  openConstructor,
  serverWorksheet,
  setDevice,
} from "./integration/helpers/constructor-flow";

/** Тела запросов к бэку — то, что реально уходит на сервер. */
let sentBodies: Array<Record<string, unknown>> = [];

/**
 * Локальный ответ бэка:Usage — остаток квоты, генерация — настоящий ответ
 * сервера. Тела запросов записываются, чтобы проверить, ЧТО ушло на сервер.
 */
function stubApi(): void {
  sentBodies = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(
      typeof input === "string" ? input : input instanceof Request ? input.url : input,
    );
    if (url.includes("/api/users/usage")) {
      return new Response(
        JSON.stringify({
          generationsToday: 0,
          generationsLimit: 3,
          plan: "free",
          freeRemaining: 5,
          freeUsed: 0,
          freeResetsAt: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("/api/worksheets/generate")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      sentBodies.push(body);
      return new Response(JSON.stringify({ ok: true, worksheet: serverWorksheet() }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    // Остальные ручки — заглушка «ok».
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  // localStorage живёт между тестами в одном jsdom, а конструктор кладёт туда
  // историю листов: без очистки второй тест открывает страницу уже с
  // восстановленным листом и не доходит до первого шага.
  window.localStorage.clear();
  window.history.replaceState({}, "", "/constructor/");
  stubApi();
  // Десктоп: jsdom не умеет matchMedia, а страница его спрашивает (например,
  // перед запуском конфетти). Без подмены прогон падает на стороне страницы.
  setDevice({ coarse: false, touchPoints: 0, width: 1440 });
  // «Меньше движения» — чтобы конфетти не запускались: в jsdom нет canvas,
  // и анимация конфетти падает уже после теста, засоряя прогон.
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ТЗ-36: «Новый вариант» просит новый материал", () => {
  it("обычная генерация НЕ просит обход кэша — первая генерация идёт через кэш", async () => {
    const user = await openConstructor();
    await goToTopicStep(user, "math", 5);
    await generateWorksheet(user);

    expect(sentBodies.length).toBe(1);
    // Флага нет вообще — не «false», а отсутствие: сервер сам решает,
    // брать ответ из кэша или сгенерировать.
    expect("bypassCache" in sentBodies[0]).toBe(false);
  });

  it("«Новый вариант» отправляет bypassCache: true", async () => {
    const user = await openConstructor();
    await goToTopicStep(user, "math", 5);
    await generateWorksheet(user);
    expect(sentBodies.length).toBe(1);

    const button = screen.getByRole("button", { name: /Новый вариант/ });
    await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
    await user.click(button);

    await waitFor(() => expect(sentBodies.length).toBe(2));
    expect(sentBodies[1].bypassCache).toBe(true);
    // Первая генерация при этом осталась без флага — обход включается только
    // кнопкой «Новый вариант», а не всем подряд.
    expect("bypassCache" in sentBodies[0]).toBe(false);

    await flushPageTimers();
  });

  it("у кнопки «Новый вариант» есть подпись про расход квоты", async () => {
    // ТЗ-36 §3: учитель должен ВИДЕТЬ, что «Новый вариант» стоит попытки.
    // Раньше попытка исчезала молча, и кнопка выглядела как «ничего не
    // изменилось».
    const user = await openConstructor();
    await goToTopicStep(user, "math", 5);
    await generateWorksheet(user);

    expect(screen.getByText(/новая генерация, она расходует квоту/i)).toBeTruthy();
  });
});

describe("ТЗ-36: тип без серверного эндпоинта не ломается", () => {
  const request: GenerationRequest = {
    subject: "math",
    grade: 5,
    topic: "Обыкновенные дроби",
    difficulty: "medium",
    count: 3,
    type: "lesson-bundle",
    withAnswers: true,
    withExplanations: true,
  };

  it("«урок целиком» отдаёт заготовку и не падает, даже с обходом кэша", async () => {
    // `/api/bundles/generate` на сервере не существует (404) — заготовка
    // здесь и есть реализация. Флаг обхода кэша ничего не меняет: запроса
    // к бэку, который мог бы попасть в кэш, тут нет.
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    const result = await generateBundleSmart(request, { bypassCache: true });
    expect(result.isDemo).toBe(true);
    expect(result.demoReason).toBe("no_llm_endpoint");
    expect(result.data).toBeTruthy();
  });
});
