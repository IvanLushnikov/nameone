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

import { AuthCallbackInner } from "./AuthCallbackInner";

export default function AuthCallbackPage() {
  return <AuthCallbackInner />;
}