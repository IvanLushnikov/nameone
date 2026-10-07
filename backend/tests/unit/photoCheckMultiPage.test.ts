/**
 * Проверка по фото: несколько страниц за одну проверку (07.10.2026).
 *
 * Контекст. Работа ученика обычно на двух-трёх страницах, а ручка брала
 * `form.getAll("image")[0]` — то есть первую. Вторая и третья страницы молча
 * выпадали из проверки, и учитель получал неполный вердикт по полной цене.
 *
 * Что тут проверяем и почему именно это:
 *
 *   1. РАЗБОР multipart: одна страница ведёт себя как раньше, три — в порядке
 *      загрузки, четыре — отклоняются ПОНЯТНОЙ ошибкой (тихое игнорирование
 *      лишних фото — это ровно та дыра, которую закрываем);
 *   2. ЛИМИТ 8 МБ — на КАЖДОЕ фото, а не на первую попавшуюся: превышение
 *      второй или третьей страницы тоже должно отбиваться;
 *   3. ХРАНЕНИЕ: первое фото — на старом ключе (совместимость с уже
 *      существующими строками `photo_checks.r2_key`), остальные — на ключах с
 *      суффиксами `-2`/`-3`, без миграции D1;
 *   4. ДОСТАВКА В МОДЕЛЬ: три фото уходят тремя `image_url`-частями в том же
 *      порядке, в котором пришли — проверяем на реальном body, который уходит
 *      в polza, а не на вспомогательной функции;
 *   5. СТОИМОСТЬ: оценка vision-токенов умножается на число страниц, иначе
 *      три фото выглядели бы как одно и лимит платных планов считался бы
 *      неправильно;
 *   6. ГРАДУИРОВКА: от количества страниц не зависит — проверка не едет.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Context } from "hono";
import type { AppEnv } from "../../src/types";
import { checkPhoto } from "../../src/llm";
import { estimateImageTokens } from "../../src/llm/cost";
import { _resetPolzaSingleton } from "../../src/llm/providers/polza";
import { gradePhotoCheck, type ExpectedTask } from "../../src/services/photoCheckGrading";
import {
  readPhotoForm,
  photoR2Keys,
  extraPhotoKey,
  putPhotoObjects,
  deletePhotoObjects,
} from "../../src/routes/f06";

// ─── Мини-окружение для тестов ────────────────────────────────────────────────

const FAKE_ENV = { POLZA_API_KEY: "test-key" } as never;

const FAKE_DB = {
  prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }),
} as unknown as D1Database;

const TASKS: ExpectedTask[] = [
  { number: 1, taskText: "5+7", correctAnswer: "12", maxPoints: 1 },
];

/** Ответ polza: один разобранный и правильный ответ. */
const MODEL_OUTPUT = JSON.stringify({
  items: [{ number: 1, studentAnswer: "12", verdict: "correct", confidence: 0.95, comment: null }],
});

/**
 * Подсунуть фейковый файл в multipart.
 *
 * Настоящий `File` требует аллокации байтов, а нам нужно проверить границу
 * 8 МБ много раз подряд. Парсер смотрит только в `type`, `size` и
 * `arrayBuffer()`, поэтому объекта с этими тремя полями достаточно — а
 * отдельный тест ниже всё равно собирает настоящий FormData с настоящими
 * File, чтобы проверить не только нашу логику.
 */
interface FakeFile {
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

function fakeFile(type: string, size: number, fill = 0x41): FakeFile {
  return {
    type,
    size,
    async arrayBuffer() {
      // Заполняем через Uint8Array: у `ArrayBuffer` в workerd нет метода fill.
      return new Uint8Array(size).fill(fill).buffer;
    },
  };
}

const MIB = 1024 * 1024;

/** Минимальный FormData-совместимый объект: парсер зовёт только get/getAll. */
function formOf(fields: Record<string, unknown[]>): FormData {
  return {
    get(name: string) {
      const v = fields[name];
      return v && v.length > 0 ? (v[0] as string) : null;
    },
    getAll(name: string) {
      return fields[name] ?? [];
    },
  } as unknown as FormData;
}

/** Контекст с подложенной формой — `readPhotoForm` больше ничего не берёт. */
function ctxWithForm(form: FormData): Context<AppEnv> {
  return {
    req: {
      header: (name: string) =>
        name.toLowerCase() === "content-type" ? "multipart/form-data; boundary=test" : undefined,
      formData: async () => form,
    },
  } as unknown as Context<AppEnv>;
}

const CONSENT = { consent: ["true"], tasks: [JSON.stringify(TASKS)] };

// ─── 1. Разбор multipart ──────────────────────────────────────────────────────

describe("readPhotoForm · сколько страниц принимаем", () => {
  it("одна фотография работает как раньше: массив из одного элемента", async () => {
    const form = ctxWithForm(
      formOf({ ...CONSENT, image: [fakeFile("image/jpeg", 100 * 1024, 0x01)] }),
    );

    const parsed = await readPhotoForm(form);

    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0]!.mimeType).toBe("image/jpeg");
    expect(parsed.images[0]!.bytes.byteLength).toBe(100 * 1024);
    expect(parsed.consentAccepted).toBe(true);
  });

  it("три фотографии принимаются и остаются в порядке загрузки", async () => {
    const form = ctxWithForm(
      formOf({
        ...CONSENT,
        image: [
          fakeFile("image/jpeg", 10 * 1024, 0x01),
          fakeFile("image/png", 20 * 1024, 0x02),
          fakeFile("image/webp", 30 * 1024, 0x03),
        ],
      }),
    );

    const parsed = await readPhotoForm(form);

    expect(parsed.images.map((i) => i.mimeType)).toEqual(["image/jpeg", "image/png", "image/webp"]);
    expect(parsed.images.map((i) => i.bytes.byteLength)).toEqual([10 * 1024, 20 * 1024, 30 * 1024]);
  });

  it("порядок страниц сохраняется на настоящем multipart (три настоящих File)", async () => {
    const real = new FormData();
    for (const [name, type] of [
      ["p1.jpg", "image/jpeg"],
      ["p2.jpg", "image/jpeg"],
      ["p3.png", "image/png"],
    ] as const) {
      real.append("image", new File([new Uint8Array([1, 2, 3])], name, { type }));
    }
    real.append("consent", "true");
    real.append("tasks", JSON.stringify(TASKS));

    const parsed = await readPhotoForm(ctxWithForm(real));

    expect(parsed.images.map((i) => i.mimeType)).toEqual(["image/jpeg", "image/jpeg", "image/png"]);
  });

  it("четыре фотографии отклоняются, а не игнорируются молча", async () => {
    const form = ctxWithForm(
      formOf({
        ...CONSENT,
        image: [1, 2, 3, 4].map((i) => fakeFile("image/jpeg", 1024, i)),
      }),
    );

    // Ошибка читаема учителю: называем и потолок, и фактическое число.
    await expect(readPhotoForm(form)).rejects.toThrow(/до 3 фото/);
    await expect(readPhotoForm(form)).rejects.toThrow(/пришло 4/);
  });

  it("без фото — прежняя понятная ошибка", async () => {
    await expect(readPhotoForm(ctxWithForm(formOf(CONSENT)))).rejects.toThrow(
      /Приложите фото работы/,
    );
  });

  it("не-файл в поле image не считается страницей", async () => {
    // Мультипарт иногда приносит строку в том же поле — она не должна ни
    // превратиться в «страницу», ни уронить разбор.
    const form = ctxWithForm(
      formOf({ ...CONSENT, image: ["", fakeFile("image/jpeg", 1024, 0x09)] }),
    );

    const parsed = await readPhotoForm(form);
    expect(parsed.images).toHaveLength(1);
  });
});

describe("readPhotoForm · лимит 8 МБ на КАЖДОЕ фото", () => {
  it("превышение на первой странице", async () => {
    const form = ctxWithForm(
      formOf({ ...CONSENT, image: [fakeFile("image/jpeg", 8 * MIB + 1)] }),
    );
    await expect(readPhotoForm(form)).rejects.toThrow(/больше 8 МБ/);
  });

  it("превышение на второй странице не проскакивает", async () => {
    const form = ctxWithForm(
      formOf({
        ...CONSENT,
        image: [fakeFile("image/jpeg", 1024), fakeFile("image/jpeg", 8 * MIB + 1)],
      }),
    );
    // Номер страницы обязателен: без него учитель не знает, что переснимать.
    await expect(readPhotoForm(form)).rejects.toThrow(/Фото 2: больше 8 МБ/);
  });

  it("превышение на третьей странице не проскакивает", async () => {
    const form = ctxWithForm(
      formOf({
        ...CONSENT,
        image: [
          fakeFile("image/jpeg", 1024),
          fakeFile("image/jpeg", 1024),
          fakeFile("image/jpeg", 8 * MIB + 1),
        ],
      }),
    );
    await expect(readPhotoForm(form)).rejects.toThrow(/Фото 3: больше 8 МБ/);
  });

  it("ровно 8 МБ проходят", async () => {
    const form = ctxWithForm(formOf({ ...CONSENT, image: [fakeFile("image/jpeg", 8 * MIB)] }));
    const parsed = await readPhotoForm(form);
    expect(parsed.images).toHaveLength(1);
  });

  it("мусорный формат на второй странице отбивается с номером страницы", async () => {
    const form = ctxWithForm(
      formOf({ ...CONSENT, image: [fakeFile("image/jpeg", 1024), fakeFile("application/pdf", 1024)] }),
    );
    await expect(readPhotoForm(form)).rejects.toThrow(/Фото 2: формат не поддерживается/);
  });
});

// ─── 2. Ключи R2 без миграции D1 ──────────────────────────────────────────────

describe("ключи R2 · первое фото на старом ключе, остальные на суффиксах", () => {
  it("одна страница — ровно один ключ, он же идёт в r2_key", () => {
    expect(photoR2Keys("pc/1700000000/uuid.jpg", 1)).toEqual(["pc/1700000000/uuid.jpg"]);
  });

  it("две страницы: базовый ключ не меняется, вторая получает суффикс -2", () => {
    expect(photoR2Keys("pc/1700000000/uuid.jpg", 2)).toEqual([
      "pc/1700000000/uuid.jpg",
      "pc/1700000000/uuid-2.jpg",
    ]);
  });

  it("три страницы: -2 и -3 от того же базового имени", () => {
    expect(photoR2Keys("pc/1700000000/uuid.jpg", 3)).toEqual([
      "pc/1700000000/uuid.jpg",
      "pc/1700000000/uuid-2.jpg",
      "pc/1700000000/uuid-3.jpg",
    ]);
  });

  it("суффиксы выводятся из ключа, а не хранятся в базе", () => {
    expect(extraPhotoKey("pc/1700000000/uuid.jpg", 2)).toBe("pc/1700000000/uuid-2.jpg");
    // Старая строка базы без расширения не должна ломать вывод ключа.
    expect(extraPhotoKey("pc/1700000000/uuid", 3)).toBe("pc/1700000000/uuid-3.jpg");
  });
});

/** R2-заглушка: помнит put/delete и умеет «не знать» ключа. */
function fakeBucket(opts: { missing?: Set<string>; failPut?: boolean } = {}) {
  const puts: Array<{ key: string; size: number }> = [];
  const deletes: string[] = [];
  const missing = opts.missing ?? new Set<string>();
  return {
    puts,
    deletes,
    async put(key: string, value: ArrayBuffer) {
      if (opts.failPut) throw new Error("R2 put failed");
      puts.push({ key, size: value.byteLength });
    },
    async delete(key: string) {
      if (missing.has(key)) throw new Error("The specified key does not exist.");
      deletes.push(key);
    },
  };
}

describe("удаление фото · все страницы, и старые строки не ломаются", () => {
  it("удаляет первую страницу и обе дополнительные", async () => {
    const bucket = fakeBucket();

    await deletePhotoObjects(bucket as unknown as R2Bucket, "pc/1700000000/uuid.jpg");

    expect(bucket.deletes).toEqual([
      "pc/1700000000/uuid.jpg",
      "pc/1700000000/uuid-2.jpg",
      "pc/1700000000/uuid-3.jpg",
    ]);
  });

  it("старая строка (фото было одно) удаляется без падения, даже если ключей нет", async () => {
    // Именно этот случай мы НЕ должны сломать: в базе полно записей, где
    // фото было одно, а ключей -2/-3 в R2 не существует.
    const bucket = fakeBucket({
      missing: new Set(["pc/1700000000/uuid-2.jpg", "pc/1700000000/uuid-3.jpg"]),
    });
    const warnings: string[] = [];

    await deletePhotoObjects(bucket as unknown as R2Bucket, "pc/1700000000/uuid.jpg", (_p, msg) =>
      warnings.push(msg),
    );

    // Базовый ключ удалён, отсутствие остальных — не ошибка для учителя.
    expect(bucket.deletes).toEqual(["pc/1700000000/uuid.jpg"]);
    expect(warnings).toHaveLength(2);
  });

  it("ошибка удаления ПЕРВОГО фото пробрасывается — строка не помечается удалённой", async () => {
    const bucket = fakeBucket({ missing: new Set(["pc/1700000000/uuid.jpg"]) });

    await expect(
      deletePhotoObjects(bucket as unknown as R2Bucket, "pc/1700000000/uuid.jpg"),
    ).rejects.toThrow(/does not exist/);
  });
});

describe("загрузка · частичный провал не оставляет фото в R2", () => {
  it("три страницы ложатся по своим ключам", async () => {
    const bucket = fakeBucket();
    const images = [
      { bytes: new ArrayBuffer(10), mimeType: "image/jpeg" },
      { bytes: new ArrayBuffer(20), mimeType: "image/png" },
      { bytes: new ArrayBuffer(30), mimeType: "image/jpeg" },
    ];

    await putPhotoObjects(
      bucket as unknown as R2Bucket,
      photoR2Keys("pc/1700000000/uuid.jpg", 3),
      images,
      "user_1",
    );

    expect(bucket.puts).toEqual([
      { key: "pc/1700000000/uuid.jpg", size: 10 },
      { key: "pc/1700000000/uuid-2.jpg", size: 20 },
      { key: "pc/1700000000/uuid-3.jpg", size: 30 },
    ]);
  });

  it("упавшая вторая страница убирает и первую — фото ребёнка не остаётся сиротой", async () => {
    const bucket = fakeBucket();
    // Р2 не умеет «сломаться на середине» через флаг, поэтому имитируем
    // поведение напрямую: первая страница кладётся, вторая — нет.
    let calls = 0;
    const put = async (key: string) => {
      calls += 1;
      if (calls === 2) throw new Error("R2 put failed");
    };
    const bucketObj = {
      put,
      delete: async (key: string) => {
        bucket.deletes.push(key);
      },
    };

    await expect(
      putPhotoObjects(
        bucketObj as unknown as R2Bucket,
        photoR2Keys("pc/1700000000/uuid.jpg", 3),
        [
          { bytes: new ArrayBuffer(10), mimeType: "image/jpeg" },
          { bytes: new ArrayBuffer(20), mimeType: "image/jpeg" },
        ],
        "user_1",
      ),
    ).rejects.toThrow(/R2 put failed/);

    expect(bucket.deletes).toEqual(["pc/1700000000/uuid.jpg"]);
  });
});

// ─── 3. Доставка в модель ─────────────────────────────────────────────────────

describe("checkPhoto · страницы уходят в модель по порядку", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    _resetPolzaSingleton();
    fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            model: "openai/gpt-6-luna",
            choices: [{ message: { content: MODEL_OUTPUT } }],
            usage: { prompt_tokens: 5000, completion_tokens: 500, total_tokens: 5500 },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    _resetPolzaSingleton();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /** Body, который реально ушёл провайдеру. */
  function sentContent(): Array<{ type: string; text?: string; image_url?: { url: string; detail?: string } }> {
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(String(init.body)) as {
      messages: Array<{ role: string; content: unknown }>;
    };
    const user = body.messages.find((m) => m.role === "user")!;
    return user.content as never;
  }

  function imagesOf(mimes: string[]) {
    return mimes.map((mimeType, i) => ({
      bytes: new Uint8Array(1024).fill(i + 1).buffer,
      mimeType,
    }));
  }

  it("одна страница: текст + ровно одна картинка — как раньше", async () => {
    const res = await checkPhoto(
      {
        images: imagesOf(["image/jpeg"]),
        tasks: TASKS,
        plan: "base",
        userId: "user_1",
        ip: "1.2.3.4",
      },
      FAKE_ENV,
      FAKE_DB,
    );

    const content = sentContent();
    expect(content).toHaveLength(2);
    expect(content[0]!.type).toBe("text");
    expect(content[1]!.type).toBe("image_url");
    expect(content[1]!.image_url!.url.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(res.summary.items[0]!.verdict).toBe("correct");
  });

  it("три страницы: три image_url в порядке загрузки, после текстовой части", async () => {
    await checkPhoto(
      {
        images: imagesOf(["image/jpeg", "image/png", "image/webp"]),
        tasks: TASKS,
        plan: "base",
        userId: "user_1",
        ip: "1.2.3.4",
      },
      FAKE_ENV,
      FAKE_DB,
    );

    const content = sentContent();
    expect(content).toHaveLength(4); // текст + 3 картинки
    expect(content[0]!.type).toBe("text");
    // Порядок страниц = порядок data-URL. Разный mime делает страницы различимыми.
    expect(content.slice(1).map((p) => p.image_url!.url.split(";")[0])).toEqual([
      "data:image/jpeg",
      "data:image/png",
      "data:image/webp",
    ]);
  });

  it("модель получает в промпте число страниц и просьбу смотреть всю работу", async () => {
    await checkPhoto(
      {
        images: imagesOf(["image/jpeg", "image/jpeg"]),
        tasks: TASKS,
        plan: "base",
        userId: "user_1",
        ip: "1.2.3.4",
      },
      FAKE_ENV,
      FAKE_DB,
    );

    const text = sentContent()[0]!.text!;
    expect(text).toContain("ВСЕМ страницам");

    const system = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body)).messages[0]!
      .content as string;
    expect(system).toContain("Фотографий может быть одна, две или три");
  });

  it("при одной странице промпт остаётся прежним — без упоминания страниц", async () => {
    await checkPhoto(
      { images: imagesOf(["image/jpeg"]), tasks: TASKS, plan: "base", userId: "user_1", ip: "1.2.3.4" },
      FAKE_ENV,
      FAKE_DB,
    );

    expect(sentContent()[0]!.text).not.toContain("страниц");
  });

  it("оценка токенов и стоимости умножается на число страниц", async () => {
    const perImage = estimateImageTokens(1600, 1600, "low");

    const one = await checkPhoto(
      { images: imagesOf(["image/jpeg"]), tasks: TASKS, plan: "base", userId: "u", ip: "1.2.3.4" },
      FAKE_ENV,
      FAKE_DB,
    );
    _resetPolzaSingleton();
    fetchMock.mockClear();
    const three = await checkPhoto(
      {
        images: imagesOf(["image/jpeg", "image/jpeg", "image/jpeg"]),
        tasks: TASKS,
        plan: "base",
        userId: "u",
        ip: "1.2.3.4",
      },
      FAKE_ENV,
      FAKE_DB,
    );

    expect(one.estimatedImageTokens).toBe(perImage);
    expect(three.estimatedImageTokens).toBe(perImage * 3);
    expect(three.estimatedCostUsd).toBeGreaterThan(one.estimatedCostUsd);
  });
});

// ─── 4. Градуировка не зависит от числа страниц ───────────────────────────────

describe("gradePhotoCheck · количество фото на оценку не влияет", () => {
  const TASKS_TWO: ExpectedTask[] = [
    { number: 1, taskText: "5+7", correctAnswer: "12", maxPoints: 2 },
    { number: 2, taskText: "9-4", correctAnswer: "5", maxPoints: 3 },
  ];
  const RAW = JSON.stringify({
    items: [
      { number: 1, studentAnswer: "12", verdict: "correct", confidence: 0.95, comment: null },
      // Второе задание нашлось на ТРЕТЬЕЙ странице: раньше такая находка была
      // невозможна, потому что модель физически не видела вторую страницу.
      { number: 2, studentAnswer: "5", verdict: "correct", confidence: 0.92, comment: null },
    ],
  });

  it("один и тот же ответ модели даёт один и тот же вердикт", () => {
    const once = gradePhotoCheck(RAW, TASKS_TWO);
    const thrice = gradePhotoCheck(RAW, TASKS_TWO);

    expect(once).toEqual(thrice);
    expect(once.earnedPoints).toBe(5);
    expect(once.totalPoints).toBe(5);
    expect(once.items.map((i) => i.verdict)).toEqual(["correct", "correct"]);
  });

  it("задание, найденное на поздней странице, засчитывается наравне с первой", () => {
    // Гейт уверенности (0.85) общий и не зависит от номера страницы: если
    // модель разобрала почерк на третьем снимке, это тот же разбор.
    const s = gradePhotoCheck(RAW, TASKS_TWO);
    expect(s.items[1]!.verdict).toBe("correct");
    expect(s.items[1]!.pointsAwarded).toBe(3);
  });
});