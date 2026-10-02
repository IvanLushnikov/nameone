/**
 * Восстановление попытки ученика (TZ-13 сценарий B, шаг 6).
 *
 * Ученик на телефоне закрыл вкладку посреди игры — он должен вернуться и
 * продолжить, а не начинать заново. Поэтому держим в `localStorage`:
 *   - `attemptToken` — ключ попытки на сервере (без него сервер не узнает, что
 *     это ТА ЖЕ попытка, а не новая);
 *   - имя и класс — чтобы не спрашивать второй раз;
 *   - снапшот состояния плеера — чтобы продолжить с того же места.
 *
 * Снапшот приходит из localStorage, поэтому он **недоверен**: он может быть
 * от старой версии движка, от другого интерактива или дописан вручную из
 * консоли. Каждый плеер обязан проверить форму снапшота своим тип-гардом
 * (см. `PlayerBridge.initial`) и при несовпадении начать заново — сервер всё
 * равно пересчитывает баллы по `config_json` (ТЗ §4.7), так что «подкрутить
 * себе очки» через DevTools нельзя.
 *
 * Почему отдельный файл, а не два `useState` в оболочке: ключ должен быть
 * одинаковым на `/play/` и в тестах, а `localStorage` в SSR не существует —
 * доступ строго внутри функций, не на уровне модуля.
 */

/** Префикс ключа. Токен интерактива входит в ключ: у каждого — своя попытка. */
const KEY_PREFIX = "rabochielisty:interactive:";

/** Что мы храним на одну попытку. */
export interface StoredAttempt {
  /** Токен попытки, выданный сервером (`POST .../attempts`). */
  attemptToken: string;
  studentName: string;
  studentClass?: string;
  /** Снапшот состояния плеера — структуру определяет сам плеер. */
  snapshot: unknown;
  /**
   * unix ms последней записи. Опционально на входе: `saveAttempt` проставляет
   * его сама (`{ ...attempt, updatedAt: Date.now() }`), и требовать его от
   * вызывающих означало бы заставлять их считать время, которое всё равно
   * перезапишется. Нужен только при ЧТЕНИИ — по нему чистим старые записи.
   */
  updatedAt?: number;
}

function storageKey(interactiveToken: string): string {
  return `${KEY_PREFIX}${interactiveToken}`;
}

/** localStorage может быть недоступен (приватный режим, SSR, переполнение). */
function safeStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Читает сохранённую попытку. Любой мусор → `null` (начинаем заново). */
export function loadAttempt(interactiveToken: string): StoredAttempt | null {
  const storage = safeStorage();
  if (!storage || !interactiveToken) return null;

  try {
    const raw = storage.getItem(storageKey(interactiveToken));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredAttempt> | null;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.attemptToken !== "string" || !parsed.attemptToken) return null;
    return {
      attemptToken: parsed.attemptToken,
      studentName: typeof parsed.studentName === "string" ? parsed.studentName : "",
      studentClass:
        typeof parsed.studentClass === "string" ? parsed.studentClass : undefined,
      snapshot: parsed.snapshot,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
    };
  } catch {
    // Битый JSON — это не повод показывать ошибку, просто начинаем заново.
    return null;
  }
}

/**
 * Сохраняет попытку. Ошибки записи глушим: не сохранённый прогресс — плохо,
 * но вылетевшая страница посреди урока — хуже.
 */
export function saveAttempt(interactiveToken: string, attempt: StoredAttempt): void {
  const storage = safeStorage();
  if (!storage || !interactiveToken) return;

  try {
    storage.setItem(
      storageKey(interactiveToken),
      JSON.stringify({ ...attempt, updatedAt: Date.now() }),
    );
  } catch {
    // Квота или приватный режим — работаем без восстановления.
  }
}

/** Убирает запись после успешной отправки результата. */
export function clearAttempt(interactiveToken: string): void {
  const storage = safeStorage();
  if (!storage || !interactiveToken) return;
  try {
    storage.removeItem(storageKey(interactiveToken));
  } catch {
    // Нечего делать — запись просто останется и будет перезаписана.
  }
}
