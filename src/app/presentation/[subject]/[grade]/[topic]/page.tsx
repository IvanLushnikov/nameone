import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import {
  Sparkles,
  ArrowRight,
  Check,
  CheckCircle2,
  Presentation,
  Target,
  GraduationCap,
  LayoutTemplate,
  Mic2,
  FileText,
  Lightbulb,
} from "lucide-react";
import {
  getTopic,
  getSubject,
  getGrade,
  subjects,
} from "@/lib/content/subjects";

type Props = { params: { subject: string; grade: string; topic: string } };

export function generateStaticParams() {
  const params: Array<{ subject: string; grade: string; topic: string }> = [];
  for (const s of subjects) {
    for (const g of s.grades) {
      for (const t of g.topics) {
        params.push({ subject: s.slug, grade: String(g.num), topic: t.slug });
      }
    }
  }
  return params;
}

export function generateMetadata({ params }: Props): Metadata {
  const subject = getSubject(params.subject);
  const grade = getGrade(params.subject, Number(params.grade));
  const topic = getTopic(params.subject, Number(params.grade), params.topic);
  if (!subject || !grade || !topic) return { title: "Тема не найдена" };

  const title = `Презентация по теме «${topic.title}» · ${grade.num} класс · РабочиеЛисты AI`;
  const description = `Готовая презентация по ФГОС для ${grade.num} класса по предмету «${subject.title.toLowerCase()}» на тему «${topic.title}». 10 слайдов с заметками спикера в PPTX. Сгенерируйте за 30 секунд.`;

  return {
    title,
    description,
    keywords: [
      `презентация ${topic.title.toLowerCase()} ${grade.num} класс`,
      `pptx ${topic.title.toLowerCase()}`,
      `${subject.shortTitle.toLowerCase()} ${grade.num} класс`,
      "ФГОС",
      "слайды",
      "заметки спикера",
    ],
  };
}

export default function PresentationTopicPage({ params }: Props) {
  const subject = getSubject(params.subject);
  const grade = getGrade(params.subject, Number(params.grade));
  const topic = getTopic(params.subject, Number(params.grade), params.topic);

  if (!subject || !grade || !topic) return notFound();

  return (
    <>
      {/* Hero */}
      <section className="relative bg-gradient-to-b from-warm-50 to-white pt-8 sm:pt-12 pb-10">
        <div className="absolute inset-0 -z-10 bg-grid opacity-50" />
        <div className="container-tight">
          {/* Breadcrumbs */}
          <nav className="flex flex-wrap items-center gap-2 mb-5 text-sm">
            <Link href="/" className="text-warm-500 hover:text-warm-900">
              Главная
            </Link>
            <span className="text-warm-300">/</span>
            <Link href={`/subject/${subject.slug}`} className="text-warm-500 hover:text-warm-900">
              {subject.title}
            </Link>
            <span className="text-warm-300">/</span>
            <Link
              href={`/subject/${subject.slug}/${grade.num}`}
              className="text-warm-500 hover:text-warm-900"
            >
              {grade.num} класс
            </Link>
            <span className="text-warm-300">/</span>
            <span className="text-warm-700">Презентация · {topic.title}</span>
          </nav>

          <div className="grid lg:grid-cols-[1fr_400px] gap-8 items-start">
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <Badge tone="brand">
                  {subject.emoji} {subject.shortTitle}
                </Badge>
                <Badge tone="neutral">{grade.num} класс</Badge>
                <Badge tone="warm">
                  <Presentation className="w-3 h-3" />
                  <span className="ml-1">Презентация</span>
                </Badge>
                {topic.fgosRef && (
                  <Badge tone="warm">
                    <span className="text-warm-500">Раздел ФГОС:</span>
                    <span className="ml-1">{topic.fgosRef}</span>
                  </Badge>
                )}
                <Badge tone="brand" className="bg-brand-50 text-brand-700 ring-brand-200">
                  <CheckCircle2 className="w-3 h-3" />
                  Соответствует ФГОС&nbsp;2021
                </Badge>
              </div>
              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-display font-bold tracking-tight text-balance">
                Презентация по теме «{topic.title}»
              </h1>
              <p className="mt-4 text-lg text-warm-600 text-pretty">
                Готовая презентация по ФГОС для {grade.num} класса по предмету {subject.title.toLowerCase()}.
                10 слайдов с заметками спикера — открывайте в PowerPoint и проводите урок.
              </p>

              <div className="mt-7 flex flex-wrap items-center gap-3">
                <Button
                  as="link"
                  href={`/constructor?subject=${subject.slug}&grade=${grade.num}&topic=${topic.slug}&type=presentation`}
                  variant="primary"
                  size="lg"
                  leftIcon={<Sparkles className="w-4 h-4" />}
                >
                  Сгенерировать презентацию →
                </Button>
                <Button
                  as="link"
                  href={`/constructor?subject=${subject.slug}&grade=${grade.num}&topic=${topic.slug}&type=lesson-plan`}
                  variant="secondary"
                  size="lg"
                  rightIcon={<ArrowRight className="w-4 h-4" />}
                >
                  План урока к теме
                </Button>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-warm-600">
                <span className="inline-flex items-center gap-1.5">
                  <Check className="w-4 h-4 text-brand-500" />
                  10 слайдов с заметками
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Check className="w-4 h-4 text-brand-500" />
                  Готовый PPTX
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Check className="w-4 h-4 text-brand-500" />
                  Адаптировано под {grade.num} класс
                </span>
              </div>
            </div>

            {/* Snapshot */}
            <Card className="bg-gradient-to-br from-brand-50 to-white border-brand-100">
              <h3 className="font-semibold text-warm-950 mb-3 flex items-center gap-2">
                <LayoutTemplate className="w-4 h-4 text-brand-600" />
                Структура презентации
              </h3>
              <ul className="space-y-2 text-sm text-warm-700">
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-brand-500 shrink-0 mt-0.5" />
                  <span>Титульный слайд с темой</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-brand-500 shrink-0 mt-0.5" />
                  <span>Цели и мотивация</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-brand-500 shrink-0 mt-0.5" />
                  <span>Определения и формулы</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-brand-500 shrink-0 mt-0.5" />
                  <span>Примеры с пошаговым разбором</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-brand-500 shrink-0 mt-0.5" />
                  <span>Итоги и домашнее задание</span>
                </li>
              </ul>
            </Card>
          </div>
        </div>
      </section>

      {/* «Что получите» */}
      <section className="py-12 sm:py-16">
        <div className="container-tight">
          <h2 className="text-2xl sm:text-3xl font-display font-bold mb-2">
            Что вы получите
          </h2>
          <p className="text-warm-600 mb-6">
            Готовую презентацию с логичной структурой урока и заметками спикера — останется
            только открыть файл и провести занятие.
          </p>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              {
                icon: LayoutTemplate,
                title: "10 слайдов по теме",
                text: "Логичная структура: титул, цели, теория, примеры, итоги.",
              },
              {
                icon: Mic2,
                title: "Заметки спикера",
                text: "К каждому слайду — что говорить, на что обратить внимание класса.",
              },
              {
                icon: Target,
                title: "Адаптация под класс",
                text: `Сложность и примеры соответствуют ${grade.num} классу по ФГОС.`,
              },
              {
                icon: Lightbulb,
                title: "Примеры с разбором",
                text: "Пошаговые решения типовых заданий темы.",
              },
              {
                icon: FileText,
                title: "Готовый PPTX",
                text: "Открывается в PowerPoint, Google Slides, Keynote.",
              },
              {
                icon: GraduationCap,
                title: "Готова к уроку",
                text: "Можно использовать как есть или адаптировать под свой стиль.",
              },
            ].map((p) => (
              <Card key={p.title}>
                <div className="w-10 h-10 rounded-xl bg-brand-500 text-white grid place-items-center mb-3">
                  <p.icon className="w-5 h-5" />
                </div>
                <h3 className="font-semibold text-warm-950 mb-1">{p.title}</h3>
                <p className="text-sm text-warm-600 leading-relaxed">{p.text}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Структура слайдов */}
      <section className="py-12 sm:py-16 bg-warm-50 border-y border-warm-100">
        <div className="container-tight">
          <h2 className="text-2xl sm:text-3xl font-display font-bold mb-6">
            Структура презентации
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {[
              { name: "Титульный", kind: "title" },
              { name: "Цели урока", kind: "bullets" },
              { name: "Определение", kind: "definition" },
              { name: "Примеры", kind: "example" },
              { name: "Итоги", kind: "summary" },
            ].map((slide) => (
              <Card key={slide.name} padded>
                <div className="flex flex-col gap-2">
                  <Badge tone="warm">{slide.kind}</Badge>
                  <h3 className="font-medium text-warm-950 text-sm">{slide.name}</h3>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-12 sm:py-16">
        <div className="container-tight">
          <h2 className="text-2xl sm:text-3xl font-display font-bold mb-6">
            Частые вопросы
          </h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {[
              {
                q: "Можно ли изменить количество слайдов?",
                a: "Да. По умолчанию 10 слайдов, в конструкторе можно выбрать 5, 10, 15 или 20.",
              },
              {
                q: "Подойдёт ли для проектора и интерактивной доски?",
                a: "Да. Презентация сделана в стандартном соотношении 16:9 и читается с любого экрана.",
              },
              {
                q: "Можно ли редактировать готовые слайды?",
                a: "Да. PPTX открывается в PowerPoint — меняйте текст, добавляйте картинки и формулы.",
              },
              {
                q: "Есть ли заметки для учителя?",
                a: "Да. У каждого слайда есть заметки спикера — что говорить и на чём акцентировать внимание.",
              },
            ].map((f) => (
              <Card key={f.q}>
                <h3 className="font-semibold text-warm-950 mb-2">{f.q}</h3>
                <p className="text-sm text-warm-600 leading-relaxed">{f.a}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-12 sm:py-16">
        <div className="container-tight">
          <Card className="bg-gradient-to-br from-brand-500 to-brand-700 text-white border-0 text-center py-10 sm:py-14">
            <h2 className="text-2xl sm:text-4xl font-display font-bold tracking-tight">
              Готовы получить презентацию по теме «{topic.title}»?
            </h2>
            <p className="mt-3 text-brand-100 max-w-xl mx-auto">
              30 секунд — и 10 слайдов в PPTX у вас. С заметками спикера, примерами и итогами.
            </p>
            <div className="mt-7 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Button
                as="link"
                href={`/constructor?subject=${subject.slug}&grade=${grade.num}&topic=${topic.slug}&type=presentation`}
                variant="accent"
                size="xl"
                leftIcon={<Sparkles className="w-5 h-5" />}
              >
                Сгенерировать презентацию
              </Button>
              <Button
                as="link"
                href="/pricing"
                variant="ghost"
                size="xl"
                className="text-white hover:bg-white/10"
              >
                Тарифы
              </Button>
            </div>
          </Card>
        </div>
      </section>
    </>
  );
}
