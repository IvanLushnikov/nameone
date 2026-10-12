import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ArrowRight, GraduationCap, ListChecks } from "lucide-react";
import { Breadcrumb, JsonLd } from "@/components/seo";
import { absoluteUrl, clipDescription, ogImages, twitterCard } from "@/lib/seo/metadata";
import { plural } from "@/lib/utils/cn";
import {
  EXAM_HUBS,
  EXAM_KINDS,
  countNumbers,
  subjectLabel,
  subjectsOfExam,
} from "@/components/exam/hub-data";

/**
 * Хаб экзаменов `/exam/` — точка входа в раздел.
 *
 * До этой страницы в разделе был только маршрут `/exam/[exam]/[subject]/[number]`,
 * поэтому `/exam/` и `/exam/oge/` отдавали 404, а все 218 страниц заданий
 * оставались сиротами: входящая ссылка на них была ровно одна, внутри самих
 * страниц заданий.
 *
 * Маршрут `/oge/` не переименовывается: там накоплен вес. Хаб и `/oge/`
 * ссылаются друг на друга.
 *
 * Статический экспорт: страница полностью статична, `generateStaticParams`
 * не нужен.
 */

const ALL_SUBJECTS_COUNT = countNumbers(
  EXAM_KINDS.flatMap((kind) => subjectsOfExam(kind)),
);

const title = "Задания ОГЭ и ЕГЭ по номерам ФИПИ";
const description = clipDescription(
  `Все ${ALL_SUBJECTS_COUNT} ${plural(ALL_SUBJECTS_COUNT, "задание", "задания", "заданий")} ОГЭ и ЕГЭ, разложенные по предметам и номерам ФИПИ. Откройте номер — конструктор подставит его в лист.`,
);

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: absoluteUrl("/exam") },
  openGraph: {
    type: "website",
    title,
    description,
    url: absoluteUrl("/exam"),
    siteName: "УчЛист",
    locale: "ru_RU",
    images: ogImages(undefined, "УчЛист — задания ОГЭ и ЕГЭ по номерам"),
  },
  twitter: twitterCard(undefined),
};

// CollectionPage + ItemList: два экзамена одной выдачей, а не двумя
// сиротскими страницами.
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  name: title,
  description,
  inLanguage: "ru-RU",
  url: absoluteUrl("/exam"),
  mainEntity: {
    "@type": "ItemList",
    itemListElement: EXAM_KINDS.map((kind, idx) => {
      const hub = EXAM_HUBS[kind];
      const subjects = subjectsOfExam(kind);
      return {
        "@type": "ListItem",
        position: idx + 1,
        name: `${hub.full} — ${countNumbers(subjects)} ${plural(countNumbers(subjects), "задание", "задания", "заданий")}`,
        url: absoluteUrl(`/exam/${kind}`),
      };
    }),
  },
};

export default function ExamIndexPage() {
  return (
    <>
      <JsonLd id="ld-exam-index" data={jsonLd} />

      <section className="relative bg-gradient-to-b from-warm-50 to-white pt-8 sm:pt-12 pb-12">
        <div className="absolute inset-0 -z-10 bg-grid opacity-50" />
        <div className="container-tight">
          <Breadcrumb
            className="flex flex-wrap items-center text-sm mb-5"
            items={[
              { name: "Главная", url: "/" },
              // Последний уровень — текущая страница, без ссылки.
              { name: "Экзамены", url: "" },
            ]}
          />

          <Badge tone="brand" className="mb-4">
            <GraduationCap className="w-3 h-3" />
            ОГЭ и ЕГЭ
          </Badge>

          <h1 className="text-3xl sm:text-5xl font-display font-bold tracking-tight max-w-3xl">
            Задания экзамена по номерам
          </h1>
          <p className="mt-4 text-warm-600 max-w-2xl">
            Номера те же, что в кодификаторе ФИПИ. Выберите экзамен, потом
            предмет и номер — конструктор откроется с уже выбранным заданием.
          </p>
        </div>
      </section>

      <section className="pb-16">
        <div className="container-tight">
          <div className="grid sm:grid-cols-2 gap-4">
            {EXAM_KINDS.map((kind) => {
              const hub = EXAM_HUBS[kind];
              const subjects = subjectsOfExam(kind);
              const total = countNumbers(subjects);
              return (
                <Card key={kind} hover className="flex flex-col">
                  <Badge tone="warm" className="mb-3 self-start">
                    {hub.grade}
                  </Badge>
                  <h2 className="text-2xl font-display font-bold tracking-tight">
                    {hub.full}
                  </h2>
                  <p className="mt-2 text-warm-600 text-sm">
                    {subjects.length}{" "}
                    {plural(subjects.length, "предмет", "предмета", "предметов")},{" "}
                    {total} {plural(total, "задание", "задания", "заданий")}
                  </p>

                  <ul className="mt-4 text-sm text-warm-600 space-y-1">
                    {subjects.map((s) => (
                      <li key={s.slug}>
                        {s.emoji} {subjectLabel(s)} — {s.numbers.length}{" "}
                        {plural(s.numbers.length, "задание", "задания", "заданий")}
                      </li>
                    ))}
                  </ul>

                  <Link
                    href={`/exam/${kind}/`}
                    className="mt-6 inline-flex items-center gap-2 font-semibold text-brand-700 hover:text-brand-800"
                  >
                    <ListChecks className="w-4 h-4" />
                    Все задания {hub.full}
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </Card>
              );
            })}
          </div>

          {/* Старый адрес живёт и набирает вес — ходим в него и обратно. */}
          <Card className="mt-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <p className="text-warm-700">
                Нужен не отдельный номер, а целый вариант с таймером? Он в
                тренажёре.
              </p>
              <Link
                href="/oge/"
                className="inline-flex items-center gap-2 font-semibold text-brand-700 hover:text-brand-800 shrink-0"
              >
                Открыть тренажёр
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </Card>
        </div>
      </section>
    </>
  );
}