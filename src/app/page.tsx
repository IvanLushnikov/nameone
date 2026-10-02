import type { Metadata } from "next";
import { Hero } from "@/components/landing/Hero";
import { WeeklyTopicBlock } from "@/components/landing/WeeklyTopic";
import { MaterialsBankBlock } from "@/components/landing/MaterialsBankBlock";
import { RealStats } from "@/components/landing/Stats";
import { Features } from "@/components/landing/Features";
import { Seasonal } from "@/components/landing/Seasonal";
import { Comparison } from "@/components/landing/Comparison";
import { Subjects } from "@/components/landing/Subjects";
import { PricingTeaser } from "@/components/landing/PricingTeaser";
import { FAQ } from "@/components/landing/FAQ";
import { CTA } from "@/components/landing/CTA";
import { PageTracker } from "@/components/shared/PageTracker";
import { JsonLd } from "@/components/seo";
import { faqItems, stripMarkdown } from "@/lib/content/landing-seo";
import { SITE_URL, SUPPORT_EMAIL } from "@/lib/site";

// TZ-10 §9.2: JSON-LD Organization + WebSite с SearchAction (для sitelinks-searchbox в Яндексе).
// Базовый URL берётся из общего модуля, а не из литерала здесь: локальная копия
// константы жила отдельно от `src/lib/site.ts` и продолжала указывать на
// нерезолвящийся rabochielisty.ru, даже когда его выносили в переменную окружения.
// Тот же принцип у контактов — адрес поддержки не зашит в разметку.

// TZ-10 §5.4 / §9.6: og:image для главной — статичный PNG (TZ-10 Этап 3, вариант B).
// Edge route `src/app/og/[...slug]/route.tsx` остаётся для будущей миграции на
// OpenNext / @cloudflare/next-on-pages, но в `output: "export"` не работает —
// поэтому при static-export og:image идёт на готовый PNG из public/og/.
export const metadata: Metadata = {
  openGraph: {
    images: [
      {
        url: `${SITE_URL}/og/default.png`,
        width: 1200,
        height: 630,
        alt: "РабочиеЛисты AI — рабочие листы по ФГОС",
      },
    ],
  },
};

const homeJsonLd = [
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "РабочиеЛисты AI",
    url: SITE_URL,
    description:
      "Генератор рабочих листов по ФГОС для учителей 1-11 классов",
    // logo: закомментировано — public/logo.png пока не залит (TZ-10 §5.2 P0).
    // logo: `${SITE_URL}/logo.png`,
    sameAs: [],
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer support",
      email: SUPPORT_EMAIL,
      availableLanguage: ["Russian"],
    },
  },
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "РабочиеЛисты AI",
    url: SITE_URL,
    inLanguage: "ru-RU",
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${SITE_URL}/constructor?subject={search_term_string}`,
      },
      // Парсер schema.org ожидает "query-input" именно в таком виде.
      "query-input": "required name=search_term_string",
    },
  },
  /**
   * FAQPage — разметка девяти вопросов, которые и так видны на главной.
   *
   * Раньше разметка была написана и лежала в `FaqBlock.tsx`, но не была
   * подключена нигде: на странице темы её отключили из-за таймаутов
   * static generation, а на главную не включили. Из-за этого вопросы про
   * бесплатные генерации и безопасность не могли попасть в расширенные
   * сниппеты.
   *
   * Текст берём из того же массива, что рисует компонент FAQ, и чистим
   * markdown через `stripMarkdown` — иначе в `question.name` уехали бы
   * звёздочки от `**жирного**` и обратные кавычки от `кода`.
   */
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqItems.map((item) => ({
      "@type": "Question",
      name: stripMarkdown(item.q),
      acceptedAnswer: { "@type": "Answer", text: stripMarkdown(item.a) },
    })),
  },
];

export default function Home() {
  return (
    <>
      <JsonLd id="ld-home" data={homeJsonLd} />
      <Hero />
      <RealStats />
      <Features />
      <Seasonal />
      <Subjects />
      <Comparison />
      <PricingTeaser />
      <FAQ />
      <WeeklyTopicBlock />
      <MaterialsBankBlock />
      <CTA />
      <PageTracker eventName="landing_view" data={{ source: "home" }} />
    </>
  );
}