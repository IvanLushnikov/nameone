import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Toaster } from "@/components/ui/Toast";

const inter = Inter({
  subsets: ["latin", "cyrillic"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "ЛистAI — рабочие листы и тесты по ФГОС за 30 секунд",
    template: "%s · ЛистAI",
  },
  description:
    "AI-генератор рабочих листов, тестов и карточек под российскую школьную программу. Готовый PDF с заданиями и ответами за 30 секунд. Без регистрации — 3 бесплатно.",
  keywords: [
    "рабочий лист",
    "карточки по математике",
    "задания по ФГОС",
    "тест по русскому",
    "тренажёр",
    "подготовка к ОГЭ",
    "вариант ЕГЭ",
    "ИИ для учителя",
    "репетитор",
  ],
  authors: [{ name: "ЛистAI" }],
  creator: "ЛистAI",
  openGraph: {
    type: "website",
    locale: "ru_RU",
    title: "ЛистAI — рабочие листы по ФГОС за 30 секунд",
    description:
      "AI-генератор рабочих листов и тестов для школы. Готовый PDF с заданиями и ответами.",
    siteName: "ЛистAI",
  },
  twitter: {
    card: "summary_large_image",
    title: "ЛистAI — рабочие листы по ФГОС за 30 секунд",
    description:
      "AI-генератор рабочих листов и тестов для школы.",
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
      </body>
    </html>
  );
}