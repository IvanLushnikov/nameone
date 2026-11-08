/**
 * ТЗ-39: ФГОС-ЯКОРЬ УХОДИТ В ЗАПРОС К МОДЕЛИ.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО ЛОВИТ ЭТОТ ТЕСТ
 * ─────────────────────────────────────────────────────────────────────────────
 * Таксономия ФГОС собрана и проверена: 5 658 тем по 141 паре «предмет × класс»,
 * покрытие полное. У темы есть `fgosRef` — название раздела федеральной
 * программы — и `examples`: примеры заданий, написанные по этому содержанию.
 *
 * Но до ТЗ-39 до генерации эта таксономия не доходила: модель получала только
 * название темы и придумывала навыки сама. Тест смотрит на ПЕРЕХВАЧЕННОЕ ТЕЛО
 * ЗАПРОСА, а не на исходник: иначе это проверка «есть ли строка `fgosRef` в
 * файле», которая ничего не говорит о поведении конструктора.
 *
 * Три случая:
 *   1. тема из каталога с разделом → в запросе есть `meta.fgosRef` и
 *      `meta.fgosExample`;
 *   2. тема из каталога без раздела → якоря нет, запрос как раньше (придумывать
 *      раздел программы нельзя — это была бы выдумка, которую модель примет за
 *      программу);
 *   3. тема, которой в каталоге нет → якоря нет (это и есть «тема, введённая
 *      руками»: у неё нет раздела программы).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * СЕТЬ
 * ─────────────────────────────────────────────────────────────────────────────
 * Адрес бэка задан через `vi.hoisted` (клиент читает `NEXT_PUBLIC_API_URL` на
 * верхнем уровне модуля), ответы — локальные. Реальный polza.ai — платный,
 * тест в сеть не ходит.
 */

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";

import { fgosAnchorForTopic } from "@/lib/content/fgos-anchor";
import { getGrade } from "@/lib/content/subjects";
import {
  flushPageTimers,
  goToTopicStep,
  openConstructor,
  serverWorksheet,
  setDevice,
} from "./integration/helpers/constructor-flow";

/** Тела запросов к бэку — то, что реально уходит на сервер. */
let sentBodies: Array<Record<string, unknown>> = [];

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
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState({}, "", "/constructor/");
  stubApi();
  setDevice({ coarse: false, touchPoints: 0, width: 1440 });
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => {},
    }),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Выбрать тему по названию и сгенерировать лист. */
async function generateForTopic(
  user: Awaited<ReturnType<typeof openConstructor>>,
  topicTitle: string,
): Promise<void> {
  const list = screen.getByTestId("topics-list");
  const button = Array.from(list.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").includes(topicTitle),
  );
  if (!button) throw new Error(`Тема «${topicTitle}» не найдена в списке`);
  await user.click(button);
  await user.click(await screen.findByRole("button", { name: /Создать рабочий лист/ }));
  await waitFor(() => expect(sentBodies.length).toBeGreaterThan(0), { timeout: 10_000 });
}

/** Метаданные запроса из перехваченного тела. */
function metaOf(index = 0): Record<string, unknown> {
  const request = sentBodies[index].request as Record<string, unknown> | undefined;
  return (request?.meta ?? {}) as Record<string, unknown>;
}

describe("ТЗ-39: якорь собирается из таксономии", () => {
  it("у темы с разделом — якорь есть", () => {
    const anchor = fgosAnchorForTopic("math", 5, "drobi-obyknovennye");
    expect(anchor).not.toBeNull();
    expect(anchor!.fgosRef).toBe("Числа и действия с ними");
    expect(anchor!.fgosExample?.text).toBe("Сократите дробь: 8/12 = __");
  });

  it("у темы без раздела — якоря нет", () => {
    // Раздел не проставлен у 4550 тем из 6567. Придумывать его нельзя:
    // модель приняла бы выдумку за программу.
    expect(fgosAnchorForTopic("math", 5, "sravnenie-drobey")).toBeNull();
  });

  it("темы, которой нет в каталоге, — якоря нет", () => {
    expect(fgosAnchorForTopic("math", 5, "temy-net-v-kataloge")).toBeNull();
    expect(fgosAnchorForTopic("math", 5, null)).toBeNull();
    expect(fgosAnchorForTopic("math", 99, "drobi-obyknovennye")).toBeNull();
  });

  it("пример берётся ровно один", () => {
    const anchor = fgosAnchorForTopic("math", 5, "drobi-obyknovennye");
    const examples = getGrade("math", 5)!.topics.find((t) => t.slug === "drobi-obyknovennye")!
      .examples;
    expect(examples.length).toBeGreaterThan(1);
    // Ровно один пример: два примера сужают формулировки сильнее, чем нужно.
    expect(anchor!.fgosExample?.text).toBe(examples[0].text);
  });
});

describe("ТЗ-39: запрос из конструктора несёт якорь", () => {
  it("тема с разделом → в запросе meta.fgosRef и meta.fgosExample", async () => {
    const user = await openConstructor();
    await goToTopicStep(user, "math", 5);
    await generateForTopic(user, "Обыкновенные дроби");

    const meta = metaOf();
    expect(meta.fgosRef).toBe("Числа и действия с ними");
    expect(meta.fgosExample).toEqual({
      text: "Сократите дробь: 8/12 = __",
      answer: "2/3",
    });
    await flushPageTimers();
  });

  it("тема без раздела → в запросе нет якоря", async () => {
    const user = await openConstructor();
    await goToTopicStep(user, "math", 5);
    await generateForTopic(user, "Сравнение обыкновенных дробей");

    const meta = metaOf();
    expect(meta.fgosRef).toBeUndefined();
    expect(meta.fgosExample).toBeUndefined();
    await flushPageTimers();
  });

  it("тема, которой нет в каталоге → в запросе нет якоря", async () => {
    // Тема из ссылки, которой нет в каталоге, ведёт учителя к выбору темы, а
    // не в генерацию. Но правило «нет темы в каталоге — нет якоря» должно
    // работать и на уровне сборки якоря.
    expect(fgosAnchorForTopic("math", 5, "nesushchestvuyushchaya-tema")).toBeNull();
  });
});
