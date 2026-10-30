/**
 * Тип файла по содержимому (magic bytes).
 *
 * ЗАЧЕМ. Тип, который прислал клиент (`File.type`), — это просто строка из
 * запроса, и сервер верил ей на слово. Учитель или ученик мог положить в
 * R2 HTML или SVG с заголовком `image/jpeg`, и сервер это принимал. Ревью
 * безопасности 30.10.2026, находка №8.
 *
 * Формат файла определяется по первым байтам — так же, как это делают браузер,
 * почтовые клиенты и мессенджеры. Для изображений это надёжно: у JPEG, PNG и
 * WebP сигнатура фиксирована в начале файла.
 *
 * Сейчас это не эксплуатируется: бакет приватный, ни один роут не отдаёт
 * байты R2 наружу — наружу фото уходит только воркеру для распознавания. Риск
 * проснётся, если появится ссылка на файл или presigned URL. Поэтому проверка
 * добавлена как страховка, а не как срочная починка.
 */

/** Форматы изображений, которые принимает продукт. */
export type SniffedImageMime = "image/jpeg" | "image/png" | "image/webp";

/**
 * Определить формат изображения по первым байтам.
 *
 * @returns тип или `null`, если это не изображение из списка выше.
 */
export function sniffImageMime(bytes: ArrayBuffer): SniffedImageMime | null {
  if (bytes.byteLength === 0) return null;
  const head = new Uint8Array(bytes, 0, Math.min(16, bytes.byteLength));

  // JPEG: FF D8 FF
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return "image/jpeg";
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    head.length >= 8 &&
    head[0] === 0x89 &&
    head[1] === 0x50 &&
    head[2] === 0x4e &&
    head[3] === 0x47 &&
    head[4] === 0x0d &&
    head[5] === 0x0a &&
    head[6] === 0x1a &&
    head[7] === 0x0a
  ) {
    return "image/png";
  }

  // WebP: "RIFF" .... "WEBP" (размер файла между ними — четыре байта)
  if (head.length >= 12) {
    const riff = String.fromCharCode(head[0] ?? 0, head[1] ?? 0, head[2] ?? 0, head[3] ?? 0);
    const webp = String.fromCharCode(head[8] ?? 0, head[9] ?? 0, head[10] ?? 0, head[11] ?? 0);
    if (riff === "RIFF" && webp === "WEBP") return "image/webp";
  }

  return null;
}

/** Что не так с файлом, если что-то не так. */
export type SignatureProblem = "not-an-image" | "type-mismatch";

export type SignatureVerdict =
  | { ok: true; mime: SniffedImageMime }
  | { ok: false; problem: SignatureProblem; sniffed: SniffedImageMime | null };

/**
 * Сверить заявленный клиентом тип с содержимым файла.
 *
 * `declaredMime` — тип из заголовка запроса, приведённый к канону
 * (`image/jpg` → `image/jpeg`). Расхождение отклоняется: если клиент говорит
 * «JPEG», а по байтам это PNG, — это не фотография телефона, а подмена.
 */
export function checkImageSignature(bytes: ArrayBuffer, declaredMime: string): SignatureVerdict {
  const sniffed = sniffImageMime(bytes);
  if (!sniffed) return { ok: false, problem: "not-an-image", sniffed: null };
  if (sniffed !== declaredMime) return { ok: false, problem: "type-mismatch", sniffed };
  return { ok: true, mime: sniffed };
}
