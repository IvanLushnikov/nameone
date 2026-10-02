/**
 * Клиентское сжатие фото перед проверкой (TZ-11 §4.5, шаг 4 сценария §3).
 *
 * ЗАЧЕМ ЭТО НУЖНО (это не «для красоты», а про деньги):
 *   Vision-модель тарифицирует картинку как входные токены. Снимок с телефона
 *   4000×3000 — это в разы больше токенов, чем 1600px. Сжатие до длинной
 *   стороны 1600px и JPEG q0.8 уменьшает и image-токены, и тело запроса,
 *   а на распознавание рукописного ответа это почти не влияет.
 *
 * Экономия: грубо в 3-4 раза по image-токенам. При COGS ~0,05 ₽ за проверку
 * это копейки, но при 100 проверках в месяц на тарифе «Базовый» — уже видно
 * в юнит-экономике, и главное — в скорости: меньше байт = быстрее загрузка.
 */

/** Длинная сторона после сжатия. Совпадает с оценкой в ТЗ §5.1. */
export const MAX_DIMENSION = 1600;

/** Качество JPEG. Ниже 0.8 рукописный разбор начинает страдать. */
export const JPEG_QUALITY = 0.8;

/** Форматы, которые пропускаем на сервер без перерисовки. */
const PASSTHROUGH = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * Сжать фото под лимиты проверки.
 *
 * Возвращает Blob, который можно сразу положить в FormData. Если сжать не
 * получилось (браузер не даёт canvas, картинка битая) — отдаём исходник как есть:
 * сервер всё равно проверит тип и размер и скажет понятную ошибку.
 */
export async function compressImage(
  file: Blob,
  opts: { maxDimension?: number; quality?: number } = {},
): Promise<Blob> {
  const maxDimension = opts.maxDimension ?? MAX_DIMENSION;
  const quality = opts.quality ?? JPEG_QUALITY;

  // Некоторые форматы перерисовывать нечем и не нужно.
  if (PASSTHROUGH.has(file.type) && file.size <= 900 * 1024) {
    return file;
  }

  if (typeof document === "undefined") {
    return file; // SSR: canvas недоступен, отдаём как есть
  }

  try {
    const bitmap = await loadBitmap(file);
    const { width, height } = bitmap;
    if (!width || !height) return file;

    const scale = Math.min(1, maxDimension / Math.max(width, height));
    // Не увеличиваем маленькие картинки — апскейл не добавит деталей.
    if (scale >= 1 && PASSTHROUGH.has(file.type)) return file;

    const targetW = Math.max(1, Math.round(width * scale));
    const targetH = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap as CanvasImageSource, 0, 0, targetW, targetH);
    closeIfPossible(bitmap);

    const blob = await canvasToBlob(canvas, "image/jpeg", quality);
    // Если сжатие вдруг дало БОЛЬШЕ, чем оригинал — не выигрываем, отдаём исходник.
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), type, quality);
  });
}

/** createImageBitmap там, где есть; иначе — старый <img>-путь. */
async function loadBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      /* падаем на <img> */
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Не удалось прочитать изображение"));
    };
    img.src = url;
  });
}

function closeIfPossible(bitmap: ImageBitmap | HTMLImageElement): void {
  if (typeof ImageBitmap !== "undefined" && bitmap instanceof ImageBitmap) {
    bitmap.close();
  }
}

/** Человекочитаемый размер файла — для подписи под превью. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}
