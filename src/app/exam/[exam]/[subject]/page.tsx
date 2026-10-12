import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ArrowLeft, ArrowRight, ListChecks } from "lucide-react";
import { Breadcrumb, JsonLd } from "@/components/seo";
import { absoluteUrl, clipDescription, ogImages, twitterCard } from "@/lib/seo/metadata";
import { plural } from "@/lib/utils/cn";
import {
  EXAM_SUBJECTS,
  type ExamSubject,
} from "@/lib/content/exam-taxonomy";
import {
  getExamHub,
  getExamSubject,
  subjectLabel,
} from "@/components/exam/hub-data";

/**
 * Хаб предмета: `/exam/oge/physics/`, `/exam/ege/math-p/` и ещё восемь.
 *
 * Зачем он нужен: на каждой из 218 страниц заданий стоит ссылка «Все задания
 * предмета» именно сюда, а самой страницы не было. Папка `/exam/oge/physics/`
 * собиралась только потому, что внутри неё лежали пронумерованные страницы
 * `1/`, `2/`, …, а `index.html` не было — 218 ссылок вели в 404.
 *
 * Адрес маршрута совпадает с адресом из ссылки на странице задания
 * (`/exam/${item.exam}/${item.subject}/`). Это проверяет тест: если маршрут
 * разъедется со ссылкой, тест снова увидит 218 битых ссылок.
 *
 * Страница не дублирует хаб экзамена: список номеров здесь, раскладка по
 * предметам — на `/exam/[exam]/`, вход в раздел — на `/exam/`.
 */

type Props = { params: { exam: string; subject: string } };

/** По паре параметров на каждый предмет каждого экзамена — 10 страниц. */
export function generateStaticParams() {
  return EXAM_SUBJECTS.map((s) => ({ exam: s.exam, subject: s.subject }));
}

/** Адрес хаба предмета. Один источник истины для ссылок и canonical. */
function hubUrl(exam: string, subject: string): string {
  return `/exam/${exam}/${subject}`;
}

/** Число и слово «задание/задания/заданий» для заголовков и подписей. */
function numbersCountText(subject: ExamSubject): string {
  const n = subject.numbers.length;
  return `${n} ${plural(n, "задание", "задания", "заданий")}`;
}

export function generateMetadata({ params }: Props): Metadata {
  const hub = getExamHub(params.exam);
  const subject = getExamSubject(params.exam, params.subject);
  if (!hub || !subject) {
    return {
      title: "Предмет не найден",
      robots: { index: false, follow: true },
    };
  }

  const label = subjectLabel(subject);
  const url = absoluteUrl(hubUrl(hub.kind, subject.subject));
  const title = `Задания ${hub.full} по предмету «${label}»`;
  // Первый и последний номер — границы, а не выдуманная цифра: оба берутся
  // из таксономии.
  const first = subject.numbers[0];
  const last = subject.numbers[subject.numbers.length - 1];
  const description = clipDescription(
    `Все ${numbersCountText(subject)} ${hub.full} по предмету «${label}»: от «${first.title}» до «${last.title}». Номера как в кодификаторе ФИПИ, лист собирается по любому.`,
  );

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      title,
      description,
      url,
      siteName: "УчЛист",
      locale: "ru_RU",
      images: ogImages(undefined, `УчЛист — ${title}`),
    },
    twitter: twitterCard(undefined),
  };
}

export default function ExamSubjectHubPage({ params }: Props) {
  const hub = getExamHub(params.exam);
  const subject = getExamSubject(params.exam, params.subject);
  if (!hub || !subject) return notFound();

  const label = subjectLabel(subject);
  const url = absoluteUrl(hubUrl(hub.kind, subject.subject));

  // ItemList: номера заданий одним списком — так блок попадает в расширенный
  // сниппет вместе с предметом и классом.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `Задания ${hub.full} по предмету «${label}»`,
    inLanguage: "ru-RU",
    url,
    educationalLevel: hub.grade,
    about: { "@type": "Thing", name: label },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: subject.numbers.length,
      itemListElement: subject.numbers.map((n, idx) => ({
        "@type": "ListItem",
        position: idx + 1,
        name: `Задание ${n.number}: ${n.title}`,
        url: absoluteUrl(`${hubUrl(hub.kind, subject.subject)}/${n.number}`),
      })),
    },
  };

  return (
    <>
      <JsonLd id={`ld-exam-subject-${hub.kind}-${subject.subject}`} data={jsonLd} />

      <section className="relative bg-gradient-to-b from-warm-50 to-white pt-8 sm:pt-12 pb-10">
        <div className="absolute inset-0 -z-10 bg-grid opacity-50" />
        <div className="container-tight">
          <Breadcrumb
            className="flex flex-wrap items-center text-sm mb-5"
            items={[
              { name: "Главная", url: "/" },
              { name: "Экзамены", url: "/exam/" },
              { name: hub.full, url: `/exam/${hub.kind}/` },
              // Последний уровень — текущая страница, без ссылки.
              { name: label, url: "" },
            ]}
          />

          <Badge tone="brand" className="mb-4">
            {subject.emoji} {hub.grade}
          </Badge>

          <h1 className="text-3xl sm:text-5xl font-display font-bold tracking-tight">
            Задания {hub.full} — {label}
          </h1>
          <p className="mt-4 text-warm-600 max-w-2xl">
            {numbersCountText(subject)}, номера как в кодификаторе ФИПИ. Откройте
            номер — конструктор откроется с уже выбранным заданием.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <Link
              href="/exam/"
              className="inline-flex items-center gap-1.5 font-medium text-warm-600 hover:text-brand-700"
            >
              <ArrowLeft className="w-4 h-4" />
              Все экзамены
            </Link>
            <Link
              href={`/exam/${hub.kind}/`}
              className="inline-flex items-center gap-1.5 font-medium text-brand-700 hover:text-brand-800"
            >
              Все задания {hub.full}
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      <section className="pb-16">
        <div className="container-tight">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {subject.numbers.map((n) => (
              <Link
                key={`${subject.subject}-${n.number}`}
                href={`${hubUrl(hub.kind, subject.subject)}/${n.number}/`}
                className="group"
              >
                <Card hover className="h-full">
                  <div className="flex items-start gap-3">
                    <Badge tone="brand" className="shrink-0">
                      № {n.number}
                    </Badge>
                    <div className="min-w-0">
                      <p className="font-semibold text-warm-950 group-hover:text-brand-700 transition-colors">
                        {n.title}
                      </p>
                      <p className="mt-1 text-xs text-warm-600 leading-relaxed">
                        {n.description}
                      </p>
                      {n.fgosRef ? (
                        <p className="mt-1 text-xs text-warm-500">{n.fgosRef}</p>
                      ) : null}
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>

          <Card className="mt-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <p className="text-warm-700">
                Нужен не отдельный номер, а целый вариант с таймером? Он в
                тренажёре.
              </p>
              <Link
                href={hub.trainerUrl}
                className="inline-flex items-center gap-2 font-semibold text-brand-700 hover:text-brand-800 shrink-0"
              >
                <ListChecks className="w-4 h-4" />
                Тренажёр
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </Card>
        </div>
      </section>
    </>
  );
}