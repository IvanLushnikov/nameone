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
  ClipboardList,
  Target,
  GraduationCap,
  Clock,
  BookOpen,
  ListChecks,
  FileText,
} from "lucide-react";
import { topicTitleWithUmk } from "@/lib/utils/cn";
import {
  getTopic,
  getSubject,
  getGrade,
  subjects,
} from "@/lib/content/subjects";
import { JsonLd } from "@/components/seo";

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

/**
 * Сколько одноимённых тем в этом классе. В 7–9 классах алгебры есть темы,
 * заведённые под разные УМК («Квадратные корни» по Мерзляку и по Алимову):
 * без автора учебника их заголовки совпадали, и поисковик не различал
 * страницы друг друга.
 */
function sameNameCount(subject: string, grade: number, title: string): number {
  const found = getGrade(subject, grade);
  return (found?.topics ?? []).filter((t) => t.title.trim() === title).length;
}

export function generateMetadata({ params }: Props): Metadata {
  const subject = getSubject(params.subject);
  const grade = getGrade(params.subject, Number(params.grade));
  const topic = getTopic(params.subject, Number(params.grade), params.topic);
  if (!subject || !grade || !topic) return { title: "Тема не найдена" };

  // Бренд в конце не дописываем — его добавляет template в корневом layout.
  // Предмет в заголовке обязателен: без него у планов урока по одноимённым
  // темам разных предметов («Числа от 1 до 10» — математика и английский)
  // получался один и тот же title, и поисковик видел две одинаковые страницы.
  const title = `План урока по теме «${topicTitleWithUmk(topic.title, sameNameCount(params.subject, Number(params.grade), topic.title.trim()), topic.fgosRef)}» · ${subject.shortTitle}, ${grade.num} класс`;
  const description = `Готовый план урока по ФГОС для ${grade.num} класса по предмету «${subject.title}» на тему «${topicTitleWithUmk(topic.title, sameNameCount(params.subject, Number(params.grade), topic.title.trim()), topic.fgosRef)}». Конспект на 45 минут с этапами, целями и домашним заданием. Сгенерируйте DOCX за 30 секунд.`;

  return {
    title,
    description,
    keywords: [
      `план урока ${topic.title.toLowerCase()} ${grade.num} класс`,
      `конспект урока ${topic.title.toLowerCase()}`,
      `${subject.shortTitle.toLowerCase()} ${grade.num} класс`,
      "ФГОС",
      "технологическая карта",
      "45 минут",
    ],
  };
}

export default function LessonPlanTopicPage({ params }: Props) {
  const subject = getSubject(params.subject);
  const grade = getGrade(params.subject, Number(params.grade));
  const topic = getTopic(params.subject, Number(params.grade), params.topic);

  if (!subject || !grade || !topic) return notFound();

  // Разметка по образцу /subject/[subject]/[grade]/[topic] — LearningResource +
  // AlignmentObject по разделу ФГОС. В отличие от subject-страницы рендерим
  // всегда: здесь это единственный источник разметки для ~469 URL конспектов.
  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "LearningResource",
    name: `План урока по теме «${topic.title}»`,
    description: `Готовый план урока по ФГОС для ${grade.num} класса по предмету «${subject.title}» на тему «${topicTitleWithUmk(topic.title, sameNameCount(params.subject, Number(params.grade), topic.title.trim()), topic.fgosRef)}». Конспект на 45 минут с этапами, целями и домашним заданием.`,
    inLanguage: "ru-RU",
    educationalLevel: `${grade.num} класс`,
    learningResourceType: ["План урока", "Конспект", "Технологическая карта"],
    about: { "@type": "Thing", name: subject.title },
  };
  if (topic.fgosRef) {
    jsonLd.educationalAlignment = {
      "@type": "AlignmentObject",
      alignmentType: "educationalFramework",
      targetName: topic.fgosRef,
      educationalFramework: "ФГОС 2021",
    };
  }

  return (
    <>
      <JsonLd data={jsonLd} id="ld-lesson-plan" />
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
            <span className="text-warm-700">План урока · {topic.title}</span>
          </nav>

          <div className="grid lg:grid-cols-[1fr_400px] gap-8 items-start">
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <Badge tone="brand">
                  {subject.emoji} {subject.shortTitle}
                </Badge>
                <Badge tone="neutral">{grade.num} класс</Badge>
                <Badge tone="warm">
                  <ClipboardList className="w-3 h-3" />
                  <span className="ml-1">План урока</span>
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
                План урока по теме «{topic.title}»
              </h1>
              <p className="mt-4 text-lg text-warm-600 text-pretty">
                Готовый план урока по ФГОС для {grade.num} класса по предмету {subject.title.toLowerCase()}.
                Конспект на 45 минут с этапами, целями, оборудованием и домашним заданием.
              </p>

              <div className="mt-7 flex flex-wrap items-center gap-3">
                <Button
                  as="link"
                  href={`/constructor?subject=${subject.slug}&grade=${grade.num}&topic=${topic.slug}&type=lesson-plan`}
                  variant="primary"
                  size="lg"
                  leftIcon={<Sparkles className="w-4 h-4" />}
                >
                  Создать план урока →
                </Button>
                <Button
                  as="link"
                  href={`/constructor?subject=${subject.slug}&grade=${grade.num}&topic=${topic.slug}&type=presentation`}
                  variant="secondary"
                  size="lg"
                  rightIcon={<ArrowRight className="w-4 h-4" />}
                >
                  Презентация к уроку
                </Button>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-warm-600">
                <span className="inline-flex items-center gap-1.5">
                  <Check className="w-4 h-4 text-brand-500" />
                  Конспект на 45 минут
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Check className="w-4 h-4 text-brand-500" />
                  Этапы по ФГОС
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Check className="w-4 h-4 text-brand-500" />
                  Готовый DOCX
                </span>
              </div>
            </div>

            {/* Snapshot */}
            <Card className="bg-gradient-to-br from-brand-50 to-white border-brand-100">
              <h3 className="font-semibold text-warm-950 mb-3 flex items-center gap-2">
                <ListChecks className="w-4 h-4 text-brand-600" />
                Что внутри плана
              </h3>
              <ul className="space-y-2 text-sm text-warm-700">
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-brand-500 shrink-0 mt-0.5" />
                  <span>Технологическая карта на 45 минут</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-brand-500 shrink-0 mt-0.5" />
                  <span>Цели: обучающие, развивающие, воспитательные</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-brand-500 shrink-0 mt-0.5" />
                  <span>Оборудование и материалы к уроку</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-brand-500 shrink-0 mt-0.5" />
                  <span>Хронометраж по этапам</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-brand-500 shrink-0 mt-0.5" />
                  <span>Домашнее задание с вариантами</span>
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
            Готовый к печати конспект урока с заполненными этапами, целями и хронометражем —
            останется только провести урок.
          </p>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              {
                icon: Target,
                title: "Цели урока",
                text: "Обучающие, развивающие и воспитательные — по ФГОС.",
              },
              {
                icon: Clock,
                title: "Хронометраж 45 минут",
                text: "Каждый этап с минутами: оргмомент, мотивация, новый материал, отработка, рефлексия, ДЗ.",
              },
              {
                icon: ListChecks,
                title: "Этапы по ФГОС",
                text: "6 структурных блоков с действиями учителя и учеников.",
              },
              {
                icon: BookOpen,
                title: "Оборудование",
                text: "Список материалов: учебник, раздаточные карточки, доска, проектор.",
              },
              {
                icon: FileText,
                title: "Домашнее задание",
                text: "Базовый и углублённый варианты — на ваш выбор.",
              },
              {
                icon: GraduationCap,
                title: "Готовый DOCX",
                text: "Скачивание в формате Word, удобно редактировать под свой стиль.",
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

      {/* Этапы урока (пояснение без реального контента) */}
      <section className="py-12 sm:py-16 bg-warm-50 border-y border-warm-100">
        <div className="container-tight">
          <h2 className="text-2xl sm:text-3xl font-display font-bold mb-6">
            Этапы урока по ФГОС
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[
              { name: "Организационный момент", time: "2 мин" },
              { name: "Мотивация и актуализация", time: "5 мин" },
              { name: "Объяснение нового материала", time: "15 мин" },
              { name: "Отработка и закрепление", time: "13 мин" },
              { name: "Рефлексия и подведение итогов", time: "5 мин" },
              { name: "Домашнее задание", time: "5 мин" },
            ].map((stage) => (
              <Card key={stage.name} padded>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-medium text-warm-950 text-sm">{stage.name}</h3>
                  <Badge tone="warm">{stage.time}</Badge>
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
                q: "Подойдёт ли план для школы с углублённым изучением?",
                a: "Да. ИИ учитывает тему и класс. Если нужен профильный уровень — укажите это в комментариях к генерации, и план будет расширен.",
              },
              {
                q: "Можно ли редактировать готовый план?",
                a: "Конечно. Вы получаете DOCX — откройте в Word и поправьте под свой стиль, добавьте свои примеры.",
              },
              {
                q: "Включён ли раздаточный материал?",
                a: "В плане указаны ссылки на рабочие листы по теме — можно сгенерировать их вместе с конспектом одним пакетом.",
              },
              {
                q: "Сколько стоит генерация плана?",
                a: "Бесплатно — 3 генерации. На тарифе Плюс планы урока входят в объём тарифа.",
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
              Готовы получить план урока по теме «{topic.title}»?
            </h2>
            <p className="mt-3 text-brand-100 max-w-xl mx-auto">
              30 секунд — и конспект на 45 минут у вас в DOCX. Можно редактировать, печатать, отправить коллеге.
            </p>
            <div className="mt-7 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Button
                as="link"
                href={`/constructor?subject=${subject.slug}&grade=${grade.num}&topic=${topic.slug}&type=lesson-plan`}
                variant="accent"
                size="xl"
                leftIcon={<Sparkles className="w-5 h-5" />}
              >
                Создать план урока
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
