import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, KeyRound, History, Star, FolderOpen } from "lucide-react";
import { Breadcrumb } from "@/components/seo";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { PageTracker } from "@/components/shared/PageTracker";
import { registrationSteps } from "@/lib/content/trust";
import { FREE_QUOTA_LABEL } from "@/lib/content/plans";
import { SITE_URL } from "@/lib/site";
import { clipDescription, ogImages, twitterCard } from "@/lib/seo/metadata";

/**
 * Регистрация.
 *
 * Раньше `/register/` отдавал 404, хотя регистрация есть — она спрятана
 * внутри `/login/`. Учитель, который пришёл по ссылке «зарегистрироваться»,
 * попадал на пустую страницу.
 *
 * ## Честность про устройство входа
 *
 * Вход и регистрация — это одно и то же действие, почта плюс одноразовая
 * ссылка (см. `src/app/login/page.tsx`). Поэтому страница не придумывает
 * отдельную форму регистрации и не ссылается на параметр `?mode=register`,
 * которого в `/login/` не существует — ссылка ведёт прямо на рабочий сценарий.
 *
 * ТЗ-23, §8: этот блок обещал учителю, что пароль ему не понадобится.
 * После появления пароля в настройках обещание стало неправдой. Пароль —
 * способ входа, а не обязательный шаг регистрации, поэтому здесь о нём сказано
 * одной строкой и без обещаний.
 *
 * ## Про noindex
 *
 * Страница отвечает на запрос «как зарегистрироваться в УчЛист», но по
 * содержанию это объяснение входа, а `/login/` — сам вход. Два индексируемых
 * URL на одну задачу — это тонкий дубль, которого аудит боится правильно.
 * Поэтому страница закрыта от индексации, но не от перехода: входящие ссылки
 * и ссылки в подвале работают как раньше.
 */

const canonicalUrl = `${SITE_URL}/register/`;

export const metadata: Metadata = {
  title: "Регистрация — вход по ссылке из письма или по паролю",
  description: clipDescription(
    `Регистрация в УчЛисте: почта и одноразовая ссылка из письма. ${FREE_QUOTA_LABEL} — без карты и без регистрации. Регистрация нужна для истории, избранного и шаблонов.`,
  ),
  alternates: { canonical: canonicalUrl },
  robots: { index: false, follow: true },
  openGraph: {
    title: "Регистрация в УчЛист",
    description: clipDescription(
      "Вход по одноразовой ссылке на почту. Регистрация нужна для истории генераций, избранного и шаблонов.",
    ),
    url: canonicalUrl,
    siteName: "УчЛист",
    locale: "ru_RU",
    images: ogImages(undefined, "Регистрация в УчЛист"),
  },
  twitter: twitterCard(undefined),
};

const accountBenefits = [
  {
    icon: History,
    title: "История генераций",
    text: "Все листы, сделанные в аккаунте, лежат в кабинете и не зависят от браузера.",
  },
  {
    icon: Star,
    title: "Избранное",
    text: "Отмечаете удачные листы и возвращаетесь к ним в один клик.",
  },
  {
    icon: FolderOpen,
    title: "Шаблоны",
    text: "Сохранённая структура листа, чтобы не собирать её заново каждый раз.",
  },
];

export default function RegisterPage() {
  return (
    <>
      <PageTracker eventName="register_view" />

      <section className="bg-gradient-to-b from-warm-50 to-white pt-12 pb-14 sm:pt-16">
        <div className="container-tight">
          <Breadcrumb
            className="mb-4 flex flex-wrap items-center text-sm"
            items={[
              { name: "Главная", url: "/" },
              { name: "Регистрация", url: "" },
            ]}
          />
          <h1 className="text-4xl font-display font-bold tracking-tight sm:text-5xl">
            Регистрация
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-warm-600">
            Вход и регистрация — одно и то же: оставили почту, получили
            одноразовую ссылку. Дальше можно задать пароль в настройках и входить
            без письма.
          </p>
        </div>
      </section>

      <section className="pb-12">
        <div className="container-tight max-w-3xl">
          <ol className="grid gap-4 sm:grid-cols-3">
            {registrationSteps.map((item) => (
              <li key={item.step}>
                <Card className="h-full">
                  <span className="text-sm font-semibold text-brand-600">{item.step}</span>
                  <h2 className="mt-1 font-semibold text-warm-950">{item.title}</h2>
                  <p className="mt-1 text-sm text-warm-600">{item.text}</p>
                </Card>
              </li>
            ))}
          </ol>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button as="link" href="/login/" size="lg" rightIcon={<ArrowRight className="w-4 h-4" />}>
              Войти или зарегистрироваться
            </Button>
            <Link
              href="/pricing/"
              className="text-sm font-medium text-warm-700 underline decoration-warm-300 underline-offset-4 hover:decoration-brand-500"
            >
              Что входит в тарифы
            </Link>
          </div>
          <p className="mt-3 flex items-center gap-2 text-sm text-warm-600">
            <KeyRound className="h-4 w-4 text-warm-400" />
            Нужна только рабочая почта. Карта не требуется.
          </p>
        </div>
      </section>

      <section className="pb-12">
        <div className="container-tight max-w-3xl">
          <h2 className="text-2xl font-display font-bold tracking-tight">
            Что даёт аккаунт
          </h2>
          <p className="mt-2 text-warm-600">
            {FREE_QUOTA_LABEL} доступны без карты и без регистрации. Регистрация
            нужна там, где результат должен сохраниться.
          </p>
          <ul className="mt-6 grid gap-4 sm:grid-cols-3">
            {accountBenefits.map((benefit) => (
              <li key={benefit.title}>
                <Card className="h-full">
                  <benefit.icon className="h-5 w-5 text-brand-600" />
                  <h3 className="mt-3 font-semibold text-warm-950">{benefit.title}</h3>
                  <p className="mt-1 text-sm text-warm-600">{benefit.text}</p>
                </Card>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="pb-16">
        <div className="container-tight max-w-3xl">
          <Card className="bg-warm-100/70">
            <h2 className="text-xl font-semibold text-warm-950">Про данные</h2>
            <p className="mt-3 text-warm-700">
              Ссылку на вход мы отправляем только после того, как вы отметите
              согласие на обработку персональных данных — без этой отметки
              письмо не отправляется. Что именно мы собираем и сколько храним,
              написано в{" "}
              <Link
                href="/legal/consent"
                className="underline decoration-warm-300 underline-offset-4 hover:decoration-brand-500"
              >
                согласии
              </Link>{" "}
              и в{" "}
              <Link
                href="/legal/privacy"
                className="underline decoration-warm-300 underline-offset-4 hover:decoration-brand-500"
              >
                политике конфиденциальности
              </Link>
              .
            </p>
            <p className="mt-3 text-sm text-warm-500">
              Страница объясняет регистрацию и не индексируется: вход
              происходит на соседней странице.
            </p>
          </Card>
        </div>
      </section>
    </>
  );
}