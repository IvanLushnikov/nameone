/**
 * Клиент фото-проверки: контракт multipart для нескольких страниц.
 *
 * Проверяем ровно то, на чём держится совместная работа с бэком:
 *  1. все страницы едут ОДНИМ запросом, каждая под полем `image`, и их порядок
 *     в FormData = порядок страниц тетради (бэк читает `getAll("image")` и
 *     показывает их модели именно в этом порядке);
 *  2. прежние поля (`tasks`, `consent`, `detail`) не сломались;
 *  3. учителю показывается ТЕКСТ сервера («до 3 фото работы»), а не код и не
 *     заглушка «Что-то пошло не так».
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Модуль читает env на верхнем уровне — задаём ДО импорта (как в
// tests/worksheets-api.test.ts).
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
});

import { runPhotoCheck, ERROR_TEXT } from "@/lib/photo-check/api";

const fetchMock = vi.fn();

const okResponse = (body: unknown) =>
  ({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
  }) as unknown as Response;

const failResponse = (status: number, body: unknown) =>
  ({
    ok: false,
    status,
    statusText: "Error",
    json: async () => body,
  }) as unknown as Response;

const TASKS = [{ number: 1, taskText: "Сложение", correctAnswer: "10", maxPoints: 1 }];

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runPhotoCheck: страницы в одной форме", () => {
  it("кладёт три страницы под image в порядке страниц работы", async () => {
    fetchMock.mockResolvedValue(okResponse({ ok: true, checkId: "chk-1", status: "ok", items: [] }));

    // Разный размер — по нему видно, ЧТО именно уехало, а не только сколько.
    const blobs = [
      new File(["11"], "shot.jpg", { type: "image/jpeg" }),
      new File(["222"], "shot.jpg", { type: "image/jpeg" }),
      new File(["3333"], "shot.jpg", { type: "image/jpeg" }),
    ];

    await runPhotoCheck({ blobs, tasks: TASKS });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = fetchMock.mock.calls[0][1].body as FormData;
    const images = body.getAll("image") as File[];
    expect(images).toHaveLength(3);
    expect(images.map((f) => f.size)).toEqual([2, 3, 4]);
    expect(images.map((f) => f.name)).toEqual(["page-1.jpg", "page-2.jpg", "page-3.jpg"]);

    // Прежние поля формы не должны были поехать вместе с новым контрактом.
    expect(JSON.parse(body.get("tasks") as string)).toEqual(TASKS);
    expect(body.get("consent")).toBe("true");
    expect(body.get("detail")).toBe("low");
  });

  it("одна страница едет так же, как раньше", async () => {
    fetchMock.mockResolvedValue(okResponse({ ok: true, checkId: "chk-1", status: "ok", items: [] }));

    await runPhotoCheck({ blobs: [new File(["1"], "page.jpg", { type: "image/jpeg" })], tasks: TASKS });

    const body = fetchMock.mock.calls[0][1].body as FormData;
    expect(body.getAll("image")).toHaveLength(1);
  });

  it("текст сервера проходит учителю", async () => {
    fetchMock.mockResolvedValue(
      failResponse(400, {
        ok: false,
        error: "За одну проверку — до 3 фото работы, пришло 4.",
        code: "BAD_REQUEST",
      }),
    );

    const res = await runPhotoCheck({
      blobs: [new File(["1"], "page.jpg", { type: "image/jpeg" })],
      tasks: TASKS,
    });

    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toBe("bad_request");
    expect(res.ok === false && res.message).toBe("За одну проверку — до 3 фото работы, пришло 4.");
  });

  it("код без текста не показывается учителю — берётся текст по типу ошибки", async () => {
    // Шлюз перед бэком может прислать только код. «TOO_MANY_FILES» на экране
    // учителю читается хуже, чем внятный текст по типу ошибки.
    fetchMock.mockResolvedValue(failResponse(400, { ok: false, code: "TOO_MANY_FILES" }));

    const res = await runPhotoCheck({
      blobs: [new File(["1"], "page.jpg", { type: "image/jpeg" })],
      tasks: TASKS,
    });

    expect(res.ok).toBe(false);
    expect(res.ok === false && res.message).toBe(ERROR_TEXT.bad_request);
  });
});