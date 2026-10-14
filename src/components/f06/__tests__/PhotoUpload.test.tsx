/**
 * Загрузчик страниц работы: сколько страниц, в каком порядке и что делает
 * учитель, если страниц больше трёх.
 *
 * Проверяем то, что ломает саму проверку, а не разметку:
 *  1. три файла дают три превью, и порядок превью = порядок выбора;
 *  2. четвёртая страница НЕ уезжает молча — учитель видит объяснение
 *     (сервер её всё равно не примет, а учитель заплатил бы за полную работу);
 *  3. удаление лишней страницы оставляет остальные и перенумеровывает их.
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PhotoUpload, MAX_PAGES } from "../PhotoUpload";

// Сжатие через canvas в jsdom не работает — подменяем на no-op, чтобы тест
// был про страницы, а не про пиксели.
vi.mock("@/lib/utils/image", () => ({
  compressImage: async (blob: Blob) => blob,
  formatBytes: () => "120 КБ",
}));

beforeAll(() => {
  // jsdom не умеет object URL, а без него превью не отрисовать.
  if (!URL.createObjectURL) URL.createObjectURL = () => "blob:preview";
  if (!URL.revokeObjectURL) URL.revokeObjectURL = () => undefined;
});

function jpg(name: string): File {
  return new File(["x"], name, { type: "image/jpeg" });
}

/** Контролируемый загрузчик: файлы живут в состоянии, как в панели. */
function Harness({ onFiles }: { onFiles?: (files: File[]) => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [consent, setConsent] = useState(false);
  return (
    <PhotoUpload
      files={files}
      onFilesChange={(next) => {
        setFiles(next);
        onFiles?.(next);
      }}
      consentAccepted={consent}
      onConsentChange={setConsent}
    />
  );
}

/**
 * Подать файлы в тот input, который сейчас на экране: после первого выбора
 * он переезжает из зоны загрузки в блок «Добавить страницу», поэтому ищем
 * каждый раз заново, а не держим ссылку.
 */
function pick(container: HTMLElement, names: string[]) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: names.map((n) => jpg(n)) } });
}

describe("Несколько страниц работы", () => {
  it("три файла дают три превью, и их порядок = порядок выбора", async () => {
    const onFiles = vi.fn();
    const { container } = render(<Harness onFiles={onFiles} />);

    pick(container, ["page-1.jpg", "page-2.jpg", "page-3.jpg"]);
    await waitFor(() => expect(screen.getByText(/page-3\.jpg/)).toBeInTheDocument());

    expect(screen.getAllByTestId("photo-page")).toHaveLength(3);
    expect(screen.getByAltText("Превью страницы 1")).toBeInTheDocument();
    expect(screen.getByAltText("Превью страницы 3")).toBeInTheDocument();
    expect(screen.getByText("Страница 1")).toBeInTheDocument();
    expect(screen.getByText("Страница 3")).toBeInTheDocument();

    // Порядок страниц работы — не деталь реализации, а контракт с моделью.
    const lastCall = onFiles.mock.calls.at(-1)?.[0] as File[];
    expect(lastCall.map((f) => f.name)).toEqual([
      "page-1.jpg",
      "page-2.jpg",
      "page-3.jpg",
    ]);
  });

  it(`${MAX_PAGES + 1}-й файл из того же выбора не теряется молча`, async () => {
    const onFiles = vi.fn();
    const { container } = render(<Harness onFiles={onFiles} />);

    // Учитель выбрал больше страниц разом, чем сервер разберёт, — самый частый
    // способ уйти за предел. Потолок берём из компонента: раньше здесь стояло
    // число 3, и тест молча учил неправильному потолку, пока сервер не
    // подняли до 10.
    const picked = Array.from({ length: MAX_PAGES + 1 }, (_, i) => `page-${i + 1}.jpg`);
    pick(container, picked);
    await waitFor(() =>
      expect(screen.getByText(new RegExp(`page-${MAX_PAGES}\\.jpg`))).toBeInTheDocument(),
    );

    expect(await screen.findByText(/не поедут/)).toBeInTheDocument();
    expect(screen.getAllByTestId("photo-page")).toHaveLength(MAX_PAGES);
    expect(screen.queryByText(new RegExp(`page-${MAX_PAGES + 1}\\.jpg`))).not.toBeInTheDocument();
    expect((onFiles.mock.calls.at(-1)?.[0] as File[]).length).toBe(MAX_PAGES);
  });

  it("файл сверх потолка, добавленный вторым выбором, тоже объясняется", async () => {
    const onFiles = vi.fn();
    const { container } = render(<Harness onFiles={onFiles} />);

    // Сначала добираем до потолка, потом пробуем добавить ещё один — молчать
    // об отказе нельзя: учитель поймёт, что файл потерялся, только по факту.
    const first = Array.from({ length: MAX_PAGES }, (_, i) => `page-${i + 1}.jpg`);
    pick(container, first);
    await waitFor(() =>
      expect(screen.getByText(new RegExp(`page-${MAX_PAGES}\\.jpg`))).toBeInTheDocument(),
    );

    pick(container, ["page-extra.jpg"]);

    expect(await screen.findByText(/не поедут/)).toBeInTheDocument();
    expect(screen.getAllByTestId("photo-page")).toHaveLength(MAX_PAGES);
    expect((onFiles.mock.calls.at(-1)?.[0] as File[]).length).toBe(MAX_PAGES);
  });

  it("удаление страницы оставляет остальные и перенумеровывает их", async () => {
    const onFiles = vi.fn();
    const { container } = render(<Harness onFiles={onFiles} />);

    pick(container, ["page-1.jpg", "page-2.jpg", "page-3.jpg"]);
    await waitFor(() => expect(screen.getByText(/page-3\.jpg/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Удалить страницу 2" }));

    expect(screen.queryByText(/page-2\.jpg/)).not.toBeInTheDocument();
    expect(screen.getAllByTestId("photo-page")).toHaveLength(2);
    expect(screen.getByText(/page-1\.jpg/)).toBeInTheDocument();
    // Бывшая третья страница стала второй — порядок работы не поехал.
    expect(screen.getByAltText("Превью страницы 2")).toBeInTheDocument();
    expect((onFiles.mock.calls.at(-1)?.[0] as File[]).map((f) => f.name)).toEqual([
      "page-1.jpg",
      "page-3.jpg",
    ]);
  });

  it("плохой файл не сбрасывает хорошие", async () => {
    const onFiles = vi.fn();
    const { container } = render(<Harness onFiles={onFiles} />);

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: {
        files: [
          jpg("page-1.jpg"),
          new File(["x"], "notes.pdf", { type: "application/pdf" }),
        ],
      },
    });

    // Причина называет конкретный файл: «что-то не так» учитель не разберётся.
    expect(await screen.findByText(/notes\.pdf/)).toBeInTheDocument();
    expect(screen.getAllByTestId("photo-page")).toHaveLength(1);
    expect(screen.getByText(/page-1\.jpg/)).toBeInTheDocument();
  });
});