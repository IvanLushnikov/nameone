import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Sparkles, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { WEEKLY_TOPICS, getWeeklyTopicBySeoSlug } from "@/lib/content/weekly-topics";
import { SITE_URL } from "@/lib/site";

type Props = { params: { slug: string } };

export function generateStaticParams() {
  return WEEKLY_TOPICS.map((t) => ({ slug: t.seoSlug }));
}

export function generateMetadata({ params }: Props): Metadata {
  const topic = getWeeklyTopicBySeoSlug(params.slug);
  if (!topic) return { title: "Тема не найдена" };

  // Бренд в конце не дописываем — его добавляет template в корневом layout.
  const title = `${topic.title} — рабочие листы · ${topic.grade} класс`;
  const description = `${topic.whyText.slice(0, 140)} Сгенерируйте рабочий лист за 30 секунд.`;
  const canonical = `${SITE_URL}/theme/${topic.seoSlug}/`;

  return {
    title,
    description,
    keywords: [
      `${topic.title} ${topic.grade} класс`,
      "рабочий лист",
      "ФГОС",
      topic.subject,
    ],
    alternates: { canonical },
    openGraph: { title, description, url: canonical },
  };
}

export default function ThemePage({ params }: Props) {
  const topic = getWeeklyTopicBySeoSlug(params.slug);
  if (!topic) notFound();

  const subjectHubHref = `/subject/${topic.subject}/`;
  const ctaHref = `/subject/${topic.subject}/${topic.grade}/${topic.topicSlug}`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: topic.title,
    description: topic.whyText,
    keywords: "рабочие листы, ФГОС",
    inLanguage: "ru-RU",
  };

  const related = WEEKLY_TOPICS.filter((t) => t.seoSlug !== topic.seoSlug).slice(0, 6);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <section className="relative bg-gradient-to-b from-warm-50 to-white pt-8 sm:pt-12 pb-10">
        <div className="container-tight">
          <div className="max-w-3xl">
            <Badge tone="brand">{topic.weekLabel}</Badge>
            <h1 className="mt-4 text-3xl sm:text-4xl font-display font-bold tracking-tight text-warm-950">
              {topic.title}
            </h1>
            <p className="mt-4 text-base sm:text-lg text-warm-700 leading-relaxed">
              {topic.whyText}
            </p>

            <div className="mt-6 rounded-2xl border border-brand-100 bg-brand-50/40 p-5 sm:p-6">
              <p className="text-sm font-semibold text-warm-900 mb-3">
                Что вы получите
              </p>
              <ul className="space-y-2 text-sm text-warm-700">
                <li>• PDF за 30 секунд — без Word и шаблонов</li>
                <li>• По ФГОС 2021, привязка к конкретному разделу</li>
                <li>• Для {topic.grade} класса, по программе</li>
                <li>• С ответами — самопроверка за минуту</li>
                <li>• Без рекламы, без воды</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="py-12 sm:py-16">
        <div className="container-tight">
          <div className="rounded-2xl border border-brand-100 bg-brand-50/60 p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <p className="text-base sm:text-lg text-warm-800 leading-snug sm:max-w-xl">
              Нужны рабочие листы по&nbsp;другим темам?{" "}
              <Link
                href={subjectHubHref}
                className="text-brand-600 hover:text-brand-700 font-semibold underline-offset-2 hover:underline"
              >
                Все рабочие листы по&nbsp;предмету
              </Link>
              .
            </p>
            <Link
              href={ctaHref}
              className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-xl bg-brand-500 text-white font-medium shadow-brand hover:bg-brand-600 active:bg-brand-700 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand-500 whitespace-nowrap"
            >
              <Sparkles className="w-4 h-4" aria-hidden />
              <span>Открыть тему в&nbsp;конструкторе</span>
              <ArrowRight className="w-4 h-4" aria-hidden />
            </Link>
          </div>

          <div className="mt-12">
            <h2 className="text-2xl font-display font-bold mb-4">
              Другие темы недели
            </h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {related.map((t) => (
                <Link
                  key={t.slug}
                  href={`/theme/${t.seoSlug}/`}
                  className="group block rounded-xl border border-warm-100 bg-white p-4 hover:shadow-soft hover:-translate-y-0.5 transition-all"
                >
                  <Badge tone="warm" className="mb-2">
                    {t.weekLabel}
                  </Badge>
                  <h3 className="font-medium text-warm-950 group-hover:text-brand-700 transition-colors line-clamp-2">
                    {t.title}
                  </h3>
                  <div className="mt-2 text-xs text-warm-500">
                    {t.subject} · {t.grade} класс
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
