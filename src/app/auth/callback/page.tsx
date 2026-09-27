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
 * Важно: Next.js 14 при `output: "export"` требует обернуть useSearchParams()
 * в <Suspense>, иначе пререндер падает. Поэтому клиентская логика вынесена
 * в AuthCallbackInner, а page.tsx — server-component с <Suspense fallback>.
 */

import * as React from "react";
import { Card } from "@/components/ui/Card";
import { Loader2 } from "lucide-react";
import { AuthCallbackInner } from "./AuthCallbackInner";

function LoadingFallback() {
  return (
    <div className="container-tight py-12 sm:py-20 max-w-md mx-auto">
      <Card>
        <div className="text-center">
          <div className="w-12 h-12 rounded-xl bg-brand-500 text-white grid place-items-center mx-auto mb-4 shadow-brand">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
          <h1 className="text-xl font-semibold text-warm-950">
            Подтверждаем вход…
          </h1>
          <p className="text-sm text-warm-500 mt-2">Это занимает пару секунд.</p>
        </div>
      </Card>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <React.Suspense fallback={<LoadingFallback />}>
      <AuthCallbackInner />
    </React.Suspense>
  );
}