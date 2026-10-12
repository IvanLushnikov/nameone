/**
 * Продуктовый трекер: события уходят на бэкенд, а не в консоль.
 *
 * ДО 12.10.2026 ЭТО БЫЛ ЗАГЛУШКА
 * -------------------------------
 * Функция печатала событие в консоль и ТОЛЬКО при `NODE_ENV !== "production"`:
 *
 *     if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
 *       console.debug(`[track] ${name}`, data);
 *     }
 *
 * То есть на боевом сайте из 35 расставленных по коду событий не уходило ни
 * одного: статистики по экранам не существовало, и `/superpower` показывать
 * было нечего. Теперь событие уходит в `POST /api/track`, откуда попадает в
 * таблицу `events`.
 *
 * ТРИ ПРАВИЛА, КОТОРЫЕ ЗДЕСЬ НЕЛЬЗЯ НАРУШАТЬ
 * ------------------------------------------
 *
 * 1. СОБЫТИЕ НЕ ЛОМАЕТ ИНТЕРФЕЙС. Любая ошибка — молча проглатывается. Трекер
 *    не должен превращать клик по кнопке в исключение, из-за которого у
 *    учителя не откроется форма. Событие — телеметрия, а не условие работы.
 *
 * 2. ОДНА СТРОКА НА СОБЫТИЕ, НЕ ЖДЁМ ОТВЕТА. Отправка идёт через
 *    `keepalive`, чтобы запрос пережил уход со страницы (кликнул «сгенерировать»
 *    и сразу перешёл на другой экран). Ответ сервера ничего не решает.
 *
 * 3. НИКАКИХ ПЕРСОНАЛЬНЫХ ДАННЫХ. В существующих вызовах передаётся `emailDomain`
 *    (домен, а не адрес) — это правило сохраняется. Сервер дополнительно
 *    фильтрует поля по белому списку, но безопасность не должна зависеть от того,
 *    что фронт не забудет: второй слой на сервере (см. backend/src/routes/track.ts).
 *
 * ЗАЧЕМ ОСТАВИТЬ ЛОГИРОВАНИЕ В DEV
 * ---------------------------------
 * На стенде событие видно в консоли без запросов в базу — видно, что событие
 * вообще сработало, ещё до того как появилась админка. В проде логов нет:
 * это продакшн, лишняя консоль учителю не нужна.
 */

/** Адрес бэкенда. Пустая строка на стендах без бэка — трекер молча выключен. */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

/** Тип данных события. Свободная форма — сервер всё равно фильтрует по списку. */
export type TrackEventData = Record<string, unknown> | undefined;

export type TrackEventName = string;

/**
 * Отправить событие на бэкенд.
 *
 * Анонимно и синхронно: ни Promise, ни колбэка. Всё, что здесь может
 * пойти не так, поймано и проигнорировано — по правилу 1 выше.
 */
function send(name: string, data?: TrackEventData): void {
  if (typeof window === "undefined") return;
  if (!API_URL) return;

  try {
    const payload = JSON.stringify({ name, data: data ?? null });

    // fetch с keepalive переживает уход со страницы. Если недоступен
    // (старый браузер) — откатываемся на sendBeacon, который для этой задачи
    // как раз и придуман.
    if (typeof navigator.sendBeacon === "function" && typeof fetch !== "function") {
      navigator.sendBeacon(
        `${API_URL}/api/track`,
        new Blob([payload], { type: "application/json" }),
      );
      return;
    }

    void fetch(`${API_URL}/api/track`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
      keepalive: true,
      // Ошибку не читаем намеренно: 400 от неизвестного события — это наша
      // недосмотренность, учителю про неё знать нечего.
    }).catch(() => undefined);
  } catch {
    /* правило 1: трекер не имеет права бросать */
  }
}

/**
 * Зафиксировать продуктовое событие.
 *
 * Примеры вызова — они уже расставлены по коду (см. grep по `trackEvent(`):
 *   trackEvent("constructor_view", { mode });
 *   trackEvent("constructor_step", { from: prevStep.current, to: step, mode });
 *   trackEvent("login_submit", { emailDomain });
 */
export function trackEvent(name: TrackEventName, data?: TrackEventData): void {
  if (typeof window === "undefined") return;

  if (process.env.NODE_ENV !== "production") {
    // На стенде — в консоль, без похода в базу.
    // eslint-disable-next-line no-console
    console.debug(`[track] ${name}`, data);
  }

  send(name, data);
}

/**
 * Зафиксировать просмотр экрана. Событие пишется так же, как любое другое —
 * отдельного канала для страниц нет.
 */
export function trackPageView(name: TrackEventName, data?: TrackEventData): void {
  trackEvent(name, data);
}