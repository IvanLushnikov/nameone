import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Sparkles, ArrowRight, Star, Users, FileText, Layers } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { JsonLd, Breadcrumb } from "@/components/seo";
import { quotedTopic } from "@/lib/utils/cn";
import { MaterialCard } from "@/components/materials/MaterialCard";
import {
  MATERIALS_CATALOG,
  MATERIAL_PURPOSE_LABELS,
  getMaterialBySlug,
  getMaterialsByFilters,
  getTopMaterials,
  materialArtifactLabel,
  materialConstructorHref,
  type MaterialEntry,
} from "@/lib/content/materials-catalog";
import { getSubject, getTopic } from "@/lib/content/subjects";
import { SITE_URL } from "@/lib/site";
import { absoluteUrl, clipDescription, ogImages, twitterCard } from "@/lib/seo/metadata";

type Props = { params: { slug: string } };

/** Все карточки репозитория попадают в статический экспорт. */
export function generateStaticParams() {
  return MATERIALS_CATALOG.map((m) => ({ slug: m.slug }));
}

export function generateMetadata({ params }: Props): Metadata {
  const material = getMaterialBySlug(params.slug);
  if (!material) return { title: "Материал не найден" };

  const subject = getSubject(material.subject);
  // Бренд в конце не дописываем — его добавляет template в корневом layout.
  // Предмет и класс добавлены (theirs, ТЗ-21 п.14): без них 150 карточек
  // давали одинаковые заголовки.
  const title = `${material.title} — ${subject?.shortTitle ?? material.subject}, ${material.grade} класс`;
  // ТЗ-21 п.14: описания материалов шли по 301 знаку из каталога. Режем по
  // границе слова до 150–160 — в сниппете дальше 160 всё равно не видно.
  const description = clipDescription(material.description);
  const canonical = absoluteUrl(`/material/${material.slug}`);

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      type: "article",
      siteName: "УчЛист",
      locale: "ru_RU",
      // ТЗ-21 п.14: og:image по предмету материала (150 страниц шли без картинки).
      images: ogImages(material.subject, material.title),
    },
    twitter: twitterCard(material.subject),
  };
}

/** JSON-LD Article: тот же формат, что на остальных SEO-страницах репы. */
function buildJsonLd(material: MaterialEntry, subjectTitle: string, fgosRef?: string) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: material.title,
    description: material.description,
    inLanguage: "ru-RU",
    dateModified: material.updatedAt,
    author: { "@type": "Organization", name: material.author },
    publisher: {
      "@type": "Organization",
      name: "УчЛист",
      url: SITE_URL,
    },
    isPartOf: {
      "@type": "WebSite",
      name: "УчЛист",
      url: SITE_URL,
    },
    // Столбик d (POSITIONING.md §3): привязка к программе.
    educationalAlignment: {
      "@type": "AlignmentObject",
      alignmentType: "educationalSubject",
      targetName: `${subjectTitle}, ${material.grade} класс`,
      ...(fgosRef ? { educationalFramework: fgosRef } : {}),
    },
  };
}

export default function MaterialPage({ params }: Props) {
  const material = getMaterialBySlug(params.slug);
  if (!material) notFound();

  const subject = getSubject(material.subject);
  const topic = getTopic(material.subject, material.grade, material.topicSlug);
  const ctaHref = materialConstructorHref(material);

  // Похожие: сначала та же цель, потом — самые популярные.
  const samePurpose = getMaterialsByFilters({ purpose: material.purpose }).filter(
    (m) => m.slug !== material.slug,
  );
  const related = (samePurpose.length >= 3 ? samePurpose : getTopMaterials(6).filter((m) => m.slug !== material.slug)).slice(0, 3);

  return (
    <>
      <JsonLd id="ld-material" data={buildJsonLd(material, subject?.title ?? material.subject, topic?.fgosRef)} />

      <section className="relative bg-gradient-to-b from-warm-50 to-white pt-8 sm:pt-12 pb-10">
        <div className="container-tight">
          {/* Хлебные крошки — единый компонент (BreadcrumbList JSON-LD для поиска). */}
          <Breadcrumb
            className="flex flex-wrap items-center text-sm mb-4"
            items={[
              { name: "Банк материалов", url: "/materials/" },
              { name: subject?.title ?? material.subject, url: `/subject/${material.subject}/` },
              // Последний уровень — текущая страница, без ссылки.
              { name: `${material.grade} класс`, url: "" },
            ]}
          />

          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="brand">{MATERIAL_PURPOSE_LABELS[material.purpose]}</Badge>
              <Badge tone="warm">{materialArtifactLabel(material.artifactType)}</Badge>
              {topic?.fgosRef && <Badge tone="info">{topic.fgosRef}</Badge>}
            </div>

            <h1 className="mt-4 text-3xl sm:text-4xl font-display font-bold tracking-tight text-warm-950 text-balance">
              {material.title}
            </h1>

            <p className="mt-4 text-base sm:text-lg text-warm-700 leading-relaxed">
              {material.description}
            </p>

            {/* Социальное доказательство */}
            <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-warm-600">
              <span className="inline-flex items-center gap-1.5">
                <Users className="w-4 h-4 text-brand-500" aria-hidden />
                <strong className="font-semibold text-warm-900">{material.usesCount}</strong>
                {material.usesCount === 1 ? "учитель взял" : "учителей взяли"} в работу
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Star className="w-4 h-4 fill-accent-400 text-accent-400" aria-hidden />
                <strong className="font-semibold text-warm-900">{material.rating.toFixed(1).replace(".", ",")}</strong>
                по оценке {material.ratingCount} учителей
              </span>
              <span className="text-[color:var(--text-muted)]">Обновлён {material.updatedAt}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="pb-12 sm:pb-16">
        <div className="container-tight">
          <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr] items-start">
            {/* Превью первой страницы — в Фазе 1 это статичная плашка-заглушка */}
            <div className="rounded-2xl border border-warm-100 bg-white p-6 sm:p-8 shadow-soft">
              <div className="flex items-center gap-2 text-sm font-medium text-warm-500">
                <FileText className="w-4 h-4" aria-hidden />
                Как выглядит первая страница
              </div>
              <div className="mt-4 space-y-2.5" aria-hidden>
                <div className="h-3 w-3/5 rounded-full bg-warm-200" />
                <div className="h-2.5 w-full rounded-full bg-warm-100" />
                <div className="h-2.5 w-11/12 rounded-full bg-warm-100" />
                <div className="mt-5 h-2.5 w-4/5 rounded-full bg-warm-100" />
                <div className="h-2.5 w-full rounded-full bg-warm-100" />
                <div className="h-2.5 w-2/3 rounded-full bg-warm-100" />
                <div className="mt-5 rounded-xl border border-dashed border-brand-200 bg-brand-50/50 p-4 text-sm text-brand-800">
                  {material.count} заданий · {material.topicTitle}
                </div>
              </div>

              <div className="mt-6 border-t border-warm-100 pt-5">
                <p className="text-sm font-semibold text-warm-900 mb-3">Что вы получите</p>
                <ul className="space-y-2 text-sm text-warm-700">
                  <li>• {material.count} заданий по теме {quotedTopic(material.topicTitle)}</li>
                  <li>• Ответы с разбором — для самопроверки и проверки дома</li>
                  <li>• По программе {material.grade} класса{topic?.fgosRef ? `, раздел «${topic.fgosRef}»` : ""}</li>
                  <li>• Готовый PDF за 30 секунд — без Word и шаблонов</li>
                </ul>
              </div>
            </div>

            {/* CTA в конструктор с подставленными параметрами */}
            <div className="rounded-2xl border border-brand-100 bg-brand-50/50 p-6 sm:p-8">
              <p className="text-xs font-semibold uppercase tracking-wider text-brand-600">
                Бесплатно
              </p>
              <h2 className="mt-2 text-xl font-display font-bold text-warm-950">
                Сгенерировать такой лист
              </h2>
              <p className="mt-3 text-sm text-warm-700 leading-relaxed">
                Откроется конструктор с уже выбранными предметом, классом, темой и форматом.
                Соберёте свой вариант под свой класс за 30 секунд.
              </p>

              <ul className="mt-4 space-y-2 text-sm text-warm-700">
                <li className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-brand-500 shrink-0" aria-hidden />
                  {subject?.title}, {material.grade} класс · {material.topicTitle}
                </li>
                <li className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-brand-500 shrink-0" aria-hidden />
                  {materialArtifactLabel(material.artifactType)}, {material.count} заданий
                </li>
              </ul>

              <Button
                as="link"
                href={ctaHref}
                variant="primary"
                size="lg"
                fullWidth
                className="mt-6"
                leftIcon={<Sparkles className="w-4 h-4" />}
                rightIcon={<ArrowRight className="w-4 h-4" />}
              >
                Сгенерировать такой лист
              </Button>

              <p className="mt-3 text-xs text-warm-500 text-center">
                Лимит бесплатных генераций — в разделе тарифов.
              </p>
            </div>
          </div>

          {related.length > 0 && (
            <div className="mt-12">
              <h2 className="text-2xl font-display font-bold mb-4">
                Материалы с той же целью
              </h2>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {related.map((m) => (
                  <MaterialCard key={m.slug} material={m} />
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
