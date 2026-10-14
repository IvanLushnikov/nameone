import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Breadcrumb } from "@/components/seo";
import { Card } from "@/components/ui/Card";
import { PageTracker } from "@/components/shared/PageTracker";
import { ReviewsBlock } from "@/components/trust/ReviewsBlock";
import { DetailRow } from "@/components/trust/DetailRow";
import {
  catalogStats,
  examTasksWord,
  examplesWord,
  gradeRange,
  launchDate,
  operator,
  NEEDS_FILL_LABEL,
  subjectGradesWord,
  subjectsWord,
  topicsWord,
  umkDative,
} from "@/lib/content/trust";
import { SITE_URL } from "@/lib/site";
import { clipDescription, ogImages, twitterCard } from "@/lib/seo/metadata";

/**
 * О сервисе.
 *
 * Страница отвечает на три вопроса, которые задаёт учитель перед оплатой:
 * кто это делает, что уже работает и по каким правилам составлены задания.
 *
 * ## Что здесь не выдумано
 *
 * - Все числа — из таксономии (`catalogStats`), а не вписаны строкой: они
 *   пересчитываются на каждой сборке и не могут разойтись с кодом.
 * - Дата запуска, имена и фото команды помечены как «[вписывает владелец]».
 *   Точной даты запуска в проекте нет, а выдуманная дата в разделе «Кто мы» —
 *   это именно та выдумка, ради которой страницу и делали.
 * - Отзывов нет: блок `ReviewsBlock` при пустом источнике не рисует ничего.
 */

const canonicalUrl = `${SITE_URL}/about/`;

export const metadata: Metadata = {
  title: "О сервисе — кто делает УчЛист и что в нём уже есть",
  description: clipDescription(
    `УчЛист — генератор рабочих листов по ФГОС для учителей ${gradeRange} классов. ${catalogStats.subjects} ${subjectsWord}, ${catalogStats.topics} ${topicsWord}, ${catalogStats.examTasks} ${examTasksWord} заданий ОГЭ и ЕГЭ, реквизиты исполнителя и контакты.`,
  ),
  alternates: { canonical: canonicalUrl },
  openGraph: {
    title: "О сервисе УчЛист",
    description: clipDescription(
      `${catalogStats.subjects} ${subjectsWord}, ${catalogStats.topics} ${topicsWord} и ${catalogStats.examTasks} ${examTasksWord} заданий ОГЭ и ЕГЭ. Кто делает сервис, как устроена методика, куда писать.`,
    ),
    url: canonicalUrl,
    siteName: "УчЛист",
    locale: "ru_RU",
    images: ogImages(undefined, "О сервисе УчЛист"),
  },
  twitter: twitterCard(undefined),
};

/** Четыре числа, которые действительно посчитаны в коде. */
const facts = [
  { value: catalogStats.subjects, label: `${subjectsWord} в таксономии` },
  { value: catalogStats.topics, label: `${topicsWord} с примерами заданий` },
  { value: catalogStats.examples, label: `${examplesWord} заданий с ответами` },
  { value: catalogStats.examTasks, label: `${examTasksWord} заданий ОГЭ и ЕГЭ` },
];

export default function AboutPage() {
  return (
    <>
      <PageTracker eventName="about_view" />

      <section className="bg-gradient-to-b from-warm-50 to-white pt-12 pb-14 sm:pt-16">
        <div className="container-tight">
          <Breadcrumb
            className="mb-4 flex flex-wrap items-center text-sm"
            items={[
              { name: "Главная", url: "/" },
              { name: "О сервисе", url: "" },
            ]}
          />
          <h1 className="text-4xl font-display font-bold tracking-tight sm:text-5xl">
            О сервисе
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-warm-600">
            УчЛист собирает рабочие листы, тесты и контрольные по школьной
            программе. Учитель выбирает предмет, класс и тему — лист выходит в
            PDF с ответами.
          </p>
        </div>
      </section>

      <section className="pb-12">
        <div className="container-tight">
          <h2 className="text-2xl font-display font-bold tracking-tight">
            Что уже собрано
          </h2>
          <p className="mt-2 max-w-2xl text-warm-600">
            Эти числа считаются из таксономии при сборке, а не вписаны в текст.
            Они меняются вместе с базой тем.
          </p>
          <dl className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {facts.map((fact) => (
              <Card key={fact.label}>
                <dd className="text-3xl font-bold text-warm-950">{fact.value}</dd>
                <dt className="mt-1 text-sm text-warm-600">{fact.label}</dt>
              </Card>
            ))}
          </dl>
          <p className="mt-4 text-sm text-warm-500">
            Всего {catalogStats.subjectGrades} {subjectGradesWord} «предмет и
            класс», темы распределены по {gradeRange} классам. У{" "}
            {catalogStats.topicsWithSection} {topicsWord} проставлена ссылка на
            раздел ФГОС. По {catalogStats.umkEntries} {umkDative} из
            федерального перечня темы привязаны к конкретному УМК.
          </p>
        </div>
      </section>

      <section className="pb-12">
        <div className="container-tight">
          <Card className="border-brand-200 bg-brand-50/40">
            <h2 className="text-2xl font-display font-bold tracking-tight">
              По каким методикам составлены задания
            </h2>
            <ul className="mt-4 space-y-3 text-warm-700">
              <li>
                Требования ФГОС 2021 для 1–9 классов и действующего ФГОС СОО для
                10–11. Раздел программы у темы хранится рядом с темой, а не
                остаётся в голове у модели.
              </li>
              <li>
                Если школа работает по конкретному учебнику, тема привязывается к
                нему: список УМК взят из федерального перечня учебников, для
                каждого указаны классы, где он используется.
              </li>
              <li>
                Для ОГЭ и ЕГЭ задания выстроены по кодификатору ФИПИ: номер
                задания, его формулировка и раздел, который оно проверяет.
              </li>
              <li>
                Сложность задаётся учителем и держится трёхступенчатой рамкой:
                один навык, два шага, несколько шагов.
              </li>
            </ul>
            <Link
              href="/methodology/"
              className="mt-6 inline-flex items-center gap-1.5 font-medium text-brand-700 hover:text-brand-800"
            >
              Как устроена сборка листа
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Card>
        </div>
      </section>

      <section className="pb-12">
        <div className="container-tight grid gap-8 lg:grid-cols-2">
          <div>
            <h2 className="text-2xl font-display font-bold tracking-tight">Кто это делает</h2>
            <p className="mt-3 text-warm-700">
              За проектом один человек: он же принимает оплату, отвечает на
              письма и читает задания, которые выдаёт модель. Отдельной команды
              методистов, которая проверяла бы каждый лист, у нас нет.
            </p>
            <dl className="mt-5">
              <DetailRow label="Кто" value={NEEDS_FILL_LABEL} />
              <DetailRow label="Режим работы" value={operator.regime} />
              <DetailRow label="Запуск" value={launchDate} />
            </dl>
            <p className="mt-4 text-sm text-warm-500">
              Часть сведений о проекте не опубликована. Это осознанно:
              придуманные данные о проекте хуже пустого места.
            </p>
            <Link
              href="/contact/"
              className="mt-4 inline-flex items-center gap-1.5 font-medium text-brand-700 hover:text-brand-800"
            >
              Контакты и реквизиты
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {/* Фото автора: файла в проекте нет, и подставлять чужую картинку
              нельзя. Пока фото нет, показываем явную пометку. */}
          <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-warm-300 bg-warm-100/60 p-8 text-center">
            <span className="rounded-md border border-dashed border-accent-300 bg-accent-50/60 px-2 py-0.5 font-mono text-sm text-accent-700">
              {NEEDS_FILL_LABEL}
            </span>
            <p className="mt-3 max-w-sm text-sm text-warm-600">
              Фотографии автора проекта у нас нет. Как появится — поставим здесь.
            </p>
          </div>
        </div>
      </section>

      {/* Отзывы. При пустом источнике `ReviewsBlock` не рисует ничего,
          включая заголовок раздела. */}
      <ReviewsBlock />

      <section className="pb-16">
        <div className="container-tight">
          <div className="flex flex-wrap gap-3">
            <Link
              href="/subject/"
              className="rounded-xl border border-warm-200 bg-white px-4 py-2.5 text-sm font-medium text-warm-800 hover:border-brand-300"
            >
              Посмотреть предметы
            </Link>
            <Link
              href="/methodology/"
              className="rounded-xl border border-warm-200 bg-white px-4 py-2.5 text-sm font-medium text-warm-800 hover:border-brand-300"
            >
              Методика сборки
            </Link>
            <Link
              href="/contact/"
              className="rounded-xl border border-warm-200 bg-white px-4 py-2.5 text-sm font-medium text-warm-800 hover:border-brand-300"
            >
              Контакты
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}