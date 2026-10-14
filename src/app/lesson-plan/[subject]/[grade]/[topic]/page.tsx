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
  Lightbulb,
  ListChecks,
  FileText,
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
 * Стадии урока для предметов без наполненных данных (`topic-content`).
 *
 * Нужны, чтобы страница не осталась пустой, если предмет не добавлен в
 * карту: блок стадий должен быть всегда. Оформление — то же, что у
 * предметных стадий, чтобы вёрстка не прыгала.
 *
 * Хронометража здесь нет намеренно (см. комментарий у блока стадий ниже).
 */
const FALLBACK_STAGES = [
  {
    name: "Организационный момент",
    teacher: "Проверяет готовность, фиксирует тему, снимает её с прошлого урока",
    students: "Готовятся к уроку, записывают тему",
  },
  {
    name: "Мотивация и актуализация",
    teacher: "Возвращает к материалу прошлого урока и проверяет, можно ли идти дальше",
    students: "Повторяют, отвечают устно",
  },
  {
    name: "Объяснение нового материала",
    teacher: "Разбирает тему по шагам на конкретном примере",
    students: "Слушают, повторяют за учителем",
  },
  {
    name: "Отработка и закрепление",
    teacher: "Даёт блок однотипных заданий по возрастанию сложности",
    students: "Выполняют задания, сверяются",
  },
  {
    name: "Рефлексия и подведение итогов",
    teacher: "Предлагает найти типичную ошибку и объяснить её",
    students: "Находят и объясняют ошибку",
  },
  {
    name: "Домашнее задание",
    teacher: "Задаёт задание и объясняет, где искать материал",
    students: "Записывают задание",
  },
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
  // Предмет и УМК в хвосте — ТЗ-21 п.22: тема «Степень с натуральным
  // показателем» есть у Мерзляка и у Алимова, и без разведения 1 070 страниц
  // конспектов собирали 17 групп одинаковых заголовков.
  const title = `План урока по теме «${topic.title}» · ${topicTitleSuffix(
    subject.slug,
    subject.shortTitle,
    grade.num,
    topic.umk,
  )}`;
  // ТЗ-21 п.14: описание обрезано до 150–160 знаков по границе слова
  // (было 194 — хвост с «Сгенерируйте DOCX за минуту» в сниппет не попадал).
  const description = clipDescription(
    `Готовый план урока по ФГОС для ${grade.num} класса по предмету «${subject.title}» на тему «${topic.title}». Конспект на 45 минут с этапами, целями и домашним заданием. Сгенерируйте DOCX за минуту.`,
  );

  return {
    title,
    description,
    // ТЗ-21 п.14: canonical на всех 1 070 страницах конспектов (было 0).
    alternates: { canonical: absoluteUrl(`/lesson-plan/${subject.slug}/${grade.num}/${topic.slug}`) },
    openGraph: {
      type: "article",
      title,
      description,
      url: absoluteUrl(`/lesson-plan/${subject.slug}/${grade.num}/${topic.slug}`),
      siteName: "УчЛист",
      locale: "ru_RU",
      // Картинка по предмету: per-topic PNG не генерим (1 070 тем × N вариантов).
      images: ogImages(subject.slug, `План урока: ${topic.title}`),
    },
    twitter: {
      ...twitterCard(subject.slug),
      title,
      description,
    },
  };
}

export default function LessonPlanTopicPage({ params }: Props) {
  const subject = getSubject(params.subject);
  const grade = getGrade(params.subject, Number(params.grade));
  const topic = getTopic(params.subject, Number(params.grade), params.topic);

  if (!subject || !grade || !topic) return notFound();

  // Предметное содержание страницы. Раньше тело страницы собиралось из
  // жёстко зашитых массивов (этапы урока, карточки «что вы получите»), и
  // одинаковый текст шёл на все 1075 страниц. Теперь этапы, операции и
  // сложности берутся из `topic-content` по паре «предмет + класс».
  //
  // `content.filled` — важный флаг: если по предмету нет записей, страница
  // рисует прежние блоки, а не подставляет чужой предметный текст.
  const content = getTopicContent(subject.slug, grade.num);

  // Разметка по образцу /subject/[subject]/[grade]/[topic] — LearningResource +
  // AlignmentObject по разделу ФГОС. В отличие от subject-страницы рендерим
  // всегда: здесь это единственный источник разметки для ~469 URL конспектов.
  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "LearningResource",
    name: `План урока по теме ${quotedTopic(topic.title)}`,
    description: `Готовый план урока по ФГОС для ${grade.num} класса по предмету «${subject.title}» на тему ${quotedTopic(topicTitleWithUmk(topic.title, sameNameCount(params.subject, Number(params.grade), topic.title.trim()), topic.fgosRef))}. Конспект на 45 минут с этапами, целями и домашним заданием.`,
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
          {/* Хлебные крошки — единый компонент (BreadcrumbList JSON-LD для поиска). */}
          <Breadcrumb
            className="flex flex-wrap items-center text-sm mb-5"
            items={[
              { name: "Главная", url: "/" },
              { name: subject.title, url: `/subject/${subject.slug}` },
              { name: `${grade.num} класс`, url: `/subject/${subject.slug}/${grade.num}` },
              // Последний уровень — текущая страница, без ссылки.
              { name: `План урока · ${topic.title}`, url: "" },
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
                План урока по теме {quotedTopic(topic.title)}
              </h1>
              <p className="mt-4 text-lg text-warm-600 text-pretty">
                Готовый план урока по ФГОС для {grade.num} класса по предмету{" "}
                {prepositionalTitle(subject.slug, subject.title)}.
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

      {/* Что входит в тему — предмет и класс. Блок появляется только если
          по этой паре есть данные (см. `content.filled` выше): иначе на
          странице литературы оказался бы «математический» текст. */}
      {content?.filled && (
        <section className="py-12 sm:py-16">
          <div className="container-tight">
            <h2 className="text-2xl sm:text-3xl font-display font-bold mb-2">
              Что входит в тему «{topic.title}» в {grade.num} классе
            </h2>
            <p className="text-warm-600 mb-6">
              {content.grade.focus} По предметной программе {content.subject.programArea}.
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
                  Что типично проседает у учеников
                </h3>
                <ul className="space-y-2 text-sm text-warm-700">
                  {content.grade.pitfalls.map((p) => (
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
              {/* Примеры — данные САМОЙ темы (`Topic.examples`), а не шаблон.
                  Именно этот блок делает страницы тем внутри одного класса
                  отличающимися друг от друга: без него все страницы
                  предмета и класса читались одинаково, различаясь только
                  названием темы в заголовке. */}
              <Card>
                <h3 className="font-semibold text-warm-950 mb-3">
                  Как тема выглядит на примерах
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
                // 45 минут — реальное ограничение генератора
                // (`хронометраж_урока_минут: 45` в бэкенде). Перечисление
                // этапов («оргмомент, мотивация, …») убрано: ниже показан
                // предметный набор стадий, и список из шести общих пунктов
                // с ним не совпадал.
                title: "Хронометраж 45 минут",
                text: "Урок рассчитан на 45 минут, минуты распределены по этапам в готовом конспекте.",
              },
              {
                icon: ListChecks,
                title: "Этапы по ФГОС",
                text: "Каждый этап — с отдельными действиями учителя и учеников.",
              },
              {
                icon: BookOpen,
                title: "Оборудование",
                // Перечисление через join давало «Тетрадь…, Карточки…»
                // с заглавными буквами посреди фразы. Список предметных
                // материалов вынесен отдельным блоком ниже.
                text: content?.filled
                  ? `Список предметных материалов для ${grade.num} класса — ниже на странице.`
                  : "Список материалов: учебник, раздаточные карточки, доска, проектор.",
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

      {/* Этапы урока. Раньше здесь стоял один список из шести стадий с
          минутами (2/5/15/13/5/5) — одинаковый на всех 1075 страницах, хотя
          урок по математике и урок по физкультуре устроены по-разному.
          Теперь стадии предметные и показывают действия учителя и учеников.

          Хронометраж по стадиям НЕ проставлен намеренно: план собирает
          модель (см. `backend/src/llm/prompts/lesson-plan-gen.ts`, стадии 3–7
          на сумму 45 минут), и сколько минут достанется конкретной стадии —
          заранее неизвестно. Напечатанные здесь минуты были бы выдумкой. */}
      <section className="py-12 sm:py-16">
        <div className="container-tight">
          <h2 className="text-2xl sm:text-3xl font-display font-bold mb-2">
            Как пойдёт урок по этой теме
          </h2>
          <p className="text-warm-600 mb-6">
            {content?.filled
              ? `Этапы урока по предмету «${subject.title}» подобраны под ${grade.num} класс: ${content.grade.workingStyle}`
              : "Этапы урока по ФГОС."}
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {(content?.filled ? content.subject.lessonStages : FALLBACK_STAGES).map(
              (stage) => (
                <Card key={stage.name} padded>
                  <h3 className="font-medium text-warm-950 text-sm mb-2">
                    {stage.name}
                  </h3>
                  <p className="text-xs text-warm-600 leading-relaxed mb-2">
                    <span className="font-medium text-warm-700">Учитель:</span>{" "}
                    {stage.teacher}
                  </p>
                  <p className="text-xs text-warm-600 leading-relaxed">
                    <span className="font-medium text-warm-700">Ученики:</span>{" "}
                    {stage.students}
                  </p>
                </Card>
              ),
            )}
          </div>

          {/* Что стоит на столе у учителя на этом уроке — предметный список.
              Был общим для всех предметов («учебник, карточки, доска,
              проектор»), хотя у физкультуры это инвентарь и площадка, а у
              информатики — компьютеры. */}
          {content?.filled && (
            <div className="mt-8 rounded-2xl border border-brand-100 bg-brand-50/60 p-5 sm:p-6">
              <h3 className="font-semibold text-warm-950 mb-3 flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-brand-600" />
                Что понадобится к уроку по предмету «{subject.shortTitle}»
              </h3>
              <ul className="grid sm:grid-cols-2 gap-2 text-sm text-warm-700">
                {content.subject.equipment.map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-brand-500 shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
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
              Готовы получить план урока по теме {quotedTopic(topic.title)}?
            </h2>
            <p className="mt-3 text-brand-100 max-w-xl mx-auto">
              Минута — и конспект на 45 минут у вас в DOCX. Можно редактировать, печатать, отправить коллеге.
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
