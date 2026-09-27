/**
 * Pre-LLM input moderation.
 *
 * Защита от мусора и очевидного prompt-injection — ДО того, как платить
 * за дорогой вызов LLM. Это не замена полноценной moderation (для неё
 * есть GPT-6 Luna mini-pass в docs/02-llm-architecture.md Section 6) — это
 * дешёвый первый фильтр.
 *
 * Правила:
 *   * пустая строка / только пробелы → reject
 *   * длина < MIN_INPUT_LEN → reject
 *   * длина > MAX_INPUT_LEN → reject (защита от длинных абзацев, которые
 *     жгут токены)
 *   * только спец-символы → reject
 *   * prompt-injection patterns ("ignore previous", "you are now", ...) → reject
 *   * non-printable мусор → reject
 */

export const MAX_INPUT_LEN = 2000;
export const MIN_INPUT_LEN = 2;

const PROMPT_INJECTION_PATTERNS: RegExp[] = [
  /\bignore\s+(all\s+|any\s+|previous\s+|the\s+above\s+)?instructions?\b/i,
  /\bdisregard\s+(all\s+|previous\s+)?(rules|instructions)\b/i,
  /\bforget\s+everything\b/i,
  /\byou\s+are\s+now\s+/i,
  /\b(?:system|assistant)\s*:\s*/i,
  /\bpretend\s+(to\s+be|you\s+are)\b/i,
  /\bjailbreak\b/i,
  /\bDAN\b/,
  /\bdeveloper\s+mode\b/i,
];

// Проверяем что в строке есть хотя бы один word-character (Latin letter/digit OR Cyrillic).
// `\w` в JS regex без /u включает только ASCII [A-Za-z0-9_] — кириллица НЕ попадает.
// Поэтому идём через Unicode property escapes: \p{L} (любая буква) + \p{N} (цифра).
// `+` после класса в negative regex сработает только если строка содержит хотя бы одну букву/цифру.
const HAS_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const NON_PRINTABLE = /[\x00-\x08\x0E-\x1F\x7F]/; // eslint-disable-line no-control-regex

export interface ModerationResult {
  ok: boolean;
  reason?: string;
}

/**
 * Проверить строку на мусор / инъекцию.
 *
 * Возвращает { ok: true } если строка пригодна для LLM.
 * Иначе { ok: false, reason } — caller должен бросить 400 BadRequest.
 */
export function moderateInput(text: string): ModerationResult {
  if (typeof text !== "string") {
    return { ok: false, reason: "input not a string" };
  }

  const trimmed = text.trim();

  if (trimmed.length === 0) {
    return { ok: false, reason: "empty input" };
  }
  if (trimmed.length < MIN_INPUT_LEN) {
    return { ok: false, reason: "input too short" };
  }
  if (trimmed.length > MAX_INPUT_LEN) {
    return {
      ok: false,
      reason: `input too long (max ${MAX_INPUT_LEN} chars)`,
    };
  }

  if (NON_PRINTABLE.test(trimmed)) {
    return { ok: false, reason: "input contains non-printable characters" };
  }

  if (!HAS_LETTER_OR_DIGIT.test(trimmed)) {
    return { ok: false, reason: "input contains only symbols/whitespace" };
  }

  for (const pat of PROMPT_INJECTION_PATTERNS) {
    if (pat.test(trimmed)) {
      return { ok: false, reason: "suspected prompt injection" };
    }
  }

  return { ok: true };
}

/**
 * Бач-mode: проверить сразу несколько полей GenerationRequest.
 * Если хоть одно плохое — возвращает причину.
 */
export function moderateGenerationRequest(req: {
  subject: string;
  topic: string;
}): ModerationResult {
  for (const field of ["subject", "topic"] as const) {
    const v = req[field];
    const r = moderateInput(v);
    if (!r.ok) return { ok: false, reason: `${field}: ${r.reason}` };
  }
  return { ok: true };
}
