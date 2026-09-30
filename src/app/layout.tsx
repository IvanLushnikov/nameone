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
    default: "РабочиеЛисты AI — рабочие листы по ФГОС за 30 секунд",
    template: "%s · РабочиеЛисты AI",
  },
  description:
    "Рабочие листы по любому предмету 1-11 класс за 30 секунд. PDF с ответами по ФГОС 2021 (1-9), ФГОС СОО с 01.09.2027 (10-11). Без регистрации — 3 бесплатно.",
  keywords: [
    "рабочий лист",
    "карточки по математике",
    "задания по ФГОС",
    "тест по русскому",
    "тренажёр",
    "подготовка к ОГЭ",
    "вариант ЕГЭ",
    "ФГОС 2021",
    "репетитор",
  ],
  authors: [{ name: "РабочиеЛисты AI" }],
  creator: "РабочиеЛисты AI",
  openGraph: {
    type: "website",
    locale: "ru_RU",
    title: "РабочиеЛисты AI — рабочие листы по ФГОС за 30 секунд",
    description:
      "Рабочие листы по любому предмету 1-11 класс за 30 секунд. PDF с ответами по ФГОС 2021.",
    siteName: "РабочиеЛисты AI",
  },
  twitter: {
    card: "summary_large_image",
    title: "РабочиеЛисты AI — рабочие листы по ФГОС за 30 секунд",
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
        <div className="flex min-h-screen flex-col">
          <Header />
          <main className="flex-1">{children}</main>
          <Footer />
        </div>
        <Toaster />
        {/* TZ-10 §8.1 / §9.1: Яндекс.Метрика временно отключена для билда — next/script в static export вызывает таймауты. TODO: включить после миграции на Cloudflare SSR / OpenNext, либо использовать inline <script> вместо next/script. */}
        {/* <YandexMetrika counterId={process.env.NEXT_PUBLIC_YM_ID ?? ""} /> */}
      </body>
    </html>
  );
}