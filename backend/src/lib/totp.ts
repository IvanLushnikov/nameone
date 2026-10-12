/**
 * TOTP — код подтверждения из приложения (ТЗ-24, раздел 8.1).
 *
 * РЕШЕНИЕ ВЛАДЕЛЬЦА: код нужен только администратору, в суперадминке.
 * Учителям не добавляется — см. `docs/tz/23-password-auth.md`.
 *
 * ЧТО ЗДЕСЬ И ЧТО НЕ ЗДЕСЬ
 * ----------------------
 * Здесь только криптография: генерация секрета, расчёт кода, проверка, шифрование
 * секрета для хранения. Ни HTTP, ни базы, ни rate limit — это всё в роутах.
 *
 * ПОЧЕМУ БЕЗ БИБЛИОТЕКИ
 * --------------------
 * TOTP (RFC 6238) — это HMAC-SHA1 по счётчику времени плюс динамическое усечение.
 * На Workers есть `crypto.subtle`, поэтому всё считается штатными средствами:
 * тянуть библиотеку ради ста строчек ради этого не нужно. Отдельная зависимость
 * ещё и означала бы, что версия приедет извне — а здесь всё в руках.
 *
 * ПОЧЕМУ ОКНО ДОПУСКА ±1 ОКНО
 * --------------------------
 * Код, который человек видит на экране телефона, живёт 30 секунд. Ввести его
 * можно чуть позже, чем он появился, а при переходе через границу минуты телефон
 * и сервер считают разное окно. Без допуска в шаг назад человек вводит верный
 * код и получает «неверный» — и считает, что сломалось всё.
 *
 * ПОЧЕМУ СЕКРЕТ ШИФРУЕТСЯ
 * ---------------------
 * Пароль хранится хешем (PBKDF2) — восстановить его нельзя. Секрет TOTP так
 * не хранится: его нужно сравнивать с каждым входом, значит он должен
 * читаться. Поэтому он лежит зашифрованным (AES-256-GCM, ключ из env), а не
 * открытым текстом в таблице, где его увидит любой, кто получил доступ к
 * дампу D1.
 */

/** Стандарт TOTP по умолчанию: 6 цифр, окно 30 секунд. */
const DIGITS = 6;
const PERIOD_SECONDS = 30;
/** Насколько окон вперёд/назад принимаем. */
const WINDOW_DRIFT = 1;

/** Алфавит base32 по RFC 4648 (без padding'а — так его выводит Google Authenticator). */
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Сгенерировать новый секрет TOTP в виде base32-строки. */
export function generateTotpSecret(bytes = 20): string {
  const raw = new Uint8Array(bytes);
  crypto.getRandomValues(raw);
  return base32Encode(raw);
}

/** Закодировать байты в base32 без padding'а. */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

/** Разобрать base32 обратно в байты. Бросает на недопустимом символе. */
export function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error("Секрет содержит недопустимый символ");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** HMAC-SHA1 ключом из секрета, по 8-байтовому счётчику времени. */
async function hmac(secret: Uint8Array, counter: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    secret as unknown as ArrayBuffer,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );

  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  // 64-битный счётчик: старшие 4 байта всегда нули до 2106 года.
  view.setUint32(0, Math.floor(counter / 2 ** 32));
  view.setUint32(4, counter >>> 0);

  const sig = await crypto.subtle.sign("HMAC", key, buf);
  return new Uint8Array(sig);
}

/** Динамическое усечение HMAC до 6 цифр (RFC 4226, HOTP). */
function dynamicTruncate(sig: Uint8Array): string {
  const offset = sig[sig.length - 1]! & 0x0f;
  const binary =
    ((sig[offset]! & 0x7f) << 24) |
    ((sig[offset + 1]! & 0xff) << 16) |
    ((sig[offset + 2]! & 0xff) << 8) |
    (sig[offset + 3]! & 0xff);
  return (binary % 10 ** DIGITS).toString().padStart(DIGITS, "0");
}

/** Текущий счётчик времени: unix-время, делённое на окно. */
export function currentCounter(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000 / PERIOD_SECONDS);
}

/** Посчитать код для конкретного окна. Только для тестов и отладки. */
export async function totpAt(secret: Uint8Array, counter: number): Promise<string> {
  return dynamicTruncate(await hmac(secret, counter));
}

/**
 * Проверить код.
 *
 * Сравнение — постоянного времени: разница во времени ответа сама по себе
 * позволяет подбирать код по одному биту за попытку. `timingSafeEqual` есть в
 * Web Crypto Workers; если вдруг нет — сравниваем накопленным XOR, а не `===`.
 */
export async function verifyTotp(
  secret: Uint8Array,
  code: string,
  options: { nowMs?: number; drift?: number } = {},
): Promise<boolean> {
  const normalized = code.replace(/\s+/g, "");
  if (!new RegExp(`^\\d{${DIGITS}}$`).test(normalized)) return false;

  const now = options.nowMs ?? Date.now();
  const drift = options.drift ?? WINDOW_DRIFT;
  const counter = currentCounter(now);

  let matched = false;
  for (let i = -drift; i <= drift; i++) {
    const expected = await totpAt(secret, counter + i);
    // Каждое окно проверяем, результат копим — иначе цикл прерывается на
    // первом совпадении и время ответа выдаёт, какое окно совпало.
    if (constantTimeEquals(expected, normalized)) matched = true;
  }
  return matched;
}

/** Сравнение строк постоянного времени: разница не влияет на число итераций. */
export function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Шифрование секрета для хранения
// ─────────────────────────────────────────────────────────────────────────────

/** Секрет хранится как `base64(iv).base64(ciphertext)`. */
export interface SealedSecret {
  ciphertext: string;
  iv: string;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Зашифровать секрет AES-256-GCM.
 *
 * Ключ приходит из env в base64 и должен быть ровно 32 байта. Без ключа
 * функция падает, а не шифрует «как-нибудь»: хранить секрет админа открытым
 * текстом из-за неудобства — ровно та ошибка, которую потом не найти.
 */
export async function sealSecret(secretBase32: string, keyBase64: string): Promise<SealedSecret> {
  const keyBytes = fromBase64(keyBase64);
  if (keyBytes.length !== 32) {
    throw new Error("TOTP_ENCRYPTION_KEY должен быть 32 байта в base64");
  }

  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes as unknown as ArrayBuffer,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(secretBase32);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain);

  return { ciphertext: toBase64(new Uint8Array(ct)), iv: toBase64(iv) };
}

/** Расшифровать секрет. Ошибка расшифровки — это исключение, а не тихий ноль. */
export async function unsealSecret(sealed: SealedSecret, keyBase64: string): Promise<string> {
  const keyBytes = fromBase64(keyBase64);
  if (keyBytes.length !== 32) {
    throw new Error("TOTP_ENCRYPTION_KEY должен быть 32 байта в base64");
  }

  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes as unknown as ArrayBuffer,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );

  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(sealed.iv) as unknown as ArrayBuffer },
    key,
    fromBase64(sealed.ciphertext) as unknown as ArrayBuffer,
  );
  return new TextDecoder().decode(plain);
}

// ─────────────────────────────────────────────────────────────────────────────
// Резервные коды
// ─────────────────────────────────────────────────────────────────────────────

/** Резервных кодов на один набор — десять, как в большинстве сервисов. */
export const BACKUP_CODE_COUNT = 10;

/**
 * Сгенерировать резервные коды.
 *
 * Формат `XXXX-XXXX` — восемь символов через дефис. Без дефисов набирать
 * неудобно, а длиннее десяти символов человек при записи на бумагу обязательно
 * ошибётся.
 *
 * Алфавит — ровно 32 символа, и 256 % 32 == 0, поэтому `byte % 32` не даёт
 * смещения: каждый символ выпадает одинаково часто.
 *
 * Из алфавита убраны O, I, L и ноль — это четыре символа, которые при
 * переписывании на бумагу путают чаще всего (O/0, I/1, 1/L). Остаются 23 буквы
 * и цифры 1–9. Пара S/5 и Z/2 тоже путаются, но убрать их вместе с остальными
 * нельзя — не хватит длины, а длина 32 нужна ради отсутствия смещения.
 */
export function generateBackupCodes(count = BACKUP_CODE_COUNT): string[] {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ123456789";
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    let raw = "";
    for (let j = 0; j < 8; j++) {
      raw += alphabet[crypto.getRandomValues(new Uint8Array(1))[0]! % alphabet.length];
    }
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4)}`);
  }
  return codes;
}

/** Нормализация кода для сравнения: без дефисов, в верхнем регистре. */
export function normalizeBackupCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}