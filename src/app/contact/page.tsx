import type { Metadata } from "next";
import Link from "next/link";
import { Mail, MessageCircle, FileText } from "lucide-react";
import { Breadcrumb } from "@/components/seo";
import { Card } from "@/components/ui/Card";
import { PageTracker } from "@/components/shared/PageTracker";
import { DetailRow } from "@/components/trust/DetailRow";
import {
  TELEGRAM_URL,
  contactChannels,
  operator,
  supportEmail,
} from "@/lib/content/trust";
import { SITE_URL } from "@/lib/site";
import { clipDescription, ogImages, twitterCard } from "@/lib/seo/metadata";

/**
 * Контакты и реквизиты.
 *
 * Страница обязательна по 54-ФЗ: у сайта, который принимает оплату, должны
 * быть реквизиты исполнителя и способ связи. Раньше `/contact/` отдавал 404,
 * а в подвале стоял только адрес почты — этого недостаточно.
 *
 * Реквизиты НЕ выдуманы. Что не задано переменной окружения, выводится
 * пометкой «[вписывает владелец]» (см. `operator` в `src/lib/content/trust.ts`).
 * ОГРН не выводится намеренно: исполнитель — самозанятый, а этот режим
 * ОГРНИП не присваивает, идентификатор у него один — ИНН.
 */

const canonicalUrl = `${SITE_URL}/contact/`;

export const metadata: Metadata = {
  title: "Контакты — почта, Telegram и реквизиты исполнителя",
  description: clipDescription(
    `Напишите на ${supportEmail} или в Telegram. Здесь же реквизиты исполнителя: режим налогообложения, ИНН и адрес регистрации, а также все юридические документы сервиса.`,
  ),
  alternates: { canonical: canonicalUrl },
  openGraph: {
    title: "Контакты УчЛист",
    description: clipDescription(
      `Почта ${supportEmail}, Telegram и реквизиты исполнителя. Юридические документы сервиса — по ссылкам.`,
    ),
    url: canonicalUrl,
    siteName: "УчЛист",
    locale: "ru_RU",
    images: ogImages(undefined, "Контакты УчЛист"),
  },
  twitter: twitterCard(undefined),
};

const legalDocs = [
  { href: "/legal/offer", label: "Публичная оферта" },
  { href: "/legal/consent", label: "Согласие на обработку персональных данных" },
  { href: "/legal/privacy", label: "Политика конфиденциальности" },
  { href: "/legal/terms", label: "Пользовательское соглашение" },
  { href: "/legal/cookies", label: "Использование cookie-файлов" },
];

export default function ContactPage() {
  return (
    <>
      <PageTracker eventName="contact_view" />

      <section className="bg-gradient-to-b from-warm-50 to-white pt-12 pb-14 sm:pt-16">
        <div className="container-tight">
          <Breadcrumb
            className="mb-4 flex flex-wrap items-center text-sm"
            items={[
              { name: "Главная", url: "/" },
              { name: "Контакты", url: "" },
            ]}
          />
          <h1 className="text-4xl font-display font-bold tracking-tight sm:text-5xl">
            Контакты
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-warm-600">
            Написать можно двумя способами. Оба ведут к одному человеку — тому,
            кто делает сервис.
          </p>
        </div>
      </section>

      <section className="pb-12">
        <div className="container-tight grid gap-8 lg:grid-cols-2">
          <Card>
            <h2 className="text-xl font-semibold text-warm-950">Как связаться</h2>
            <ul className="mt-4 space-y-4">
              {contactChannels.map((channel) => (
                <li key={channel.id} className="flex items-start gap-3">
                  <span className="mt-0.5 text-brand-600">
                    {channel.id === "email" ? (
                      <Mail className="h-5 w-5" />
                    ) : (
                      <MessageCircle className="h-5 w-5" />
                    )}
                  </span>
                  <span>
                    <a
                      href={channel.href}
                      className="font-medium text-warm-950 underline decoration-warm-300 underline-offset-4 hover:decoration-brand-500"
                      {...(channel.id === "telegram"
                        ? { target: "_blank", rel: "noopener noreferrer" }
                        : {})}
                    >
                      {channel.label}
                    </a>
                    <span className="block text-sm text-warm-600">{channel.note}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <h2 className="text-xl font-semibold text-warm-950">Реквизиты исполнителя</h2>
            <dl className="mt-4">
              <DetailRow label="Режим налогообложения" value={operator.regime} />
              <DetailRow label="ФИО" value={operator.name} />
              <DetailRow label="ИНН" value={operator.inn} />
              <DetailRow label="Адрес регистрации" value={operator.address} />
              <DetailRow label="Связь" value={supportEmail} />
            </dl>
            <p className="mt-4 text-sm text-warm-600">{operator.regimeNote}</p>
            {/* Б-3: пометка «[вписывает владелец]» вместо прежних скобок
                `{{ ИНН }}`. Пунктирную рамку незаполненного поля рисовал
                `DetailRow` — он узнаёт пометку по `{{ }}`, а этот компонент
                лежит вне моей зоны. Поэтому пояснение одно, под списком. */}
            <p className="mt-3 text-sm text-warm-500">
              Значение «[вписывает владелец]» — поле, которое владелец сайта
              ещё не заполнил.
            </p>
          </Card>
        </div>
      </section>

      <section className="pb-16">
        <div className="container-tight">
          <h2 className="flex items-center gap-2 text-2xl font-display font-bold tracking-tight">
            <FileText className="h-5 w-5 text-warm-400" />
            Документы
          </h2>
          <p className="mt-2 max-w-2xl text-warm-600">
            Условия использования и обработка данных — по этим ссылкам.
          </p>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {legalDocs.map((doc) => (
              <li key={doc.href}>
                <Link
                  href={doc.href}
                  className="block rounded-xl border border-warm-200 bg-white px-4 py-3 text-warm-800 hover:border-brand-300"
                >
                  {doc.label}
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-sm text-warm-500">
            Вопросы по сервису — на{" "}
            <a
              href={`mailto:${supportEmail}`}
              className="underline decoration-warm-300 underline-offset-4 hover:decoration-brand-500"
            >
              {supportEmail}
            </a>
            . Канал в Telegram:{" "}
            <a
              href={TELEGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-warm-300 underline-offset-4 hover:decoration-brand-500"
            >
              {TELEGRAM_URL.replace("https://", "")}
            </a>
            .
          </p>
        </div>
      </section>
    </>
  );
}