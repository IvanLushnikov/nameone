import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ArrowRight, Sparkles } from "lucide-react";
import { subjects, getSubject } from "@/lib/content/subjects";
import type { Grade, Subject as SubjectType } from "@/lib/types";

type Props = { params: { subject: string } };

export function generateStaticParams() {
  return subjects.map((s) => ({ subject: s.slug }));
}

export function generateMetadata({ params }: Props): Metadata {
  const subject = getSubject(params.subject);
  if (!subject) return { title: "Предмет не найден" };
  const title = `Рабочие листы по ${subject.title.toLowerCase()} — 1-${subject.grades[subject.grades.length - 1].num} класс`;
  const description = `AI-генератор рабочих листов и тестов по ${subject.title.toLowerCase()}. ${subject.grades.length} классов, ${subject.grades.reduce((s: number, g: Grade) => s + g.topics.length, 0)} тем. PDF с ответами за 30 секунд.`;
  const base = "https://rabochielisty.ru";
  const canonicalUrl = `${base}/subject/${subject.slug}`;
  return {
    title,
    description,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      type: "article",
      title,
      description,
      url: canonicalUrl,
      siteName: "РабочиеЛисты AI",
      locale: "ru_RU",
      // TZ-10 §5.4 / §9.6: og:image — статичный PNG (TZ-10 Этап 3, вариант B).
      // Edge route оставлен для будущей миграции, но static-export не работает с Edge runtime.
      images: [
        {
          url: `${base}/og/${subject.slug}.png`,
          width: 1200,
          height: 630,
          alt: `${subject.title} — рабочие листы по ФГОС`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      // TZ-10 §5.4: Twitter image для соцсетей.
      images: [`${base}/og/${subject.slug}.png`],
    },
  };
}

export default function SubjectHubPage({ params }: Props) {
  const subject: SubjectType | undefined = getSubject(params.subject);
  if (!subject) return notFound();

  const colorMap = {
    brand: "from-brand-500 to-brand-700",
    accent: "from-accent-500 to-accent-700",
    warm: "from-warm-700 to-warm-900",
    info: "from-blue-500 to-blue-700",
  };

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-b from-warm-50 to-white pt-12 sm:pt-16 pb-12">
        <div className="absolute inset-0 -z-10 bg-grid opacity-50" />
        <div className="container-tight">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 mb-4">
              <Link href="/" className="text-sm text-warm-500 hover:text-warm-900">
                Главная
              </Link>
              <span className="text-warm-300">/</span>
              <span className="text-sm text-warm-700">{subject.title}</span>
            </div>
            <Badge tone="brand" className="mb-4">
              <Sparkles className="w-3 h-3" />
              {subject.grades.length} классов · {subject.grades.reduce((s: number, g: Grade) => s + g.topics.length, 0)} тем
            </Badge>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-display font-bold tracking-tight text-balance">
              Рабочие листы по{" "}
              <span className={`bg-gradient-to-br ${colorMap[subject.color]} bg-clip-text text-transparent`}>
                {subject.title.toLowerCase()}
              </span>
            </h1>
            <p className="mt-5 text-lg text-warm-600 text-pretty max-w-2xl">
              {subject.description} Задания по ФГОС, готовый PDF с ответами и пояснениями — за 30 секунд.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Button
                as="link"
                href={`/constructor?subject=${subject.slug}`}
                variant="primary"
                size="lg"
                leftIcon={<Sparkles className="w-4 h-4" />}
              >
                Создать лист по {subject.shortTitle.toLowerCase()}
              </Button>
              <Button as="link" href="/pricing" variant="secondary" size="lg">
                Тарифы
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Grades grid */}
      <section className="py-12 sm:py-16">
        <div className="container-tight">
          <h2 className="text-2xl font-display font-bold mb-6">Выберите класс</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {subject.grades.map((g) => (
              <Link
                href={`/subject/${subject.slug}/${g.num}`}
                className="group"
                key={g.num}
              >
                <Card hover className="text-center">
                  <div className="text-4xl font-bold text-warm-950 group-hover:text-brand-600 transition-colors">
                    {g.num}
                  </div>
                  <div className="text-xs text-warm-500 mt-1">{g.topics.length} тем</div>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Popular topics by grade */}
      <section className="py-12 sm:py-16 bg-warm-50 border-y border-warm-100">
        <div className="container-tight">
          <h2 className="text-2xl font-display font-bold mb-2">Популярные темы</h2>
          <p className="text-warm-600 mb-6">Что чаще всего ищут репетиторы и родители</p>

          <div className="space-y-8">
            {subject.grades.slice(0, 4).map((g) => (
              <div key={g.num}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-semibold text-warm-950">
                    {g.num} класс
                  </h3>
                  <Link
                    href={`/subject/${subject.slug}/${g.num}`}
                    className="text-sm text-brand-600 hover:text-brand-700 font-medium inline-flex items-center gap-1"
                  >
                    Все темы класса
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {g.topics.slice(0, 6).map((t) => (
                    <Link
                      key={t.slug}
                      href={`/subject/${subject.slug}/${g.num}/${t.slug}`}
                      className="group"
                    >
                      <Card hover className="h-full">
                        <h4 className="font-medium text-sm text-warm-950 group-hover:text-brand-700 transition-colors">
                          {t.title}
                        </h4>
                        {t.fgosRef && (
                          <div className="text-xs text-warm-500 mt-1">ФГОС {t.fgosRef}</div>
                        )}
                        <p className="text-xs text-warm-600 mt-2 line-clamp-2">
                          {t.examples[0]?.text}
                        </p>
                      </Card>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-12 sm:py-16">
        <div className="container-tight max-w-3xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-display font-bold tracking-tight">
            Не нашли нужную тему?
          </h2>
          <p className="mt-3 text-warm-600">
            Напишите в генераторе — AI сгенерирует лист по любой теме. Без шаблонов, под ваш уровень.
          </p>
          <Button
            as="link"
            href={`/constructor?subject=${subject.slug}`}
            variant="primary"
            size="xl"
            className="mt-6"
            leftIcon={<Sparkles className="w-5 h-5" />}
          >
            Создать лист
          </Button>
        </div>
      </section>
    </>
  );
}