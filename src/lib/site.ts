/** Базовый URL сайта. Домен rabochielisty.ru ещё не делегирован — до покупки
 *  задавай NEXT_PUBLIC_SITE_URL=https://listai-prototype.pages.dev,
 *  иначе sitemap/canonical укажут на нерезолвящийся хост. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://rabochielisty.ru").replace(/\/+$/, "");

/** SITE_URL без схемы — для мест, где нужен голый домен (подписи в печатных листах). */
export const SITE_HOST = SITE_URL.replace(/^https?:\/\//, "");

/**
 * Почта поддержки.
 *
 * Раньше адрес был зашит строкой в трёх местах (главная в JSON-LD, футер,
 * политика). Пока домен не делегирован, письмо на него не доходит — учитель
 * пишет «в поддержку», ответа нет. Задай рабочий адрес в
 * `NEXT_PUBLIC_SUPPORT_EMAIL`; дефолт оставлен прежним, чтобы страница
 * не рассыпалась, пока переменная не задана.
 */
export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "hello@rabochielisty.ru";
