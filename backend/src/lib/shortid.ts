/**
 * Short ID генератор.
 *
 * Используем nanoid с урезанным алфавитом (lowercase + цифры, без дефисов/подчёркиваний),
 * чтобы ID было безопасно класть в URL и не ломать SQL.
 *
 * Префиксы по сущности: ws_…, exam_…, user_…, sess_…, magic_…
 * Это упрощает дебаг логов и поиск в D1.
 */

import { customAlphabet } from "nanoid";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const nano = customAlphabet(ALPHABET, 16);

const ALPHABET_SHORT = ALPHABET;
const nanoShort = customAlphabet(ALPHABET_SHORT, 12);

const ALPHABET_TOKEN = ALPHABET + "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const nanoToken = customAlphabet(ALPHABET_TOKEN, 32);

/**
 * Короткий читабельный ID (16 символов по умолчанию).
 */
export function shortId(length = 12): string {
  return length === 12 ? nanoShort() : nano().slice(0, length);
}

/**
 * ID рабочего листа: `ws_<12>`.
 */
export function worksheetId(): string {
  return `ws_${shortId()}`;
}

/**
 * ID экзамена: `exam_<12>`.
 */
export function examId(): string {
  return `exam_${shortId()}`;
}

/**
 * ID пользователя: `usr_<12>`.
 */
export function userId(): string {
  return `usr_${shortId()}`;
}

/**
 * Токен сессии: 32 символа (uppercase + lowercase + цифры).
 */
export function sessionToken(): string {
  return nanoToken();
}

/**
 * Magic-link токен: 32 символа, отправляется в email.
 */
export function magicLinkToken(): string {
  return nanoToken();
}
