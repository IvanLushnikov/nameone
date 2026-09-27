/**
 * F-05-B: клиент для Cloudflare Worker self-verify.
 *
 * Worker (`worker-self-verify/`) делает двухпроходную проверку задачи:
 *   1) solve — LLM решает задачу, получает `answer`
 *   2) verify — тот же/другой LLM проверяет правильность, получает `verified`
 *
 * Этот модуль — тонкая обёртка: fetch → JSON → нормализация.
 * На любой сбой (нет URL, таймаут, 500, битый JSON) возвращает
 *   { verified: null, answer: "", explanation: "Сервис проверки недоступен" }
 * — это сигнал UI показать серый badge «— не проверено», а не падать.
 *
 * URL Worker-а: NEXT_PUBLIC_WORKER_URL
 *   - dev: http://localhost:8787 (по умолчанию, через `wrangler dev`)
 *   - prod: https://listai-self-verify.<account>.workers.dev (Subtask #3 deploy)
 *
 * Timeout 35 сек: Worker-у выделено 30 сек (CPU-time на Free plan),
 * +5 сек на сеть, JSON-парсинг, маршалинг. При превышении — graceful fallback.
 */

const WORKER_URL =
  (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_WORKER_URL) ||
  "http://localhost:8787";

/** Timeout одного verify-вызова. Должен быть ≥ Worker timeout + overhead. */
const REQUEST_TIMEOUT_MS = 35_000;

export interface SelfVerifyResult {
  /** null = не удалось проверить (Worker недоступен / таймаут / 500). */
  verified: boolean | null;
  /** Ответ LLM на задачу (может совпадать с эталоном из `expectedAnswer`). */
  answer: string;
  /** Объяснение проверки (почему verified=true/false). */
  explanation?: string;
  /** Сколько миллисекунд Worker-у понадобилось (если вернул). */
  latency_ms?: number;
  /** Какая модель сделала проверку (если вернул). */
  model?: string;
  /** True если Worker вернул mock без обращения к LLM (нет ключа и т.п.). */
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
 * Вызов Worker-а /verify.
 * Возвращает `{verified: null, answer: "", explanation: "..."}` на любой сбой —
 * генерация листа не должна падать из-за недоступного сервиса проверки.
 */
export async function selfVerifyTask(
  task: SelfVerifyTaskInput
): Promise<SelfVerifyResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${WORKER_URL.replace(/\/+$/, "")}/verify`, {
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
      console.warn(`[self-verify] Worker ${res.status}: ${res.statusText}`);
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