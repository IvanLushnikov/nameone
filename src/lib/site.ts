/** Базовый URL сайта. Попадает в sitemap.xml, robots.txt, canonical и og:image.
 *
 *  ВАЖНО, 2026-10-03: дефолт — рабочий pages.dev, а НЕ uchlist.ru.
 *  Домен uchlist.ru ещё не куплен и не резолвится. Собирать с uchlist.ru
 *  нельзя: поисковик получает карту сайта и canonical с мёртвого хоста и
 *  перестаёт обходить сайт (именно это было в аудите 2026-10-02, 🔴).
 *
 *  После покупки домена: задать NEXT_PUBLIC_SITE_URL=https://uchlist.ru
 *  (в .env для локала и в env блока Build в .github/workflows/deploy.yml для CI)
 *  и пересобрать. Менять код не нужно. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://listai-prototype.pages.dev").replace(/\/+$/, "");

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
export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "hello@uchlist.ru";
