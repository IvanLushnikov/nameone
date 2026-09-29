import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { FgosBadge } from "@/components/ui/FgosBadge";
import { Sparkles, ArrowRight } from "lucide-react";
import { getSubject, subjects } from "@/lib/content/subjects";
import type { Grade, Topic } from "@/lib/types";

type Props = { params: { subject: string; grade: string } };

export function generateStaticParams() {
  const params: Array<{ subject: string; grade: string }> = [];
  for (const s of subjects) {
    for (const g of s.grades) {
      params.push({ subject: s.slug, grade: String(g.num) });
    }
  }
  return params;
}

export function generateMetadata({ params }: Props): Metadata {
  const subject = getSubject(params.subject);
  if (!subject) return { title: "Не найдено" };
  const gradeNum = Number(params.grade);
  const grade = subject.grades.find((g: Grade) => g.num === gradeNum);
  if (!grade) return { title: "Класс не найден" };

  return {
    title: `Рабочие листы по ${subject.title.toLowerCase()} ${gradeNum} класс — ${grade.topics.length} тем`,
    description: `Рабочие листы, тесты и карточки по ${subject.title.toLowerCase()} для ${gradeNum} класса. ${grade.topics.length} тем по ФГОС. PDF с ответами за 30 секунд. Бесплатно 3 листа в сутки.`,
  };
}

export default function GradeHubPage({ params }: Props) {
  const subject = getSubject(params.subject);
  if (!subject) return notFound();
  const gradeNum = Number(params.grade);
  const grade = subject.grades.find((g: Grade) => g.num === gradeNum);
  if (!grade) return notFound();

  return (
    <>
      <section className="bg-gradient-to-b from-warm-50 to-white pt-8 sm:pt-12 pb-10">
        <div className="container-tight">
          {/* Breadcrumbs */}
          <nav className="flex items-center gap-2 mb-5 text-sm">
            <Link href="/" className="text-warm-500 hover:text-warm-900">
              Главная
            </Link>
            <span className="text-warm-300">/</span>
            <Link href={`/subject/${subject.slug}`} className="text-warm-500 hover:text-warm-900">
              {subject.title}
            </Link>
            <span className="text-warm-300">/</span>
            <span className="text-warm-700">{gradeNum} класс</span>
          </nav>

          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <div>
              <Badge tone="brand" className="mb-3">
                {subject.emoji} {subject.title}
              </Badge>
              <h1 className="text-4xl sm:text-5xl font-display font-bold tracking-tight">
                {subject.title}, {gradeNum} класс
              </h1>
              <p className="mt-3 text-lg text-warm-600 max-w-xl">
                {grade.topics.length} тем по ФГОС. Рабочие листы, тесты и карточки с ответами за 30 секунд.
              </p>
            </div>
            <Button
              as="link"
              href={`/constructor?subject=${subject.slug}&grade=${gradeNum}`}
              variant="primary"
              size="lg"
              leftIcon={<Sparkles className="w-4 h-4" />}
            >
              Создать лист
            </Button>
          </div>
        </div>
      </section>

      <section className="py-12">
        <div className="container-tight">
          <h2 className="text-2xl font-display font-bold mb-6">Все темы · {grade.title}</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {grade.topics.map((t: Topic) => (
              <Link
                key={t.slug}
                href={`/subject/${subject.slug}/${gradeNum}/${t.slug}`}
                className="group"
              >
                <Card hover className="h-full">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h3 className="font-medium text-warm-950 group-hover:text-brand-700 transition-colors">
                      {t.title}
                    </h3>
                    <ArrowRight className="w-4 h-4 text-warm-400 group-hover:text-brand-500 transition-colors shrink-0 mt-0.5" />
                  </div>
                  {/* P0-01: компактная ФГОС-плашка на листинге (null-рендер если fgosRef нет) */}
                  <FgosBadge fgosRef={t.fgosRef} size="sm" className="mb-2" />
                  <p className="text-xs text-warm-600 line-clamp-2 font-mono">
                    {t.examples[0]?.text}
                  </p>
                  <div className="mt-3 text-xs text-warm-500">
                    {t.examples.length} готовых заданий · можно сгенерировать ещё
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Другие классы */}
      <section className="py-10 border-t border-warm-200">
        <div className="container-tight">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-warm-500 mb-4">
            Другие классы · {subject.shortTitle}
          </h3>
          <div className="flex flex-wrap gap-2">
            {subject.grades.map((g: Grade) => (
              <Link
                key={g.num}
                href={`/subject/${subject.slug}/${g.num}`}
                className={`px-3 h-9 rounded-lg inline-flex items-center text-sm font-medium transition-colors ${
                  g.num === gradeNum
                    ? "bg-brand-500 text-white"
                    : "bg-warm-100 text-warm-700 hover:bg-warm-200"
                }`}
              >
                {g.num}
              </Link>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}