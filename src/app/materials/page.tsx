import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Sparkles, Layers, BookOpen } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { MaterialCard } from "@/components/materials/MaterialCard";
import {
  MATERIALS_CATALOG,
  MATERIAL_PURPOSE_HINTS,
  MATERIAL_PURPOSE_LABELS,
  MATERIAL_PURPOSE_ORDER,
  getMaterialsByPurpose,
  getSubjectCounts,
  getTopMaterials,
} from "@/lib/content/materials-catalog";
import { getSubject, subjects } from "@/lib/content/subjects";
import { getUMK } from "@/lib/content/umk";
import { umkEntryLabel } from "@/lib/content/landing-seo";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  // «· УчЛист» дописывает шаблон из корневого layout.
  title: "Банк материалов — готовые рабочие листы по ФГОС",
  description:
    "Каталог готовых материалов для учителя: контрольные, рабочие листы, интерактивы, конспекты уроков и презентации по предметам школьной программы. Каждый материал можно пересобрать под свой класс за 30 секунд.",
  alternates: { canonical: `${SITE_URL}/materials/` },
  openGraph: {
    title: "Банк материалов — готовые рабочие листы по ФГОС",
    description:
      "Каталог готовых материалов для учителя: контрольные, рабочие листы, интерактивы, конспекты уроков и презентации по школьной программе.",
    url: `${SITE_URL}/materials/`,
  },
};

/** Избранные темы — самые востребованные темы каталога. */
const featuredTopics = (() => {
  const counts = new Map<string, { topicSlug: string; topicTitle: string; subject: string; grade: number; hits: number }>();
  for (const m of MATERIALS_CATALOG) {
    const key = `${m.subject}:${m.grade}:${m.topicSlug}`;
    const prev = counts.get(key);
    if (prev) {
      prev.hits += 1;
    } else {
      counts.set(key, {
        topicSlug: m.topicSlug,
        topicTitle: m.topicTitle,
        subject: m.subject,
        grade: m.grade,
        hits: 1,
      });
    }
  }
  return [...counts.values()].sort((a, b) => b.hits - a.hits || a.grade - b.grade).slice(0, 12);
})();

export default function MaterialsHubPage() {
  const topMaterials = getTopMaterials(6);
  const subjectCounts = getSubjectCounts();
  /** Предметы, у которых задан хотя бы один УМК, — для блока «По учебнику». */
  const umkSubjects = subjects.filter((s) => (getUMK(s.slug) ?? []).length > 0);

  return (
    <>
      {/* Хиро */}
      <section className="relative overflow-hidden bg-gradient-to-b from-warm-50 to-white pt-12 sm:pt-16 pb-12">
        <div className="absolute inset-0 -z-10 bg-grid opacity-50" />
        <div className="container-tight">
          <div className="max-w-3xl">
            <Badge tone="brand" className="mb-4">
              <Sparkles className="w-3 h-3" />
              {MATERIALS_CATALOG.length} материалов · редакция
            </Badge>
            <h1 className="text-4xl sm:text-5xl font-display font-bold tracking-tight text-balance">
              Банк материалов — готовое по школьной программе
            </h1>
            <p className="mt-5 text-lg text-warm-600 text-pretty max-w-2xl">
              Контрольные, рабочие листы, интерактивы, конспекты уроков и презентации.
              Нашли подходящий — нажмите «Сгенерировать такой лист», и конструктор соберёт
              такой же материал под ваш класс за 30 секунд.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Button
                as="link"
                href="/constructor"
                variant="primary"
                size="lg"
                leftIcon={<Sparkles className="w-4 h-4" />}
              >
                Создать свой лист
              </Button>
              <Button as="link" href="#categories" variant="secondary" size="lg">
                Смотреть по цели
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Топ материалов */}
      <section className="py-12 sm:py-16">
        <div className="container-tight">
          <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
            <div>
              <h2 className="text-2xl sm:text-3xl font-display font-bold tracking-tight">
                Чаще всего берут в работу
              </h2>
              <p className="mt-2 text-sm text-warm-500">
                Топ обновляется вместе с каталогом
              </p>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {topMaterials.map((m) => (
              <MaterialCard key={m.slug} material={m} />
            ))}
          </div>
        </div>
      </section>

      {/*
        Блок «По учебнику». На странице банка материалов УМК не упоминались
        ни разу, хотя именно по этой странице учитель ищет «материалы по
        Виленкину». Список собирается из `umk.ts` — того же источника, что и
        фильтр в конструкторе. Предметы берём из таксономии, чтобы не дублировать
        список вручную; пустой блок не выводится.
      */}
      {umkSubjects.length > 0 && (
        <section className="py-12 sm:py-16">
          <div className="container-tight">
            <h2 className="text-2xl sm:text-3xl font-display font-bold tracking-tight mb-2">
              Материалы под ваш учебник
            </h2>
            <p className="text-sm text-warm-500 mb-6 max-w-2xl">
              Задания собираются под конкретный УМК, а не «по предмету вообще» — так они совпадают с
              тем, что вы проходите на уроке.
            </p>
            <div className="space-y-5">
              {umkSubjects.map((s) => (
                <div key={s.slug} className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-warm-800 w-full sm:w-auto sm:min-w-[11rem]">
                    {s.title}
                  </span>
                  {(getUMK(s.slug) ?? []).map((entry) => (
                    <Link
                      key={entry.id}
                      href={`/subject/${s.slug}?umk=${entry.id}`}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border border-warm-200 bg-white hover:border-brand-300 hover:bg-brand-50 transition-colors text-sm text-warm-700"
                    >
                      <BookOpen className="w-4 h-4 text-warm-400 shrink-0" />
                      {umkEntryLabel(entry)}
                    </Link>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Категории по цели */}
      <section id="categories" className="py-12 sm:py-16 bg-warm-50 border-y border-warm-100">
        <div className="container-tight">
          <h2 className="text-2xl sm:text-3xl font-display font-bold tracking-tight mb-2">
            Каталог по цели
          </h2>
          <p className="text-sm text-warm-500 mb-8 max-w-2xl">
            Пять категорий — как у крупных каталогов. Выбирайте то, что вам нужно прямо сейчас.
          </p>

          <div className="space-y-10">
            {MATERIAL_PURPOSE_ORDER.map((purpose) => {
              const items = getMaterialsByPurpose(purpose, 6);
              return (
                <div key={purpose}>
                  <div className="flex flex-wrap items-baseline gap-3 mb-4">
                    <h3 className="text-xl font-semibold text-warm-950">
                      {MATERIAL_PURPOSE_LABELS[purpose]}
                    </h3>
                    <span className="text-sm text-warm-500">
                      {MATERIAL_PURPOSE_HINTS[purpose]}
                    </span>
                  </div>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {items.map((m) => (
                      <MaterialCard key={m.slug} material={m} compact />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Топ-предметы */}
      <section className="py-12 sm:py-16">
        <div className="container-tight">
          <h2 className="text-2xl sm:text-3xl font-display font-bold tracking-tight mb-6">
            Материалы по предметам
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {subjectCounts.map(({ subject, count }) => {
              const info = getSubject(subject);
              return (
                <Link
                  key={subject}
                  href={`/subject/${subject}/`}
                  className="group rounded-2xl border border-warm-100 bg-white p-4 shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:border-warm-200 hover:shadow-soft-lg"
                >
                  <span className="text-xl" aria-hidden>
                    {info?.emoji ?? "📄"}
                  </span>
                  <p className="mt-2 font-medium text-warm-950 group-hover:text-brand-700 transition-colors">
                    {info?.shortTitle ?? subject}
                  </p>
                  <p className="text-xs text-warm-500 mt-0.5">
                    {count} {count === 1 ? "материал" : "материалов"}
                  </p>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* Избранные темы */}
      <section className="py-12 sm:py-16 bg-warm-50 border-y border-warm-100">
        <div className="container-tight">
          <h2 className="text-2xl sm:text-3xl font-display font-bold tracking-tight mb-6">
            Избранные темы
          </h2>
          <div className="flex flex-wrap gap-2">
            {featuredTopics.map((t) => (
              <Link
                key={`${t.subject}:${t.grade}:${t.topicSlug}`}
                href={`/subject/${t.subject}/${t.grade}/${t.topicSlug}/`}
                className="group inline-flex items-center gap-2 rounded-full border border-warm-200 bg-white px-4 h-9 text-sm text-warm-800 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800"
              >
                <Layers className="w-3.5 h-3.5 text-warm-400 group-hover:text-brand-500" aria-hidden />
                {t.topicTitle}
                <span className="text-[color:var(--text-muted)]">{t.grade} класс</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Весь каталог */}
      <section className="py-12 sm:py-16">
        <div className="container-tight">
          <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
            <h2 className="text-2xl sm:text-3xl font-display font-bold tracking-tight">
              Весь каталог
            </h2>
            <p className="text-sm text-warm-500">
              {MATERIALS_CATALOG.length} материалов
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {MATERIALS_CATALOG.map((m) => (
              <MaterialCard key={m.slug} material={m} compact />
            ))}
          </div>

          <div className="mt-12 rounded-2xl border border-brand-100 bg-brand-50/60 p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <p className="text-base sm:text-lg text-warm-800 leading-snug sm:max-w-xl">
              Не нашли нужный формат? Соберите свой лист по теме и классу — это занимает
              меньше минуты.
            </p>
            <Link
              href="/constructor"
              className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-xl bg-brand-500 text-white font-medium shadow-brand hover:bg-brand-600 active:bg-brand-700 transition-all whitespace-nowrap"
            >
              Открыть конструктор
              <ArrowRight className="w-4 h-4" aria-hidden />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
