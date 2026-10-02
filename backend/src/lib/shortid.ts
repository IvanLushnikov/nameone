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

/**
 * ID формы (выданного листа): `frm_<12>`.
 */
export function formId(): string {
  return `frm_${shortId()}`;
}

/**
 * ID ответа ученика на форму: `rsp_<12>`.
 */
export function responseId(): string {
  return `rsp_${shortId()}`;
}

/**
 * ID ответа на отдельное задание: `ans_<12>`.
 */
export function answerId(): string {
  return `ans_${shortId()}`;
}

/**
 * ID проверки работы по фото: `pc_<12>` (TZ-11).
 */
export function photoCheckId(): string {
  return `pc_${shortId()}`;
}

/**
 * ID позиции в проверке (одно задание): `pci_<12>` (TZ-11).
 */
export function photoCheckItemId(): string {
  return `pci_${shortId()}`;
}

/**
 * ID строки счётчика квоты: `uc_<12>` (TZ-11, таблица usage_counters).
 */
export function usageCounterId(): string {
  return `uc_${shortId()}`;
}

/**
 * Публичный токен формы: 32 символа (uppercase + lowercase + цифры).
 *
 * Это та же генерация, что у session/magic-link токенов — переиспользуем
 * `nanoToken()`, новый алфавит не заводим. Токен попадает в публичную ссылку
 * вида `/form/?t=<token>`, поэтому он должен быть длинным и URL-safe.
 */
export function formToken(): string {
  return nanoToken();
}

/**
 * ID выданного интерактива: `int_<12>` (TZ-13).
 */
export function interactiveId(): string {
  return `int_${shortId()}`;
}

/**
 * ID попытки ученика в интерактиве: `att_<12>` (TZ-13).
 */
export function attemptId(): string {
  return `att_${shortId()}`;
}

/**
 * Публичный токен интерактива: 32 символа (TZ-13).
 *
 * Та же генерация, что у `formToken()`: интерактив — та же механика «выдал
 * классу ссылку», отдельный алфавит не нужен. Попадает в ссылку `/play/?t=<token>`.
 */
export function interactiveToken(): string {
  return nanoToken();
}

/**
 * Токен попытки ученика: 32 символа (TZ-13). Нужен, чтобы ученик мог закрыть
 * вкладку и вернуться к своей попытке по этому токену.
 */
export function attemptToken(): string {
  return nanoToken();
}
