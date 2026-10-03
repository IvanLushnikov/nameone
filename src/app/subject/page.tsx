import Link from "next/link";
import type { Metadata } from "next";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { JsonLd } from "@/components/seo";
import { ArrowRight, Sparkles } from "lucide-react";
import { subjects } from "@/lib/content/subjects";
import { SITE_URL } from "@/lib/site";
import { plural } from "@/lib/utils/cn";
import type { Grade, Subject } from "@/lib/types";

/**
 * Оглавление всех предметов (/subject).
 *
 * Ссылка «Все предметы» в футере вела на маршрут, которого не было —
 * только динамический /subject/[subject]. Эта страница закрывает 404
 * и отдаёт поисковикам CollectionPage + ItemList по всей таксономии.
 *
 * Статический экспорт: страница полностью статична (только импорт данных),
 * generateStaticParams не нужен.
 */

const colorMap: Record<Subject["color"], string> = {
  brand: "from-brand-500 to-brand-700",
  accent: "from-accent-500 to-accent-700",
  warm: "from-warm-700 to-warm-900",
  info: "from-blue-500 to-blue-700",
};

function subjectTopics(subject: Subject): number {
  return subject.grades.reduce((sum: number, g: Grade) => sum + g.topics.length, 0);
}

const totalTopics = subjects.reduce((sum, s) => sum + subjectTopics(s), 0);

// Окончания склоняем: «21 предмет», но «21 предмет»+n — сюда попадает и SEO,
// поэтому строка уходит и в title, и в description.
const subjectWord = plural(subjects.length, "предмет", "предмета", "предметов");
const topicWord = plural(totalTopics, "тема", "темы", "тем");
const title = `Рабочие листы по ФГОС — ${subjects.length} ${subjectWord}`;
const description = `Все ${subjects.length} ${subjectWord} школьной программы: ${totalTopics}+ ${topicWord} по ФГОС, 1-11 класс. Готовый рабочий лист с ответами за 30 секунд.`;

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: `${SITE_URL}/subject` },
  openGraph: {
    type: "website",
    title,
    description,
    url: `${SITE_URL}/subject`,
    siteName: "УчЛист",
    locale: "ru_RU",
    // Отдельного OG-картинки для оглавления нет — берём общий статичный PNG
    // из public/og/ (per-subject лежат рядом, но это витрина всех предметов).
    images: [
      {
        url: `${SITE_URL}/og/default.png`,
        width: 1200,
        height: 630,
        alt: "УчЛист — рабочие листы по ФГОС для всех предметов",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [`${SITE_URL}/og/default.png`],
  },
};

// CollectionPage + ItemList: поисковик видит все предметы одной выдачей.
const jsonLd = [
  {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: title,
    description,
    url: `${SITE_URL}/subject`,
    inLanguage: "ru-RU",
    isPartOf: {
      "@type": "WebSite",
      name: "УчЛист",
      url: SITE_URL,
    },
  },
  {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Предметы школьной программы",
    numberOfItems: subjects.length,
    itemListElement: subjects.map((s, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: s.title,
      url: `${SITE_URL}/subject/${s.slug}`,
    })),
  },
];

export default function SubjectsIndexPage() {
  return (
    <>
      <JsonLd id="ld-subjects" data={jsonLd} />

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-b from-warm-50 to-white pt-12 sm:pt-16 pb-12">
        <div className="absolute inset-0 -z-10 bg-grid opacity-50" />
        <div className="container-tight">
          <div className="max-w-3xl">
            <nav className="flex items-center gap-2 mb-4">
              <Link href="/" className="text-sm text-warm-500 hover:text-warm-900">
                Главная
              </Link>
              <span className="text-warm-300">/</span>
              <span className="text-sm text-warm-700">Все предметы</span>
            </nav>
            <Badge tone="brand" className="mb-4">
              <Sparkles className="w-3 h-3" />
              {subjects.length} {subjectWord} · {totalTopics}+ {topicWord}
            </Badge>
            <h1 className="text-4xl sm:text-5xl font-display font-bold tracking-tight text-balance">
              Рабочие листы по ФГОС —{" "}
              <span className="bg-gradient-to-br from-brand-500 to-brand-700 bg-clip-text text-transparent">
                все предметы
              </span>
            </h1>
            <p className="mt-5 text-lg text-warm-600 text-pretty max-w-2xl">
              От окружающего мира в 1 классе до ЕГЭ по обществознанию. Выберите предмет —
              задания по школьной программе, готовый PDF с ответами за 30 секунд.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Button
                as="link"
                href="/constructor"
                variant="primary"
                size="lg"
                leftIcon={<Sparkles className="w-4 h-4" />}
              >
                Создать лист
              </Button>
              <Button as="link" href="/pricing" variant="secondary" size="lg">
                Тарифы
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Сетка предметов */}
      <section className="py-12 sm:py-16">
        <div className="container-tight">
          <h2 className="text-2xl font-display font-bold mb-6">Выберите предмет</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {subjects.map((s) => (
              <Link key={s.slug} href={`/subject/${s.slug}`} className="group">
                <Card hover className="h-full flex flex-col">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <span
                        className={`w-10 h-10 rounded-xl bg-gradient-to-br ${colorMap[s.color]} grid place-items-center text-xl shrink-0`}
                        aria-hidden
                      >
                        {s.emoji}
                      </span>
                      <h3 className="font-semibold text-warm-950 group-hover:text-brand-700 transition-colors">
                        {s.title}
                      </h3>
                    </div>
                    <ArrowRight className="w-4 h-4 text-warm-400 group-hover:text-brand-500 transition-colors shrink-0 mt-2.5" />
                  </div>
                  <p className="mt-3 text-sm text-warm-600 leading-relaxed line-clamp-2">
                    {s.description}
                  </p>
                  <div className="mt-4 pt-3 border-t border-warm-100 flex items-center gap-3 text-xs text-warm-500">
                    <span>{s.grades.length} кл.</span>
                    <span>{subjectTopics(s)} {plural(subjectTopics(s), "тема", "темы", "тем")}</span>
                    <span className="ml-auto font-medium text-brand-600 group-hover:text-brand-700">
                      Открыть
                    </span>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-12 sm:py-16 bg-warm-50 border-y border-warm-100">
        <div className="container-tight max-w-3xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-display font-bold tracking-tight">
            Не нашли нужный предмет?
          </h2>
          <p className="mt-3 text-warm-600">
            Напишите тему в генераторе — AI соберёт лист под ваш класс и уровень учеников.
          </p>
          <Button
            as="link"
            href="/constructor"
            variant="primary"
            size="xl"
            className="mt-6"
            leftIcon={<Sparkles className="w-5 h-5" />}
          >
            Открыть генератор
          </Button>
        </div>
      </section>
    </>
  );
}
