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
import { topicTitleWithUmk, quotedTopic } from "@/lib/utils/cn";
import {
  getTopic,
  getSubject,
  getGrade,
  subjects,
} from "@/lib/content/subjects";
import { JsonLd, Breadcrumb } from "@/components/seo";
import { prepositionalTitle } from "@/lib/content/subject-cases";
import { getTopicContent } from "@/lib/content/topic-content";
import { absoluteUrl, clipDescription, ogImages, topicTitleSuffix, twitterCard } from "@/lib/seo/metadata";

type Props = { params: { subject: string; grade: string; topic: string } };

/**
 * Структура слайдов для предметов без наполненных данных.
 * См. пояснение к `FALLBACK_STAGES` в `/lesson-plan/.../page.tsx`.
 */
const FALLBACK_SLIDES = [
  { name: "Титульный", content: "Тема урока и предмет" },
  { name: "Цели урока", content: "Что мы должны понять к концу занятия" },
  { name: "Определение", content: "Основное понятие темы" },
  { name: "Примеры", content: "Разобранные примеры по теме" },
  { name: "Итоги", content: "Вывод и домашнее задание" },
];

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
  // Предмет и УМК в хвосте — ТЗ-21 п.22 (см. topicTitleSuffix): без них
  // страницы презентаций по одноимённым темам разных предметов давали один
  // и тот же title, и поисковик не мог их различить.
  const title = `Презентация по теме «${topic.title}» · ${topicTitleSuffix(
    subject.slug,
    subject.shortTitle,
    grade.num,
    topic.umk,
  )}`;
  // Обрезка — по theirs (ТЗ-21 п.14), текст — из main: «заметками для учителя»
  // вместо «заметками спикера» (копирайт-аудит, аудитория — учитель).
  const description = clipDescription(
    `Готовая презентация по ФГОС для ${grade.num} класса по предмету «${subject.title}» на тему ${quotedTopic(topicTitleWithUmk(topic.title, sameNameCount(params.subject, Number(params.grade), topic.title.trim()), topic.fgosRef))}. 10 слайдов с заметками для учителя в PPTX. Сгенерируйте за минуту.`,
  );
  const url = absoluteUrl(`/presentation/${subject.slug}/${grade.num}/${topic.slug}`);

  return {
    title,
    description,
    // ТЗ-21 п.14: тег `keywords` убран (см. SEO-аудит P1-4 в корневом layout),
    // вместо него — canonical на всех 1 070 страницах презентаций (было 0).
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      title,
      description,
      url,
      siteName: "УчЛист",
      locale: "ru_RU",
      images: ogImages(subject.slug, `Презентация: ${topic.title}`),
    },
    twitter: {
      ...twitterCard(subject.slug),
      title,
      description,
    },
  };
}

export default function PresentationTopicPage({ params }: Props) {
  const subject = getSubject(params.subject);
  const grade = getGrade(params.subject, Number(params.grade));
  const topic = getTopic(params.subject, Number(params.grade), params.topic);

  if (!subject || !grade || !topic) return notFound();

  // Предметное содержание. Раньше тело страницы собиралось из жёстко
  // зашитых массивов: одинаковые слайды «Титульный — Цели — Определение —
  // Примеры — Итоги» шли на все 1075 страниц, хотя презентация по
  // математике и по истории устроены по-разному.
  //
  // `content.filled` — если по предмету нет данных, страница рисует
  // прежние блоки, а не подставляет чужой предметный текст.
  const content = getTopicContent(subject.slug, grade.num);

  // Разметка по образцу /subject/[subject]/[grade]/[topic] — LearningResource +
  // AlignmentObject по разделу ФГОС. Рендерим всегда: здесь это единственный
  // источник разметки для ~469 URL презентаций.
  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "LearningResource",
    name: `Презентация по теме ${quotedTopic(topic.title)}`,
    description: `Готовая презентация по ФГОС для ${grade.num} класса по предмету «${subject.title}» на тему ${quotedTopic(topicTitleWithUmk(topic.title, sameNameCount(params.subject, Number(params.grade), topic.title.trim()), topic.fgosRef))}. 10 слайдов с заметками для учителя в PPTX.`,
    inLanguage: "ru-RU",
    educationalLevel: `${grade.num} класс`,
    learningResourceType: ["Презентация", "Слайды"],
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
      <JsonLd data={jsonLd} id="ld-presentation" />
      {/* Hero */}
      <section className="relative bg-gradient-to-b from-warm-50 to-white pt-8 sm:pt-12 pb-10">
        <div className="absolute inset-0 -z-10 bg-grid opacity-50" />
        <div className="container-tight">
          {/* Хлебные крошки: ручную разметку заменили на общий компонент —
              он же рендерит BreadcrumbList JSON-LD (id ld-breadcrumb).
              На странице он должен быть ровно один, иначе id продублируется.
              className повторяет прежний отступ (mb-5) — внешний вид не меняем. */}
          <Breadcrumb
            className="flex flex-wrap items-center text-sm mb-5"
            items={[
              { name: "Главная", url: "/" },
              { name: subject.title, url: `/subject/${subject.slug}` },
              {
                name: `${grade.num} класс`,
                url: `/subject/${subject.slug}/${grade.num}`,
              },
              { name: `Презентация · ${topic.title}`, url: "" },
            ]}
          />

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
                Презентация по теме {quotedTopic(topic.title)}
              </h1>
              <p className="mt-4 text-lg text-warm-600 text-pretty">
                Готовая презентация по ФГОС для {grade.num} класса по {prepositionalTitle(subject.slug, subject.title)}.
                10 слайдов с заметками для учителя — открывайте в PowerPoint и проводите урок.
              </p>

              <div className="mt-7 flex flex-wrap items-center gap-3">
                <Button
                  as="link"
                  href={`/constructor?subject=${subject.slug}&grade=${grade.num}&topic=${topic.slug}&type=presentation`}
                  variant="primary"
                  size="lg"
                  leftIcon={<Sparkles className="w-4 h-4" />}
                >
                  Создать презентацию →
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

      {/* Что показывают слайды по этой теме. Блок — только если по этой паре
          «предмет + класс» есть данные: иначе на странице английского
          получился бы блок про русский язык. */}
      {content?.filled && (
        <section className="py-12 sm:py-16">
          <div className="container-tight">
            <h2 className="text-2xl sm:text-3xl font-display font-bold mb-2">
              Что показывают слайды по теме «{topic.title}»
            </h2>
            <p className="text-warm-600 mb-6">
              {content.grade.focus} Презентация собирается под {grade.num} класс по{" "}
              {prepositionalTitle(subject.slug, subject.title)}.
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Card>
                <h3 className="font-semibold text-warm-950 mb-3">
                  Что отрабатываем в этой теме
                </h3>
                <ul className="space-y-2 text-sm text-warm-700">
                  {content.grade.operations.map((op) => (
                    <li key={op} className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-brand-500 shrink-0 mt-0.5" />
                      <span>{op}</span>
                    </li>
                  ))}
                </ul>
              </Card>
              <Card>
                <h3 className="font-semibold text-warm-950 mb-3">
                  Слайд, который делает половину работы
                </h3>
                <ul className="space-y-2 text-sm text-warm-700">
                  {content.grade.pitfalls.slice(0, 4).map((p) => (
                    <li key={p} className="flex items-start gap-2">
                      <Lightbulb className="w-4 h-4 text-brand-500 shrink-0 mt-0.5" />
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 pt-4 border-t border-warm-100 text-sm text-warm-600 leading-relaxed">
                  {content.grade.workingStyle}
                </p>
              </Card>
              {/* Примеры — данные САМОЙ темы (`Topic.examples`). Этот блок
                  различает страницы тем ВНУТРИ одного класса: без него
                  страницы одной пары «предмет + класс» читались одинаково. */}
              <Card>
                <h3 className="font-semibold text-warm-950 mb-3">
                  Что будет на слайдах с примерами
                </h3>
                <ul className="space-y-3 text-sm text-warm-700">
                  {topic.examples.map((ex, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="shrink-0 mt-0.5 w-5 h-5 rounded-full bg-brand-50 text-brand-700 text-xs grid place-items-center font-medium">
                        {i + 1}
                      </span>
                      <span>{ex.text}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 pt-4 border-t border-warm-100 text-sm text-warm-600 leading-relaxed">
                  {content.subject.exampleFraming}
                </p>
              </Card>
            </div>
          </div>
        </section>
      )}

      {/* «Что получите» */}
      <section className="py-12 sm:py-16 bg-warm-50 border-y border-warm-100">
        <div className="container-tight">
          <h2 className="text-2xl sm:text-3xl font-display font-bold mb-2">
            Что вы получите
          </h2>
          <p className="text-warm-600 mb-6">
            Готовую презентацию с логичной структурой урока и заметками для учителя — останется
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
                title: "Заметки для учителя",
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
                // Было общее «пошаговые решения типовых заданий темы».
                // Теперь — предметная операция: у математики это счёт с
                // записью в тетради, у русского — работа с правилом.
                text: content?.filled
                  ? `Примеры по теме «${topic.title}»: ${content.grade.operations[0]}.`
                  : "Пошаговые решения типовых заданий темы.",
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

      {/* Структура слайдов — предметная. Раньше здесь стоял один список из
          пяти слайдов, одинаковый на всех 1075 страницах. */}
      <section className="py-12 sm:py-16">
        <div className="container-tight">
          <h2 className="text-2xl sm:text-3xl font-display font-bold mb-2">
            Структура презентации
          </h2>
          <p className="text-warm-600 mb-6">
            {content?.filled
              ? `Порядок слайдов для предмета «${subject.title}» — такой список блоков, а не общий шаблон: ${content.subject.workKind}`
              : "Порядок слайдов по теме."}
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {(content?.filled ? content.subject.slidePlan : FALLBACK_SLIDES).map(
              (slide, i) => (
                <Card key={slide.name} padded>
                  <div className="text-xs font-semibold text-brand-700 mb-1.5">
                    Слайд {i + 1}
                  </div>
                  <h3 className="font-medium text-warm-950 text-sm mb-1">
                    {slide.name}
                  </h3>
                  <p className="text-xs text-warm-600 leading-relaxed">{slide.content}</p>
                </Card>
              ),
            )}
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
                a: "Да. У каждого слайда есть заметки для учителя — что говорить и на чём акцентировать внимание.",
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
              Готовы получить презентацию по теме {quotedTopic(topic.title)}?
            </h2>
            <p className="mt-3 text-brand-100 max-w-xl mx-auto">
              Минута — и 10 слайдов в PPTX у вас. С заметками для учителя, примерами и итогами.
            </p>
            <div className="mt-7 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Button
                as="link"
                href={`/constructor?subject=${subject.slug}&grade=${grade.num}&topic=${topic.slug}&type=presentation`}
                variant="accent"
                size="xl"
                leftIcon={<Sparkles className="w-5 h-5" />}
              >
                Создать презентацию
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
