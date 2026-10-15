/**
 * Стопка фотографий: до десяти страниц одной работы (ТЗ-11, этап 2).
 *
 * ЧТО ЗАКРЫВАЕМ ЭТИМ ФАЙЛОМ (лист 6.1.6):
 *
 *   1. ПОТОЛОК = ДЕСЯТЬ, ровно в одном месте кода. Раньше лимит стоял сразу в
 *      двух местах (`MAX_PHOTOS = 3` и список страниц `EXTRA_PHOTO_PAGES = [2, 3]`),
 *      и поднятие потолка в одном месте тихо оставило бы второе на трёх: страницы
 *      4–10 принялись бы, легли бы в бакет — и не показались бы учителю.
 *   2. ДОСЫЛКА СТРАНИЦ. Ученик отправил первую, вспомнил вторую — раньше он был
 *      вынужден начать проверку заново и потерять сделанное.
 *   3. ПОРЯДОК. Страница, досланная позже, должна стать ПОСЛЕДНЕЙ, а не первой:
 *      иначе модель читает работу задом наперёд и ставит отметки не туда.
 *   4. БЕЗ РЕГРЕССИИ. Одна страница ведёт себя ровно как раньше.
 *
 * ТЕСТЫ БЕЗ КЛЮЧА LLM: проверяется всё, что живёт ДО сетевого вызова — разбор
 * формы, ключи R2, подсчёт страниц и чтение их обратно. Сам вызов модели не
 * трогаем: платные прогоны в обычном `npm test` не входят (см. vitest.config.ts).
 *
 * R2 здесь настоящий (workerd-пул из vitest.config.ts), а не заглушка: считать
 * страницы мы будем по `head()` по-настоящему, иначе тест проверял бы нашу
 * заглушку вместо нашего кода.
 */

import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type { Context } from "hono";
import type { AppEnv } from "../../src/types";
import {
  MAX_PHOTOS,
  readPhotoForm,
  readPhotoPagesForm,
  photoR2Keys,
  extraPhotoKey,
  countPhotoPages,
  readPhotoPages,
  deletePhotoObjects,
} from "../../src/routes/f06";
import type { ExpectedTask } from "../../src/services/photoCheckGrading";

const TASKS: ExpectedTask[] = [{ number: 1, taskText: "5+7", correctAnswer: "12", maxPoints: 1 }];
const CONSENT = { consent: ["true"], tasks: [JSON.stringify(TASKS)] };

/** Файл-заглушка: парсер смотрит только в `type`, `size` и `arrayBuffer()`. */
function fakeFile(type: string, size: number, fill = 0x41): File {
  return {
    type,
    size,
    async arrayBuffer() {
      return new Uint8Array(size).fill(fill).buffer;
    },
  } as unknown as File;
}

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

function ctxWithForm(form: FormData): Context<AppEnv> {
  return {
    req: {
      header: (name: string) =>
        name.toLowerCase() === "content-type" ? "multipart/form-data; boundary=test" : undefined,
      formData: async () => form,
    },
  } as unknown as Context<AppEnv>;
}

/** Форма из `count` страниц с различимым содержимым — порядок потом проверим. */
function formWithPages(count: number, extra: Record<string, unknown[]> = {}): FormData {
  return formOf({
    ...CONSENT,
    ...extra,
    image: Array.from({ length: count }, (_, i) => fakeFile("image/jpeg", 1024, i + 1)),
  });
}

/** Уникальный базовый ключ на тест — иначе тесты делят одни и те же объекты. */
let keySeq = 0;
function freshKey(): string {
  keySeq += 1;
  return `pc/test/${Date.now()}-${keySeq}/uuid.jpg`;
}

/** Положить N страниц по правильным ключам (как это делает роут). */
async function putPages(
  bucket: R2Bucket,
  r2Key: string,
  count: number,
): Promise<void> {
  for (let page = 1; page <= count; page += 1) {
    const key = page === 1 ? r2Key : extraPhotoKey(r2Key, page);
    await bucket.put(key, new Uint8Array([page]).buffer, {
      httpMetadata: { contentType: "image/jpeg" },
    });
  }
}

// ─── 1. Потолок = десять, и он один ────────────────────────────────────────────

describe("потолок страниц", () => {
  it("лимит равен десяти", () => {
    expect(MAX_PHOTOS).toBe(10);
  });

  it("десять страниц принимаются", async () => {
    const parsed = await readPhotoForm(ctxWithForm(formWithPages(MAX_PHOTOS)));
    expect(parsed.images).toHaveLength(MAX_PHOTOS);
  });

  it("одиннадцатая страница отклоняется понятно: назван и потолок, и факт", async () => {
    const form = ctxWithForm(formWithPages(MAX_PHOTOS + 1));
    // Молчаливый отказ хуже отказа: учитель заплатил бы как за полную работу,
    // не зная, что страница не попала. Сообщение обязано называть оба числа.
    await expect(readPhotoForm(form)).rejects.toThrow(/до 10 фото/);
    await expect(readPhotoForm(form)).rejects.toThrow(/пришло 11/);
  });

  it("без фото — прежняя понятная ошибка", async () => {
    await expect(readPhotoForm(ctxWithForm(formOf(CONSENT)))).rejects.toThrow(
      /Приложите фото работы/,
    );
  });
});

// ─── 2. Порядок страниц ───────────────────────────────────────────────────────

describe("порядок страниц", () => {
  it("одна страница ведёт себя как раньше (регрессия)", async () => {
    const parsed = await readPhotoForm(ctxWithForm(formWithPages(1)));
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0]!.bytes.byteLength).toBe(1024);
    expect(parsed.consentAccepted).toBe(true);
  });

  it("десять страниц остаются в порядке загрузки", async () => {
    const parsed = await readPhotoForm(ctxWithForm(formWithPages(10)));

    // Каждая страница помечена своим байтом — по нему порядок и проверяем.
    expect(parsed.images.map((img) => new Uint8Array(img.bytes)[0])).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
  });

  it("порядок сохраняется на настоящем multipart из десяти настоящих File", async () => {
    const real = new FormData();
    for (let i = 1; i <= 10; i += 1) {
      real.append("image", new File([new Uint8Array([i])], `p${i}.jpg`, { type: "image/jpeg" }));
    }
    real.append("consent", "true");
    real.append("tasks", JSON.stringify(TASKS));

    const parsed = await readPhotoForm(ctxWithForm(real));

    expect(parsed.images).toHaveLength(10);
    expect(parsed.images.map((img) => new Uint8Array(img.bytes)[0])).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
  });

  it("лишнее в поле image не считается страницей", async () => {
    const form = formOf({
      ...CONSENT,
      image: ["", fakeFile("image/jpeg", 1024, 9)],
    });
    const parsed = await readPhotoForm(ctxWithForm(form));
    expect(parsed.images).toHaveLength(1);
  });
});

// ─── 3. Ключи R2: страницы 4–10 действительно получают место ───────────────────
//
// Это ровно та проверка, которая ломалась бы тихо: потолок подняли, а список
// страниц для ключей остался `[2, 3]` — и страницы 4–10 принялись бы, легли бы
// в бакет и не показались бы учителю нигде.

describe("ключи страниц в R2", () => {
  it("десять страниц получают базовый ключ и суффиксы -2…-10", () => {
    const keys = photoR2Keys("pc/1700000000/uuid.jpg", 10);

    expect(keys).toHaveLength(10);
    expect(keys[0]).toBe("pc/1700000000/uuid.jpg");
    expect(keys[9]).toBe("pc/1700000000/uuid-10.jpg");
    expect(new Set(keys).size).toBe(10); // страницы не наезжают друг на друга
  });

  it("ни одна страница не превышает потолок", () => {
    for (let count = 1; count <= MAX_PHOTOS; count += 1) {
      expect(photoR2Keys("pc/1/uuid.jpg", count)).toHaveLength(count);
    }
    // Больше потолка роут не пропускает, но и функция не должна «изобретать»
    // одиннадцатый ключ.
    expect(photoR2Keys("pc/1/uuid.jpg", MAX_PHOTOS + 1)).toHaveLength(MAX_PHOTOS);
  });

  it("суффиксы выводятся из ключа, а не хранятся в базе", () => {
    expect(extraPhotoKey("pc/1700000000/uuid.jpg", 7)).toBe("pc/1700000000/uuid-7.jpg");
    // Старая строка базы без расширения не должна ломать вывод ключа.
    expect(extraPhotoKey("pc/1700000000/uuid", 10)).toBe("pc/1700000000/uuid-10.jpg");
  });
});

// ─── 4. Сколько страниц в работе (настоящий R2) ───────────────────────────────

describe("сколько страниц в работе", () => {
  const bucket = (): R2Bucket => (env as unknown as { PDFS: R2Bucket }).PDFS;

  it("одна страница", async () => {
    const key = freshKey();
    await putPages(bucket(), key, 1);
    expect(await countPhotoPages(bucket(), key)).toBe(1);
  });

  it("десять страниц", async () => {
    const key = freshKey();
    await putPages(bucket(), key, 10);
    expect(await countPhotoPages(bucket(), key)).toBe(10);
  });

  it("нет ни одной страницы", async () => {
    expect(await countPhotoPages(bucket(), freshKey())).toBe(0);
  });

  it("считает НЕПРЕРЫВНО: дырка в середине обрывает работу", async () => {
    const key = freshKey();
    await putPages(bucket(), key, 3);
    // Пропали страницы 2 и 3, осталась только 4-я.
    await bucket().delete(extraPhotoKey(key, 2));
    await bucket().delete(extraPhotoKey(key, 3));

    // Ответ 1, а не 4: собирать проверку из несуществующей середины нельзя,
    // иначе модель получила бы работу не ту, которую прислали.
    expect(await countPhotoPages(bucket(), key)).toBe(1);
  });
});

// ─── 5. Досылка: новая страница продолжает нумерацию ──────────────────────────
//
// Требование «страница 2 не должна оказаться первой». Дослать можно ТОЛЬКО в
// конец: если бы новая страница занимала номер 1, она бы перезаписала первую
// страницу работы и учитель получил бы чужую работу вместо своей.

describe("досылка страниц к готовой работе", () => {
  const bucket = (): R2Bucket => (env as unknown as { PDFS: R2Bucket }).PDFS;

  /** Ровно то, что делает роут: дослать `added` страниц к `havePages`. */
  async function append(havePages: number, added: number): Promise<string[]> {
    const r2Key = freshKey();
    await putPages(bucket(), r2Key, havePages);

    const total = havePages + added;
    const allKeys = photoR2Keys(r2Key, total);
    const newKeys = allKeys.slice(havePages);

    for (const [i, key] of newKeys.entries()) {
      await bucket().put(key, new Uint8Array([havePages + i + 1]).buffer, {
        httpMetadata: { contentType: "image/jpeg" },
      });
    }
    return newKeys;
  }

  it("досланная страница получает следующий номер, а не первый", async () => {
    const newKeys = await append(3, 1);
    expect(newKeys).toHaveLength(1);
    expect(newKeys[0]).toMatch(/-4\.jpg$/);
  });

  it("после трёх страниц досылка двух даёт -4 и -5", async () => {
    const newKeys = await append(3, 2);
    expect(newKeys.map((k) => k.slice(k.lastIndexOf("/") + 1))).toEqual([
      "uuid-4.jpg",
      "uuid-5.jpg",
    ]);
  });

  it("досылка не трогает уже загруженные страницы", async () => {
    const r2Key = freshKey();
    await putPages(bucket(), r2Key, 3);
    const before = await readPhotoPages(bucket(), r2Key, 3);

    const total = 5;
    const newKeys = photoR2Keys(r2Key, total).slice(3);
    for (const [i, key] of newKeys.entries()) {
      await bucket().put(key, new Uint8Array([4 + i]).buffer, {
        httpMetadata: { contentType: "image/jpeg" },
      });
    }

    const after = await readPhotoPages(bucket(), r2Key, 5);

    // Первые три страницы — байт в байт те же самые.
    expect(after.slice(0, 3).map((img) => new Uint8Array(img.bytes)[0])).toEqual(
      before.map((img) => new Uint8Array(img.bytes)[0]),
    );
    // И весь порядок после досылки — 1,2,3,4,5.
    expect(after.map((img) => new Uint8Array(img.bytes)[0])).toEqual([1, 2, 3, 4, 5]);
  });

  it("работа из десяти страниц читается целиком и по порядку", async () => {
    const r2Key = freshKey();
    await putPages(bucket(), r2Key, 10);

    const images = await readPhotoPages(bucket(), r2Key, 10);

    expect(images).toHaveLength(10);
    expect(images.map((img) => new Uint8Array(img.bytes)[0])).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
  });

  it("нехватка страницы в середине — понятная ошибка, а не молчаливая сборка", async () => {
    const r2Key = freshKey();
    await putPages(bucket(), r2Key, 3);
    await bucket().delete(extraPhotoKey(r2Key, 2));

    // Честный отказ: подставить пустую страницу — значит соврать модели о том,
    // какую работу она проверяет.
    await expect(readPhotoPages(bucket(), r2Key, 3)).rejects.toThrow(/Страница 2/);
  });
});

// ─── 6. Удаление: все десять страниц, а не только первые три ───────────────────

describe("удаление фото", () => {
  const bucket = (): R2Bucket => (env as unknown as { PDFS: R2Bucket }).PDFS;

  it("удаляет все десять страниц работы", async () => {
    const r2Key = freshKey();
    await putPages(bucket(), r2Key, 10);

    await deletePhotoObjects(bucket(), r2Key);

    // В бакете не должно остаться ни одной страницы этой работы.
    expect(await countPhotoPages(bucket(), r2Key)).toBe(0);
    await expect(bucket().head(extraPhotoKey(r2Key, 10))).resolves.toBeNull();
  });

  it("старая строка (фото было одно) удаляется без падения", async () => {
    const r2Key = freshKey();
    await putPages(bucket(), r2Key, 1);
    const warnings: string[] = [];

    await deletePhotoObjects(bucket(), r2Key, (_page, msg) => warnings.push(msg));

    // Настоящий R2 на отсутствующий объект отвечает УСПЕХОМ, поэтому
    // предупреждений здесь нет. Проверяем то, что важно учителю: работа
    // удалилась целиком и ручка не упала на несуществующих ключах -2…-10.
    expect(warnings).toHaveLength(0);
    expect(await countPhotoPages(bucket(), r2Key)).toBe(0);
  });

  it("ошибка удаления ПЕРВОЙ страницы пробрасывается — работа не считается удалённой", async () => {
    // Настоящий R2 не умеет «сломаться», поэтому подменяем бакет заглушкой,
    // которая падает на первом ключе: именно этот случай обязан поднимать
    // ошибку наружу, иначе строка помечется удалённой, а фото останется.
    const r2Key = freshKey();
    const failing = {
      delete: async (key: string) => {
        if (key === r2Key) throw new Error("The specified key does not exist.");
      },
    } as unknown as R2Bucket;

    await expect(deletePhotoObjects(failing, r2Key)).rejects.toThrow(/does not exist/);
  });
});

// ─── 7. Форма досылки: согласие и эталоны второй раз не спрашиваются ───────────

describe("разбор формы досылки", () => {
  it("принимает страницы без повторного согласия", async () => {
    const form = formOf({ image: [fakeFile("image/jpeg", 1024, 5)] });
    const parsed = await readPhotoPagesForm(ctxWithForm(form));

    expect(parsed.images).toHaveLength(1);
    expect(parsed.tasks).toBeNull(); // эталоны возьмём из уже разобранных заданий
  });

  it("эталоны из тела, если их прислали", async () => {
    const form = formOf({
      image: [fakeFile("image/jpeg", 1024, 5)],
      tasks: [JSON.stringify(TASKS)],
    });
    const parsed = await readPhotoPagesForm(ctxWithForm(form));
    expect(parsed.tasks).toHaveLength(1);
  });

  it("битые эталоны отбиваются, а не едут в модель строкой", async () => {
    const form = formOf({ image: [fakeFile("image/jpeg", 1024)], tasks: ["{не json"] });
    await expect(readPhotoPagesForm(ctxWithForm(form))).rejects.toThrow(/корректным JSON/);
  });

  it("ошибка второй досланной страницы называет её номер", async () => {
    // У работы уже есть страницы — номер в ошибке должен быть НЕ «2», а «2».
    // (при offset = 1 это страница 2 работы, а не вторая в этом запросе)
    const form = formOf({
      image: [fakeFile("image/jpeg", 1024), fakeFile("application/pdf", 1024)],
    });
    await expect(readPhotoPagesForm(ctxWithForm(form))).rejects.toThrow(/Фото 2: формат/);
  });
});