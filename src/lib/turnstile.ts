"use client";

/**
 * Невидимый Cloudflare Turnstile для антифрода.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ГЛАВНОЕ: СКРИПТ ГРУЗИТСЯ ТОЛЬКО КОГДА НУЖЕН
 * ─────────────────────────────────────────────────────────────────────────────
 * Обычный учитель не должен платить за антифрод ни миллисекундой и ни одним
 * сторонним запросом. Поэтому скрипт Turnstile НЕ подключается в layout и не
 * грузится при монтировании — он появляется только после 409 TURNSTILE_REQUIRED
 * от бэка, то есть когда сервер увидел признаки мультиаккаунта или прокси.
 *
 * На нормальном пути работы здесь нет ни одного сетевого запроса.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * КАК ЭТО РАБОТАЕТ
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. Бэк отвечает 409 TURNSTILE_REQUIRED.
 *   2. UI вызывает solveChallenge() и ждёт токен (невидимый режим).
 *   3. Токен уходит в /api/turnstile/verify.
 *   4. Исходный запрос повторяется с заголовком cf-turnstile-response.
 *
 * Режим invisible/execution: 'execute' — виджет сам решает, показывать ли
 * картинку. В подавляющем большинстве случаев он не показывает ничего.
 */

import * as React from "react";

/** Окно, в котором скрипт Turnstile точно появится. */
const TURNSTILE_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=";

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string;
          callback: (token: string) => void;
          "error-callback"?: () => void;
          "expired-callback"?: () => void;
          size?: "normal" | "compact" | "flexible" | "invisible" | "execute";
          appearance?: "always" | "execute" | "interaction-only";
        },
      ) => string;
      remove: (widgetId: string) => void;
      reset: (widgetId: string) => void;
    };
  }
}

let scriptPromise: Promise<void> | null = null;

/**
 * Загрузить скрипт Turnstile один раз на страницу.
 * Повторные вызовы возвращают тот же промис, а не грузят скрипт снова.
 */
function loadTurnstileScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("SSR"));
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const cb = "__rabochielisty_turnstile_onload";
    (window as unknown as Record<string, unknown>)[cb] = () => {
      delete (window as unknown as Record<string, unknown>)[cb];
      resolve();
    };
    const s = document.createElement("script");
    s.src = TURNSTILE_SRC + cb;
    s.async = true;
    s.defer = true;
    s.onerror = () => {
      delete (window as unknown as Record<string, unknown>)[cb];
      scriptPromise = null;
      reject(new Error("Не удалось загрузить Turnstile"));
    };
    document.head.appendChild(s);
  });

  return scriptPromise;
}

/** Sitekey: фронт статически экспортируется, поэтому ключ вшивается при билде. */
function siteKey(): string | null {
  const key = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  return key && key.length > 0 ? key : null;
}

export function isTurnstileConfigured(): boolean {
  return siteKey() != null;
}

/**
 * Получить токен невидимым капча-челленджем.
 *
 * Возвращает null, если капча не настроена или не загрузилась. Вызывающий
 * код обязан трактовать null как «повторить без капчи»: fail-open выбран
 * сознательно — учитель, у которого сторонний сервис недоступен, не должен
 * терять доступ к генератору (та же логика, что в бэке).
 */
export async function solveChallenge(timeoutMs = 15_000): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const key = siteKey();
  if (!key) return null;

  try {
    await loadTurnstileScript();
  } catch {
    return null;
  }
  const turnstile = window.turnstile;
  if (!turnstile) return null;

  return new Promise<string | null>((resolve) => {
    const holder = document.createElement("div");
    holder.style.display = "none";
    document.body.appendChild(holder);

    let settled = false;
    const finish = (token: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        if (widgetId) turnstile.remove(widgetId);
      } catch {
        /* виджет мог не создаться */
      }
      holder.remove();
      resolve(token);
    };

    // Страховка по времени: если что-то в Cloudflare зависло, мы не должны
    // оставить учителя с вечно висящей кнопкой «Генерировать».
    const timer = setTimeout(() => finish(null), timeoutMs);

    let widgetId = "";
    try {
      widgetId = turnstile.render(holder, {
        sitekey: key,
        size: "invisible",
        appearance: "interaction-only",
        callback: (token: string) => finish(token),
        "error-callback": () => finish(null),
        "expired-callback": () => finish(null),
      });
    } catch {
      finish(null);
    }
  });
}

/**
 * Проверить токен на сервере.
 * Не бросает: ошибка означает «считаем, что капчи не было».
 */
export async function verifyChallenge(token: string): Promise<boolean> {
  if (!token) return false;
  const base = process.env.NEXT_PUBLIC_API_URL;
  if (!base) return true; // бэка нет — нечего проверять
  try {
    const res = await fetch(`${base}/api/turnstile/verify`, {
      method: "POST",
      headers: { "cf-turnstile-response": token },
    });
    if (!res.ok) return false;
    const data = (await res.json().catch(() => null)) as { ok?: boolean } | null;
    return data?.ok === true;
  } catch {
    return false;
  }
}

/**
 * Полный цикл: получить токен и подтвердить его на сервере.
 * null = «капча не нужна или недоступна, повтори запрос без неё».
 */
export async function passChallenge(): Promise<string | null> {
  const token = await solveChallenge();
  if (!token) return null;
  const ok = await verifyChallenge(token);
  return ok ? token : null;
}
