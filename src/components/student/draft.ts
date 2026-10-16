/**
 * Черновик ответов ученика — ТОЛЬКО в localStorage (TZ-28, сценарий 4).
 *
 * ─── Почему локально, а не на сервере ───
 * Черновик — это «работа ещё не сдана». Если положить его в D1, то: (1) появятся
 * новые персональные данные (текст ответов ребёнка) с новым сроком удаления,
 * (2) придётся писать второй механизм их удаления, а его у нас быть не должно
 * вообще. Поэтому единственное место хранения черновика — телефон ученика.
 * Сервер знает ровно одно: отправленные ответы.
 *
 * ─── Ключ включает код класса ───
 * У учителя на доске может стоять шесть кодов, и на одном телефоне в школьном
 * портфеле легко окажутся черновики двух параллелей. Черновик привязан к коду:
 * открыл «5А» — увидел «5А».
 *
 * ─── ЧЕГО В ЧЕРНОВИКЕ НЕТ ───
 * Токена ученика. Он лежит в httpOnly-cookie и не покидает сервер: в адресе
 * `/form/?…` ему не место (история браузера, «поделиться ссылкой», скриншот).
 * Поэтому черновик хранит только то, что ученик напечатал и сфотографировал.
 *
 * ─── Повреждённое хранилище ───
 * Приватный режим Safari и переполненная квота дают исключение при записи.
 * Поэтому ВСЕ обращения обёрнуты в try/catch: сдача работы не должна зависеть
 * от того, разрешил ли телефон хранить черновики.
 */

/** Версия ключа. Поменяется, только если поменяется ФОРМАТ записи. */
export const DRAFT_PREFIX = "uchlist:draft:v1";

export interface StudentDraft {
  /** Код класса, как его ввёл ученик (в верхнем регистре). */
  code: string;
  /** Как ученик представился. Нужна финальному экрану «Аня: 7 из 10». */
  studentName: string;
  /** Номер задания → текст ответа. */
  answers: Record<string, string>;
  /** Номер задания → ключ уже загруженного фото в R2. */
  photos: Record<string, string>;
  /** Unix-мс последней записи. */
  updatedAt: number;
}

export function draftKey(code: string): string {
  return `${DRAFT_PREFIX}:${code.trim().toUpperCase()}`;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Само чтение localStorage бросает исключение в заблокированном окружении.
    return null;
  }
}

export function loadDraft(code: string): StudentDraft | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(draftKey(code));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StudentDraft>;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      code: typeof parsed.code === "string" ? parsed.code : code,
      studentName: typeof parsed.studentName === "string" ? parsed.studentName : "",
      answers: parsed.answers && typeof parsed.answers === "object" ? parsed.answers : {},
      photos: parsed.photos && typeof parsed.photos === "object" ? parsed.photos : {},
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
    };
  } catch {
    // Битый JSON не должен ронять страницу ученика: черновик — необязателен.
    return null;
  }
}

export function saveDraft(draft: StudentDraft): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(draftKey(draft.code), JSON.stringify({ ...draft, updatedAt: Date.now() }));
  } catch {
    // Квота исчерпана — молча продолжаем работать без черновика.
  }
}

export function clearDraft(code: string): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(draftKey(code));
  } catch {
    // Нечего делать: черновик просто останется и восстановится в следующий раз.
  }
}

/** Есть ли что восстанавливать. Пустой черновик на экране не показываем. */
export function draftHasContent(draft: StudentDraft | null): boolean {
  if (!draft) return false;
  return Object.keys(draft.answers).length > 0 || Object.keys(draft.photos).length > 0;
}