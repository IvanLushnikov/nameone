import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ArrowLeft, ArrowRight, GraduationCap } from "lucide-react";
import { Breadcrumb, JsonLd } from "@/components/seo";
import { absoluteUrl, clipDescription, ogImages, twitterCard } from "@/lib/seo/metadata";
import { plural } from "@/lib/utils/cn";
import {
  EXAM_KINDS,
  countNumbers,
  getExamHub,
  subjectLabel,
  subjectListText,
  subjectsOfExam,
} from "@/components/exam/hub-data";

/**
 * Хаб конкретного экзамена: `/exam/oge/` и `/exam/ege/`.
 *
 * На странице лежат все номера заданий этого экзамена, сгруппированные по
 * предметам. Это та точка, ради которой страницы заданий перестают быть
 * сиротами: от главной до любого номера два клика
 * (`/` → `/exam/oge/` → `/exam/oge/math/1/`).
 *
 * Адрес `/oge/` при этом не трогаем — на нём накоплен вес, и он ссылается
 * на этот хаб в обе стороны.
 */

type Props = { params: { exam: string } };

/** По одному параметру на каждый экзамен из таксономии. */
export function generateStaticParams() {
  return EXAM_KINDS.map((exam) => ({ exam }));
}

export function generateMetadata({ params }: Props): Metadata {
  const hub = getExamHub(params.exam);
  if (!hub) {
    return {
      title: "Экзамен не найден",
      robots: { index: false, follow: true },
    };
  }

  const subjects = subjectsOfExam(hub.kind);
  const total = countNumbers(subjects);
  const title = `Задания ${hub.full} по номерам ФИПИ`;
  // Число предметов и список под ним считаются из одного массива `subjects`.
  // Раньше строка была ручной: на `/exam/oge/` обещало «по 5 предметам», а
  // перечисляло четыре — обществознание с 24 страницами выпало, и описание
  // врало о том, что лежит на самой странице.
  const description = clipDescription(
    `Все ${total} ${plural(total, "задание", "задания", "заданий")} ${hub.full} по ${subjects.length} ${plural(subjects.length, "предмету", "предметам", "предметам")}: ${subjectListText(subjects)}.`,
  );

  return {
    title,
    description,
    alternates: { canonical: absoluteUrl(`/exam/${hub.kind}`) },
    openGraph: {
      type: "website",
      title,
      description,
      url: absoluteUrl(`/exam/${hub.kind}`),
      siteName: "УчЛист",
      locale: "ru_RU",
      images: ogImages(undefined, `УчЛист — задания ${hub.full} по номерам ФИПИ`),
    },
    twitter: twitterCard(undefined),
  };
}

export default function ExamHubPage({ params }: Props) {
  const hub = getExamHub(params.exam);
  if (!hub) return notFound();

  const subjects = subjectsOfExam(hub.kind);
  const total = countNumbers(subjects);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `Задания ${hub.full} по номерам ФИПИ`,
    inLanguage: "ru-RU",
    url: absoluteUrl(`/exam/${hub.kind}`),
    educationalLevel: hub.grade,
    about: subjects.map((s) => ({
      "@type": "Thing",
      name: subjectLabel(s),
    })),
  };

  return (
    <>
      <JsonLd id={`ld-exam-hub-${hub.kind}`} data={jsonLd} />

      <section className="relative bg-gradient-to-b from-warm-50 to-white pt-8 sm:pt-12 pb-10">
        <div className="absolute inset-0 -z-10 bg-grid opacity-50" />
        <div className="container-tight">
          <Breadcrumb
            className="flex flex-wrap items-center text-sm mb-5"
            items={[
              { name: "Главная", url: "/" },
              { name: "Экзамены", url: "/exam/" },
              // Последний уровень — текущая страница, без ссылки.
              { name: hub.full, url: "" },
            ]}
          />

          <Badge tone="brand" className="mb-4">
            <GraduationCap className="w-3 h-3" />
            {hub.grade}
          </Badge>

          <h1 className="text-3xl sm:text-5xl font-display font-bold tracking-tight">
            Задания {hub.full}
          </h1>
          <p className="mt-4 text-warm-600 max-w-2xl">
            {subjects.length}{" "}
            {plural(subjects.length, "предмет", "предмета", "предметов")}, {total}{" "}
            {plural(total, "задание", "задания", "заданий")}. Номера — как в
            кодификаторе ФИПИ. Нажмите на номер, чтобы собрать лист по нему.
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
              href={hub.trainerUrl}
              className="inline-flex items-center gap-1.5 font-medium text-brand-700 hover:text-brand-800"
            >
              Тренажёр: целый вариант с таймером
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      <section className="pb-16">
        <div className="container-tight space-y-12">
          {subjects.map((subject) => (
            <div key={subject.slug}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-4">
                <h2 className="text-2xl sm:text-3xl font-display font-bold tracking-tight">
                  <span aria-hidden className="mr-2">
                    {subject.emoji}
                  </span>
                  {subjectLabel(subject)}
                </h2>
                <span className="text-sm text-warm-500">
                  {subject.numbers.length}{" "}
                  {plural(subject.numbers.length, "задание", "задания", "заданий")}
                </span>
              </div>

              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {subject.numbers.map((n) => (
                  <Link
                    key={`${subject.slug}-${n.number}`}
                    href={`/exam/${hub.kind}/${subject.subject}/${n.number}/`}
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
                          {n.fgosRef ? (
                            <p className="mt-1 text-xs text-warm-500">{n.fgosRef}</p>
                          ) : null}
                        </div>
                      </div>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}