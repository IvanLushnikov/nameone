/**
 * Подготовка фотографии тетради на телефоне ученика (TZ-28).
 *
 * ─── Зачем сжимать на устройстве, а не на сервере ───
 * Снимок с камеры телефона весит 3–5 МБ. По мобильному интернету в классе это
 * почти всегда минута ожидания или обрыв на середине — ученик нажимает ещё раз
 * и уходит с урока. Сжатие до 1600 px по длинной стороне даёт 150–400 КБ, то
 * есть в 10–20 раз меньше, и на школьном Wi-Fi это обычно один-два экрана
 * ожидания.
 *
 * Разбор качества ради этого не страдает: модель и учителю нужны читаемые
 * цифры и формулы, а не листы во всю память телефона.
 *
 * ─── Почему JPEG всегда ───
 * Снимок с камеры может прийти в HEIC (iPhone) — такой файл не откроется ни в
 * браузере учителя, ни в модели. Перекодируем в JPEG здесь, на устройстве.
 */

/** Длинная сторона результата. Меньше 1600 — модель уже не видит мельче. */
export const PHOTO_MAX_EDGE = 1600;

/** Качество JPEG: 0,82 — баланс между читаемостью цифр и весом файла. */
const JPEG_QUALITY = 0.82;

/**
 * Сжать изображение до JPEG.
 *
 * Отдельный файл и отдельная чистая функция — потому что это единственное
 * место с `canvas`, а такое легко сломать в рантайме (Safari без `toBlob` в
 * старых версиях) и невозможно проверить тестом рендера. Здесь возвращается
 * либо Blob, либо `null`: «не смогли сжать» — это «отправь как есть», а не
 * «покажи ошибку ученику».
 */
export async function compressPhoto(file: File): Promise<Blob | null> {
  // В тестах и в старых браузерах нет ни createImageBitmap, ни canvas-рендера.
  if (typeof document === "undefined") return null;
  if (typeof createImageBitmap !== "function") return null;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }

  const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return null;
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  try {
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY);
    });
    return blob;
  } catch {
    return null;
  }
}