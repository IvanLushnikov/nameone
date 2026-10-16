/**
 * ТЗ-28, фронт: пункты приёмки, которые шли без покрытия.
 *
 * Список соответствует разделу 9 ТЗ-28:
 *   7  «Ссылка для класса»: кнопка «Скопировать» и QR ведут на ОДИН код;
 *   8  фото длиннее 2000 px сжимается на клиенте;
 *   9  при обрыве связи фото не теряется — есть «повторить», и он срабатывает
 *      после восстановления сети;
 *   11 страница ставится на домашний экран: manifest, иконки 192/512, standalone;
 *   14 инструкция установки — ОТДЕЛЬНО для iOS и для Android;
 *   15 неотправленный ответ предлагается восстановить ОДНОЙ кнопкой;
 *   (заодно — второй снимок заменяет первый).
 *
 * Что здесь НЕ мокается и почему: сжатие идёт через настоящий код
 * `compressPhoto`, потому что смысл требования «сжимается на клиенте» — в том,
 * что длинная сторона действительно уменьшается ДО отправки. Подменяются только
 * те кухонные приборы, которых в jsdom нет по определению: `createImageBitmap`
 * и `canvas.toBlob`. Оба записывают, до каких размеров дошла обработка.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import fs from "node:fs";
import path from "node:path";

const mocks = vi.hoisted(() => ({
  loadClass: vi.fn(),
  loginByName: vi.fn(),
  loadCodeForm: vi.fn(),
  submitCodeForm: vi.fn(),
  uploadTaskPhoto: vi.fn(),
}));

vi.mock("@/components/student/api", () => ({
  loadClass: mocks.loadClass,
  loginByName: mocks.loginByName,
  loadCodeForm: mocks.loadCodeForm,
  submitCodeForm: mocks.submitCodeForm,
  uploadTaskPhoto: mocks.uploadTaskPhoto,
}));

// QR рисуется как набор path'ей, и что именно он закодировал, из SVG не прочтешь.
// Поэтому библиотеку подменяем: тест проверяет важное — блок отдал QR и буферу
// ОДНУ и ту же строку. Расхождение этих двух источников и есть тот дефект,
// который закрывает критерий «обе ведут на один и тот же код».
vi.mock("qrcode.react", () => ({
  QRCodeSVG: (props: { value: string }) => (
    <svg data-testid="class-qr" data-value={props.value} role="img" />
  ),
}));

import { StudentClassPage } from "@/components/student/StudentClassPage";
import { PhotoCapture } from "@/components/student/PhotoCapture";
import { FormRunner } from "@/app/form/FormRunner";
import { ClassLinkBlock } from "@/components/lk/ClassLinkBlock";
import { compressPhoto, PHOTO_MAX_EDGE } from "@/components/student/photo";
import { DRAFT_PREFIX, saveDraft } from "@/components/student/draft";

const CODE = "K7P2QM";

const WITH_TASKS = {
  ok: true as const,
  needName: false as const,
  className: "5А",
  studentName: "Петрова Аня",
  tasks: [
    {
      token: "form-token-1",
      title: "Дроби",
      subject: "Математика",
      grade: 5,
      open: true,
      answered: false,
      answeredAt: null,
      scoreTotal: null,
      scoreMax: null,
    },
  ],
};

/** Ответ сервера «работа открылась» — минимальный, как ждёт FormRunner. */
const CODE_FORM = {
  ok: true as const,
  form: {
    title: "Дроби",
    subject: "Математика",
    grade: 5,
    tasks: [
      { number: 1, text: "2+2", type: "computation", points: 2 },
      { number: 2, text: "Реши уравнение", type: "essay", points: 3 },
    ],
  },
};

function setSearch(search: string) {
  window.history.replaceState({}, "", `/${search}`);
}

function setUserAgent(ua: string) {
  Object.defineProperty(window.navigator, "userAgent", { value: ua, configurable: true });
}

/**
 * Подменить графику браузера.
 *
 * jsdom не умеет ни декодировать картинку, ни отдавать её в Blob. Стабы
 * возвращают картинку заданного размера и ЗАПИСЫВАЮТ, до каких размеров код
 * дошёл: это и есть проверка «длинная сторона уменьшилась на телефоне».
 */
function stubImage(bitmapWidth: number, bitmapHeight: number) {
  const drawn: Array<{ width: number; height: number }> = [];
  const g = globalThis as unknown as Record<string, unknown>;

  g.createImageBitmap = async () => ({
    width: bitmapWidth,
    height: bitmapHeight,
    close: () => {},
  });

  const realCreate = document.createElement.bind(document);
  const spy = vi.spyOn(document, "createElement").mockImplementation(
    (tag: string, options?: ElementCreationOptions) => {
      const el = realCreate(tag, options);
      if (String(tag).toLowerCase() === "canvas") {
        const canvas = el as unknown as HTMLCanvasElement;
        // getContext перегружен десятком сигнатур (2d, webgl, bitmaprenderer),
        // поэтому подменяем его через unknown — снимок интересует один ctx.
        (canvas as unknown as Record<string, unknown>).getContext = () => ({ drawImage: () => {} });
        canvas.toBlob = (cb: (b: Blob | null) => void, type?: string) => {
          drawn.push({ width: canvas.width, height: canvas.height });
          cb(new Blob(["jpeg-bytes"], { type: type ?? "image/jpeg" }));
        };
      }
      return el;
    },
  );

  return {
    drawn,
    restore: () => {
      spy.mockRestore();
      delete g.createImageBitmap;
    },
  };
}

beforeEach(() => {
  window.localStorage.clear();
  mocks.loadClass.mockReset();
  mocks.loginByName.mockReset();
  mocks.loadCodeForm.mockReset();
  mocks.submitCodeForm.mockReset();
  mocks.uploadTaskPhoto.mockReset();
  setSearch("");
  setUserAgent("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile");
});

afterEach(() => {
  cleanup();
});

// ─── Пункт 9: обрыв связи ───────────────────────────────────────────────────
describe("ТЗ-28 п.9: фото не теряется при обрыве связи", () => {
  it("снимок переживает неудачную отправку и уходит по кнопке «Повторить»", async () => {
    const user = userEvent.setup();
    const blobs: Blob[] = [];
    const onUpload = vi.fn(async (_n: number, blob: Blob) => {
      blobs.push(blob);
      return { ok: false as const };
    });

    render(<PhotoCapture taskNumber={1} uploaded={false} onUpload={onUpload} />);
    await user.upload(
      screen.getByTestId("photo-input-1"),
      new File(["first"], "page.jpg", { type: "image/jpeg" }),
    );

    // Главное: после неудачи снимок не выброшен — блок «повторить» на месте.
    expect(screen.getByTestId("photo-failed-1")).toBeInTheDocument();
    expect(screen.getByTestId("photo-retry-1")).toBeInTheDocument();
    expect(onUpload).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId("photo-retry-1"));
    expect(onUpload).toHaveBeenCalledTimes(2);
    // Повтор — тот же самый снимок, а не «сфотографируйте заново».
    expect(blobs[1]).toBe(blobs[0]);
  });

  it("после восстановления сети отправка идёт сама, без нажатия", async () => {
    const onUpload = vi.fn(async () => ({ ok: false as const }) as const);
    render(<PhotoCapture taskNumber={1} uploaded={false} onUpload={onUpload} />);

    await userEvent.setup().upload(
      screen.getByTestId("photo-input-1"),
      new File(["first"], "page.jpg", { type: "image/jpeg" }),
    );
    expect(onUpload).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("online"));
    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(2));
  });

  it("удачная отправка убирает «повторить»: повторять нечего", async () => {
    const onUpload = vi.fn(async () => ({ ok: true as const, photoR2Key: "student/xx/1.jpg" }));
    render(<PhotoCapture taskNumber={1} uploaded={false} onUpload={onUpload} />);

    await userEvent.setup().upload(
      screen.getByTestId("photo-input-1"),
      new File(["first"], "page.jpg", { type: "image/jpeg" }),
    );
    await waitFor(() => expect(screen.queryByTestId("photo-retry-1")).not.toBeInTheDocument());
  });

  it("второй снимок заменяет первый, а не копится рядом", async () => {
    const user = userEvent.setup();
    mocks.loadCodeForm.mockResolvedValue(CODE_FORM);
    mocks.uploadTaskPhoto
      .mockResolvedValueOnce({ ok: true, photoR2Key: "student/xx/1-first.jpg" })
      .mockResolvedValueOnce({ ok: true, photoR2Key: "student/xx/1-second.jpg" });

    setSearch(`?t=form-token-1&c=${CODE}`);
    render(<FormRunner />);
    await waitFor(() => expect(screen.getByTestId("form-tasks")).toBeInTheDocument());

    const input = () => screen.getByTestId("photo-input-1");
    await user.upload(input(), new File(["a"], "a.jpg", { type: "image/jpeg" }));
    await waitFor(() => expect(screen.getByTestId("photo-button-1")).toHaveTextContent("Переснять фото"));

    await user.upload(input(), new File(["b"], "b.jpg", { type: "image/jpeg" }));
    await waitFor(() => {
      const draft = JSON.parse(window.localStorage.getItem(`${DRAFT_PREFIX}:${CODE}`) ?? "{}");
      expect(draft.photos).toEqual({ "1": "student/xx/1-second.jpg" });
    });
    // Одно фото на задание: загрузок было две, в черновике осталось одно.
    expect(mocks.uploadTaskPhoto).toHaveBeenCalledTimes(2);
  });
});

// ─── Пункт 8: сжатие на телефоне ────────────────────────────────────────────
describe("ТЗ-28 п.8: фото длиннее 2000 px сжимается на клиенте", () => {
  it("снимок 3000×1500 уменьшается по длинной стороне и уходит в JPEG", async () => {
    const img = stubImage(3000, 1500);
    try {
      const out = await compressPhoto(new File(["x"], "big.jpg", { type: "image/jpeg" }));
      expect(out, "сжатие обязано вернуть файл, а не «сдайте как есть»").not.toBeNull();
      expect(out!.type).toBe("image/jpeg");
      expect(img.drawn).toHaveLength(1);
      expect(Math.max(img.drawn[0]!.width, img.drawn[0]!.height)).toBeLessThanOrEqual(2000);
      // Пропорции сохранились — иначе модель прочитает вытянутую картинку.
      expect(img.drawn[0]!.width / img.drawn[0]!.height).toBeCloseTo(2, 1);
    } finally {
      img.restore();
    }
  });

  it("небольшой снимок не растягивается и не мельчится", async () => {
    const img = stubImage(1200, 900);
    try {
      await compressPhoto(new File(["x"], "small.jpg", { type: "image/jpeg" }));
      expect(img.drawn[0]).toEqual({ width: 1200, height: 900 });
      expect(PHOTO_MAX_EDGE).toBeLessThanOrEqual(2000);
    } finally {
      img.restore();
    }
  });

  it("если сжать не вышло — отправляем исходник, а не показываем ошибку", async () => {
    const out = await compressPhoto(new File(["x"], "big.jpg", { type: "image/jpeg" }));
    expect(out, "без графики код обязан деградировать до null").toBeNull();
  });
});

// ─── Пункт 7: ссылка на класс ───────────────────────────────────────────────
describe("ТЗ-28 п.7: ссылка и QR ведут на один код", () => {
  it("буфер обмена и QR получают один и тот же адрес с кодом", async () => {
    const user = userEvent.setup();
    render(<ClassLinkBlock code={CODE} className="5А" />);
    const shown = screen.getByTestId("class-link-url").textContent ?? "";
    const qr = screen.getByTestId("class-qr").getAttribute("data-value") ?? "";

    expect(shown).toContain(`/k?c=${CODE}`);
    expect(qr, "QR и надпись обязаны быть из одного источника").toBe(shown);

    // Ставим стаб буфера ПОСЛЕ setup(): userEvent подменяет clipboard своим
    // стабом на старте, и его readText в jsdom падает на чтении Blob.
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await user.click(screen.getByTestId("class-link-copy"));
    expect(writeText).toHaveBeenCalledWith(shown);
  });

  it("класса без кода блок не рисует: копировать нечего", () => {
    render(<ClassLinkBlock code={null} className="5А" />);
    expect(screen.queryByTestId("class-link-block")).not.toBeInTheDocument();
  });
});

// ─── Пункт 11: установка на домашний экран ──────────────────────────────────
describe("ТЗ-28 п.11 и п.14: установка на домашний экран", () => {
  it("в манифесте standalone и иконки 192 и 512, и файлы на месте", () => {
    const manifestPath = path.resolve(process.cwd(), "public/manifest.webmanifest");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      display: string;
      icons: Array<{ src: string; sizes: string }>;
    };
    expect(manifest.display, "без standalone значок откроется в браузере").toBe("standalone");
    const sizes = manifest.icons.map((i) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    for (const icon of manifest.icons) {
      expect(fs.existsSync(path.resolve(process.cwd(), "public", icon.src.replace(/^\//u, ""))), icon.src).toBe(true);
    }
  });

  it("на iPhone инструкция есть — раньше подсказка пряталась именно там", async () => {
    setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1");
    setSearch(`?c=${CODE}`);
    mocks.loadClass.mockResolvedValue(WITH_TASKS);
    render(<StudentClassPage />);

    await waitFor(() => expect(screen.getByTestId("install-hint")).toBeInTheDocument());
    expect(screen.getByTestId("install-ios")).toHaveTextContent("Поделиться");
    expect(screen.getByTestId("install-ios")).toHaveTextContent("Домой");
  });

  it("на Android есть своя строка и настоящая кнопка установки", async () => {
    const user = userEvent.setup();
    setSearch(`?c=${CODE}`);
    mocks.loadClass.mockResolvedValue(WITH_TASKS);
    render(<StudentClassPage />);

    await waitFor(() => expect(screen.getByTestId("install-android")).toBeInTheDocument());
    expect(screen.getByTestId("install-android")).toHaveTextContent("Установить приложение");
    // До `beforeinstallprompt` кнопки нет — браузер ещё не предложил.
    expect(screen.queryByTestId("install-button")).not.toBeInTheDocument();

    const prompt = vi.fn(async () => {});
    const event = new Event("beforeinstallprompt");
    (event as unknown as { prompt: () => Promise<void> }).prompt = prompt;
    window.dispatchEvent(event);

    await waitFor(() => expect(screen.getByTestId("install-button")).toBeInTheDocument());
    await user.click(screen.getByTestId("install-button"));
    expect(prompt).toHaveBeenCalled();
  });

  it("уже установленное приложение подсказку не показывает", async () => {
    setSearch(`?c=${CODE}`);
    mocks.loadClass.mockResolvedValue(WITH_TASKS);
    const real = window.matchMedia;
    window.matchMedia = ((query: string) =>
      ({
        matches: query.includes("standalone"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
        onchange: null,
      }) as unknown as MediaQueryList) as typeof window.matchMedia;

    try {
      render(<StudentClassPage />);
      await waitFor(() => expect(screen.getByTestId("class-tasks")).toBeInTheDocument());
      expect(screen.queryByTestId("install-hint")).not.toBeInTheDocument();
    } finally {
      window.matchMedia = real;
    }
  });
});

// ─── Пункт 15: восстановление черновика одной кнопкой ───────────────────────
describe("ТЗ-28 п.15: черновик восстанавливается одной кнопкой", () => {
  it("при черновике сверху заданий одна кнопка «Восстановить» — и она ведёт на работу", async () => {
    setSearch(`?c=${CODE}`);
    mocks.loadClass.mockResolvedValue(WITH_TASKS);
    saveDraft({ code: CODE, studentName: "Петрова Аня", answers: { "1": "4" }, photos: {}, updatedAt: 1 });
    render(<StudentClassPage />);

    await waitFor(() => expect(screen.getByTestId("class-draft")).toBeInTheDocument());
    const block = screen.getByTestId("class-draft");
    const buttons = block.querySelectorAll("button");
    expect(buttons, "одна кнопка, без объяснений").toHaveLength(1);
    expect(buttons[0]!.textContent).toBe("Восстановить");

    const link = block.querySelector("a");
    const href = link?.getAttribute("href") ?? "";
    expect(href).toContain("t=form-token-1");
    expect(href).toContain(`c=${CODE}`);
  });

  it("без черновика блока восстановления нет", async () => {
    setSearch(`?c=${CODE}`);
    mocks.loadClass.mockResolvedValue(WITH_TASKS);
    render(<StudentClassPage />);

    await waitFor(() => expect(screen.getByTestId("class-tasks")).toBeInTheDocument());
    expect(screen.queryByTestId("class-draft")).not.toBeInTheDocument();
  });
});