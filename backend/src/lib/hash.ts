/**
 * SHA-256 и хэширование отпечатков.
 *
 * Выделено в отдельный модуль, потому что импортируют его и ratelimit, и
 * antifraud: если бы sha256Hex лежал в ratelimit, тот импортировал бы
 * antifraud, а тот — ratelimit, и цикл ломал бы инициализацию модулей.
 *
 * Cloudflare Workers даёт WebCrypto, дополнительных зависимостей не нужно.
 */

/** SHA-256 в hex. Соль обязательна у вызывающего: голый хэш IP подбирается перебором. */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
