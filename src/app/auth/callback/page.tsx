/**
 * /auth/callback — финальная точка magic-link.
 *
 * Сценарий: учитель кликает ссылку в письме → бэк шлёт его на
 * `${FRONTEND}/auth/callback?token=<token>`. Эта страница:
 *   1. Достаёт ?token из URL.
 *   2. POST /api/auth/callback → бэк ставит HttpOnly session-cookie + отдаёт профиль.
 *   3. Сохраняет профиль в localStorage через setProfile().
 *   4. Редиректит в /dashboard.
 *
 * Edge cases:
 *   - токена нет → «Ссылка повреждена» + кнопка «Запросить новую».
 *   - 401/404 от бэка → «Ссылка истекла или уже использована».
 *   - network error → «Не получилось подтвердить вход» + retry-кнопка.
 *   - 200 → success-стейт ~600мс → redirect.
 *
 * Страница сразу отдаёт разметку и гидратируется: токен читается из
 * `window.location.search` в useEffect внутри AuthCallbackInner. Раньше
 * здесь стоял <Suspense> — Next.js 14 при `output: "export"` требовал его
 * ради useSearchParams(), и fallback («Подтверждаем вход…») заменял собой
 * страницу на всё время загрузки JS.
 */

import type { Metadata } from "next";
import { AuthCallbackInner } from "./AuthCallbackInner";

/**
 * ТЗ-21 п.13 / SEO-аудит P1-5: страница отдавала заголовок главной, и он
 * повторялся на восьми страницах сразу. Свой заголовок здесь обязателен
 * даже при запрете индексации: если ссылка из письма не сработала, учитель
 * видит вкладку «УчЛист — рабочие листы по ФГОС за 30 секунд» вместо
 * «Подтверждаем вход» и решает, что сломался браузер, а не ссылка.
 *
 * Экспортировать из этого файла можно: он серверный (клиентский —
 * `AuthCallbackInner` внутри). Canonical не ставим: страница закрыта
 * входом и в индексе ей не место.
 */
export const metadata: Metadata = {
  title: "Подтверждаем вход",
  robots: { index: false, follow: false },
};

export default function AuthCallbackPage() {
  return <AuthCallbackInner />;
}