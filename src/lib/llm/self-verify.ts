/**
 * F-05-B: клиент двухпроходной проверки ответа через основной бэкенд.
 *
 * Проверка делается на бэкенде (`POST /api/llm/verify`), тем же POLZA_API_KEY,
 * что и генерация:
 *   1) solve — LLM решает задачу, получает `answer`
 *   2) verify — тот же LLM проверяет правильность, получает `verified`
 *
 * 10.10.2026 вызов переехал с отдельного воркера `worker-self-verify/` на
 * основной API. Причина одна: у воркера НЕ БЫЛО ключа, а код при отсутствии
 * ключа молча возвращал подставной `verified: true` — для учителя это
 * неотличимо от настоящей проверки. Бэкенд подставных ответов не отдаёт:
 * нет ключа / провайдер упал / не разобрали JSON → 503 или 502, и этот модуль
 * превращает любой сбой в `verified: null` (серый бейдж «— не проверено»).
 * Сам воркер удалён 06.10.2026: папки в репозитории нет, и она удалена из
 * Cloudflare — до этого он продолжал публично отвечать «проверено» без
 * нейросети, хотя фронт на него уже не ходил.
 *
 * Этот модуль — тонкая обёртка: fetch → JSON → нормализация.
 * На любой сбой (нет URL, таймаут, 500, 503, битый JSON) возвращает
 *   { verified: null, answer: "", explanation: "Сервис проверки недоступен" }
 * — это сигнал UI показать серый badge «— не проверено», а не падать.
 *
 * URL API: NEXT_PUBLIC_API_URL
 *   - dev: http://localhost:8787 (по умолчанию, `wrangler dev` в backend/)
 *   - prod: https://rabochielisty-api.ivanlusnikov159.workers.dev
 *
 * Timeout 35 сек: два LLM-вызова подряд (solve + verify) плюс сеть и разбор
 * JSON. При превышении — graceful fallback, генерация листа не падает.
 */

const API_URL =
  (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_API_URL) ||
  "http://localhost:8787";

const VERIFY_PATH = "/api/llm/verify";

/** Timeout одного verify-вызова: два LLM-вызова + сеть + парсинг. */
const REQUEST_TIMEOUT_MS = 35_000;

export interface SelfVerifyResult {
  /** null = не удалось проверить (сервис недоступен / таймаут / 5xx). */
  verified: boolean | null;
  /** Ответ LLM на задачу (может совпадать с эталоном из `expectedAnswer`). */
  answer: string;
  /** Объяснение проверки (почему verified=true/false). */
  explanation?: string;
  /** Сколько миллисекунд бэкенду понадобилось (если вернул). */
  latency_ms?: number;
  /** Какая модель сделала проверку (если вернул). */
  model?: string;
  /**
   * True, если сервис вернул подставной результат без обращения к LLM.
   *
   * На бэкенде такого режима нет: значение всегда false. Поле оставлено в
   * контракте, потому что UI на него смотрит — и чтобы отличие подставного
   * результата от настоящего снова нельзя было пропустить молча.
   */
  mock?: boolean;
}

export interface SelfVerifyTaskInput {
  subject: string;
  grade: number;
  topic: string;
  text: string;
  expectedAnswer?: string;
}

/**
 * Вызов бэкенда POST /api/llm/verify.
 * Возвращает `{verified: null, answer: "", explanation: "..."}` на любой сбой —
 * генерация листа не должна падать из-за недоступного сервиса проверки.
 */
export async function selfVerifyTask(
  task: SelfVerifyTaskInput
): Promise<SelfVerifyResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${API_URL.replace(/\/+$/, "")}${VERIFY_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: task.subject,
        grade: task.grade,
        topic: task.topic,
        task: {
          text: task.text,
          expectedAnswer: task.expectedAnswer,
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[self-verify] API ${res.status}: ${res.statusText}`);
      return fallback(`HTTP ${res.status}`);
    }

    const raw = (await res.json().catch(() => null)) as
      | Partial<SelfVerifyResult>
      | null;

    if (!raw || typeof raw !== "object") {
      return fallback("пустой ответ");
    }

    return {
      verified: typeof raw.verified === "boolean" ? raw.verified : null,
      answer: typeof raw.answer === "string" ? raw.answer : "",
      explanation: typeof raw.explanation === "string" ? raw.explanation : undefined,
      latency_ms: typeof raw.latency_ms === "number" ? raw.latency_ms : undefined,
      model: typeof raw.model === "string" ? raw.model : undefined,
      mock: raw.mock === true,
    };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    // eslint-disable-next-line no-console
    console.warn(
      `[self-verify] ${isAbort ? `timeout ${REQUEST_TIMEOUT_MS}ms` : "fetch failed"}:`,
      err
    );
    return fallback(isAbort ? "Таймаут проверки" : "Сервис проверки недоступен");
  } finally {
    clearTimeout(timer);
  }
}

function fallback(reason: string): SelfVerifyResult {
  return {
    verified: null,
    answer: "",
    explanation: reason,
  };
}