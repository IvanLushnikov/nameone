import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Toaster } from "@/components/ui/Toast";
import { YandexMetrika } from "@/components/analytics/YandexMetrika";

const inter = Inter({
  subsets: ["latin", "cyrillic"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    // TZ-10 §5.1 / §9.3: сократили с 60 до 52 символов (был впритык к лимиту SERP).
    default: "УчЛист — рабочие листы по ФГОС за 30 секунд",
    template: "%s · УчЛист",
  },
  description:
    "Рабочие листы по любому предмету 1-11 класс за 30 секунд. PDF с ответами по ФГОС 2021 (1-9), ФГОС СОО с 01.09.2027 (10-11). Без регистрации — 3 бесплатно.",
  // ТЗ-21 п.14 / SEO-аудит P1-4: тег `keywords` убран со всех 3 917 страниц.
  // Причина не только в том, что его не учитывают: список из девяти слов в
  // корневом layout наследовался КАЖДОЙ страницей сайта, включая 1 070 тем,
  // где к общему списку добавлялись ещё шесть ключей. Google не учитывает
  // тег с 2009 года, Яндекс официально не использует — а переспамленный
  // набор одинаковых ключей на всём сайте выглядит как спам-сигнал.
  authors: [{ name: "УчЛист" }],
  creator: "УчЛист",
  openGraph: {
    type: "website",
    locale: "ru_RU",
    title: "УчЛист — рабочие листы по ФГОС за 30 секунд",
    description:
      "Рабочие листы по любому предмету 1-11 класс за 30 секунд. PDF с ответами по ФГОС 2021.",
    siteName: "УчЛист",
  },
  twitter: {
    card: "summary_large_image",
    title: "УчЛист — рабочие листы по ФГОС за 30 секунд",
    description:
      "Рабочие листы по любому предмету 1-11 класс за 30 секунд. PDF с ответами по ФГОС 2021.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  themeColor: "#22B37C",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" className={inter.variable}>
      <body className="min-h-screen bg-warm-50 text-warm-950 antialiased font-sans">
        {/* Toaster держит ToastContext.Provider, поэтому всё, что вызывает
            useToast() (в т.ч. страницы в children), обязано быть ВНУТРИ него.
            Иначе тосты уходят в console.warn и пользователь их не видит. */}
        <Toaster>
          <div className="flex min-h-screen flex-col">
            {/* Skip-link: с клавиатуры первой попадает не в меню, а в содержимое.
                До фокуса он спрятан (sr-only), но виден и кликабелен сразу,
                как только на него попал фокус (focus:not-sr-only). */}
            <a
              href="#main"
              className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:inline-flex focus:items-center focus:rounded-xl focus:bg-white focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-warm-950 focus:shadow-soft-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              К содержанию
            </a>
            <Header />
            <main id="main" className="flex-1">{children}</main>
            <Footer />
          </div>
        </Toaster>
        {/* TZ-10 §8.1 / §9.1: Яндекс.Метрика, счётчик 113327591.
            Раньше был отключён из-за next/script при статическом экспорте;
            теперь это обычный инлайновый <script> (см. YandexMetrika.tsx),
            который попадает в HTML на этапе сборки. */}
        <YandexMetrika />
      </body>
    </html>
  );
}