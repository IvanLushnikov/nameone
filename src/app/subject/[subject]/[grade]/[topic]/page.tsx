import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { FgosBadge } from "@/components/ui/FgosBadge";
import {
  Sparkles,
  ArrowRight,
  Check,
  Lightbulb,
  FileText,
  GraduationCap,
  Presentation,
  ClipboardList,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  getTopic,
  getSubject,
  getGrade,
  subjects,
} from "@/lib/content/subjects";
import type { Topic, TopicExample } from "@/lib/types";
import { SITE_URL } from "@/lib/site";
import { plural, topicTitleWithUmk, quotedTopic } from "@/lib/utils/cn";
import { clipDescription } from "@/lib/seo/metadata";
import { Breadcrumb } from "@/components/seo";
import { AnswerToggle } from "./AnswerToggle";

type Props = { params: { subject: string; grade: string; topic: string } };

/**
 * «2 задания-образца», «5 заданий-образцов», «1 задание-образец».
 * Раньше строка собиралась как «{N} заданий-образцов», и на двух примерах
 * выходило «2 заданий-образцов». Само N тоже часть подписи — без него фраза
 * «. задания-образца с ответами» теряла смысл.
 */
function examplesPhrase(count: number): string {
  return `${count} ${plural(count, "задание-образец", "задания-образца", "заданий-образцов")}`;
}

/** Сколько одноимённых тем в этом классе — считается один раз на класс. */
function countTitles(subject: string, grade: number): Map<string, number> {
  const counts = new Map<string, number>();
  const found = getGrade(subject, grade);
  for (const t of found?.topics ?? []) {
    const key = t.title.trim();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

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

  const title = `${topicTitleWithUmk(topic.title, countTitles(params.subject, Number(params.grade)).get(topic.title.trim()) ?? 1, topic.fgosRef)} — рабочие листы · ${subject.shortTitle} ${grade.num} класс`;
  // В типах Subject нет поля с предложным падежом, поэтому после «по» название
  // предмета берём в кавычки — иначе в сниппете выходит «по математика».
  const subjectName = `предмету «${subject.title}»`;
  // Описание — текст из main (тема в «ёлочках», «по предмету «…»» без падежной
  // ошибки, `examplesPhrase` вместо жёсткого «заданий-образцов»), обрезанный
  // по theirs (ТЗ-21 п.14): хвост за 160 знаков в сниппете не виден, режется
  // хвост, а не начало — начало описания и есть ключевые слова запроса.
  const rawDescription = `Скачайте готовые рабочие листы и тесты по теме ${quotedTopic(topicTitleWithUmk(topic.title, countTitles(params.subject, Number(params.grade)).get(topic.title.trim()) ?? 1, topic.fgosRef))} для ${grade.num} класса по ${subjectName}. ${examplesPhrase(topic.examples.length)} с ответами. Сгенерируйте свой вариант за 30 секунд.`;
  const description = clipDescription(rawDescription);

  // TZ-10 §5.1 / §9.7: canonical + og:type=article.
  // publishedTime/modifiedTime убрали: в таксономии (Topic) нет полей
  // createdAt/updatedAt, а раньше туда писалась текущая дата — то есть каждая
  // пересборка объявляла все 1 070 страниц тем только что опубликованными.
  // Так и делали карточки материалов с датой из хэша: Google такие даты
  // считает недостоверными. Вернём, когда в теме появятся реальные даты.
  const base = SITE_URL;
  const canonicalUrl = `${base}/subject/${subject.slug}/${grade.num}/${topic.slug}`;

  return {
    title,
    description,
    // ТЗ-21 п.14 / SEO-аудит P1-4: тег `keywords` убран. Google не учитывает
    // его с 2009 года, Яндекс официально не использует, а переспамленный список
    // из 7 слов на каждой из 1 070 страниц тем выглядит как спам-сигнал.
    // Ключевые слова остались в заголовке, описании и в разметке
    // LearningResource, где они работают по назначению.
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      type: "article",
      title,
      description,
      url: canonicalUrl,
      siteName: "УчЛист",
      locale: "ru_RU",
      authors: ["Команда УчЛист"],
      // TZ-10 §5.4 / §9.6: og:image — статичный PNG.
// Per-topic PNG не генерим (660+ тем × N = тысячи файлов) — fallback на
// уровне предмета. Edge route `src/app/og/[...slug]/route.tsx` остаётся
// для будущей миграции, но в `output: "export"` Edge runtime не запускается.
      images: [
        {
          url: `${base}/og/${subject.slug}.png`,
          width: 1200,
          height: 630,
          alt: `${topic.title} — рабочие листы`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      // TZ-10 §5.4: Twitter image (Card Validator не любит og:image без дубля на Twitter).
      images: [`${base}/og/${subject.slug}.png`],
    },
  };
}

// TZ-10 §6.1: Related topics — откатил, блокирует билд (таймауты static generation).
// Компонент RelatedTopics.tsx оставлен, JSON-LD компоненты Breadcrumb/FaqBlock —
// оставлены. Подключим в отдельной сессии с профилированием.

export default function TopicPage({ params }: Props) {
  const subject = getSubject(params.subject);
  const grade = getGrade(params.subject, Number(params.grade));
  const topic = getTopic(params.subject, Number(params.grade), params.topic);

  if (!subject || !grade || !topic) return notFound();

  const otherTopics = grade.topics.filter((t: Topic) => t.slug !== topic.slug);

  // ТЗ-21 п.6 / SEO-аудит P0-6: перелинковка артефактов.
  //
  // ПРОБЛЕМА, которую это чинит. Проверено на собранном сайте: ссылок вида
  // href="/lesson-plan/..." в разметке НОЛЬ. Все CTA со страницы темы вели
  // в конструктор с query-параметрами, а страницы артефактов оставались
  // «сиротами» — ноль входящих ссылок при 2140 страницах в индексе. Для
  // поисковика это два несвязанных набора URL: страницы не входят в
  // «граф знаний» темы, обходятся хуже и не передают вес.
  //
  // ПОЧЕМУ ИМЕННО ЗДЕСЬ. Страница темы — единственное место, где известны
  // все три параметра (предмет, класс, тема) и где учитель гарантированно
  // думает именно об этой теме. Отсюда самый релевантный исходящий контекст.
  //
  // ССЫЛКИ ВЕДУТ НА САМИ СТРАНИЦЫ, А НЕ НА КОНСТРУКТОР: конструктор без
  // параметров — это «сгенерируй что угодно» и для ссылки бесполезно. Здесь
  // каждая ссылка — на конкретный, уже существующий (collectible через
  // generateStaticParams во всех трёх роутах) артефакт этой же темы.
  //
  // СМ. ТАКЖЕ комментарий к `otherTopics` ниже: блок соседних тем «Смотрите
  // также» уже существует в этой странице отдельной секцией, поэтому второго
  // такого блока не делаем — одинаковые списки дублей на одной странице.
  const artifactLinks: Array<{
    href: string;
    icon: LucideIcon;
    title: string;
    text: string;
  }> = [
    {
      href: `/lesson-plan/${subject.slug}/${grade.num}/${topic.slug}`,
      icon: FileText,
      title: "План урока по этой теме",
      text: "Ход занятия, цели и задания с ответами — готовая структура урока.",
    },
    {
      href: `/presentation/${subject.slug}/${grade.num}/${topic.slug}`,
      icon: Presentation,
      title: "Презентация по этой теме",
      text: "Слайды к теме с заданиями: можно показать на уроке и раздать ученикам.",
    },
    {
      href: `/ktp/${subject.slug}/${grade.num}`,
      icon: ClipboardList,
      title: `КТП по предмету «${subject.shortTitle}», ${grade.num} класс`,
      // КТП — на весь год, а не на тему: тема в URL не входит, роут /ktp/[subject]/[grade].
      text: "Календарно-тематическое планирование на год — все темы предмета списком.",
    },
  ];


  // P0-01: SEO — пробрасываем раздел ФГОС в JSON-LD для поисковиков.
  // Только если у темы указан `fgosRef`, иначе плашку не рендерим и в JSON-LD не пишем.
  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "LearningResource",
    name: `Рабочий лист по теме ${quotedTopic(topic.title)}`,
    description: `Готовые рабочие листы и тесты по теме ${quotedTopic(topic.title)} для ${grade.num} класса по предмету «${subject.title}».`,
    inLanguage: "ru-RU",
    educationalLevel: `${grade.num} класс`,
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
      {/* JSON-LD: передаём раздел ФГОС в поисковики (P0-01) */}
      {topic.fgosRef && (
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
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
              { name: topic.title, url: "" },
            ]}
          />

          <div className="grid lg:grid-cols-[1fr_400px] gap-8 items-start">
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <Badge tone="brand">
                  {subject.emoji} {subject.shortTitle}
                </Badge>
                <Badge tone="neutral">{grade.num} класс</Badge>
                {/* P0-01: ФГОС-плашка; null-рендер при отсутствии fgosRef */}
                <FgosBadge fgosRef={topic.fgosRef} />
              </div>
              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-display font-bold tracking-tight text-balance">
                Рабочий лист по теме {quotedTopic(topic.title)}
              </h1>
              <p className="mt-4 text-lg text-warm-600 text-pretty">
                Готовые задания по ФГОС с ответами и пояснениями. Сгенерируйте свой вариант за 30 секунд — ИИ подстроится по уровню ученика.
              </p>

              <div className="mt-7 flex flex-wrap items-center gap-3">
                <Button
                  as="link"
                  href={`/constructor?subject=${subject.slug}&grade=${grade.num}&topic=${topic.slug}`}
                  variant="primary"
                  size="lg"
                  leftIcon={<Sparkles className="w-4 h-4" />}
                >
                  Создать свой вариант
                </Button>
                <Button
                  as="link"
                  href={`/constructor?subject=${subject.slug}&grade=${grade.num}&topic=${topic.slug}&type=control`}
                  variant="secondary"
                  size="lg"
                  rightIcon={<ArrowRight className="w-4 h-4" />}
                >
                  Контрольная на 2 варианта
                </Button>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-warm-600">
                <span className="inline-flex items-center gap-1.5">
                  <Check className="w-4 h-4 text-brand-500" />
                  {topic.examples.length} заданий с ответами
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Check className="w-4 h-4 text-brand-500" />
                  PDF в формате A4
                </span>
                {/*
                  Отсюда убрали «✓ Проверено ИИ»: галочка стояла на всех 1075
                  страницах тем и читалась как «эти задания уже проверены».
                  Проверка у нас запускается учителем по кнопке и по умолчанию
                  не выполняется, поэтому обещать её на странице темы нельзя.
                */}
              </div>
            </div>

            {/* Quick topic snapshot */}
            <Card className="bg-gradient-to-br from-brand-50 to-white border-brand-100">
              <h3 className="font-semibold text-warm-950 mb-3 flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-brand-600" />
                Что внутри
              </h3>
              <ul className="space-y-2 text-sm text-warm-700">
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-brand-500 shrink-0 mt-0.5" />
                  <span>{examplesPhrase(topic.examples.length)} с ответами</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-brand-500 shrink-0 mt-0.5" />
                  <span>3 уровня сложности: лёгкий / средний / сложный</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-brand-500 shrink-0 mt-0.5" />
                  <span>Пояснения к каждому ответу</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-brand-500 shrink-0 mt-0.5" />
                  <span>Шифр ответов на отдельной странице</span>
                </li>
              </ul>
            </Card>
          </div>
        </div>
      </section>

      {/* F-03: Превью заданий темы — 2-3 карточки, ответ под спойлером, CTA в конструктор */}
      {topic.examples.length > 0 && (
        <section className="py-12 sm:py-16" id="preview">
          <div className="container-tight">
            <h2 className="text-2xl sm:text-3xl font-display font-bold mb-2">
              Примеры заданий из этой темы
            </h2>
            <p className="text-warm-600 mb-6">
              Попробуйте решить сами — ответы спрятаны под кнопкой. Сгенерированный лист содержит 5–30 заданий по уровню ученика.
            </p>

            <div className="grid sm:grid-cols-2 gap-3">
              {topic.examples.slice(0, 3).map((ex: TopicExample, i: number) => (
                <Card key={i} className="h-full">
                  <div className="flex items-start gap-3">
                    <span className="worksheet-task-num">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-warm-950 leading-relaxed">{ex.text}</p>
                      {ex.answer && <AnswerToggle answer={ex.answer} />}
                      {ex.hint && (
                        <p className="mt-2 text-xs text-warm-500 italic">
                          <Lightbulb className="w-3 h-3 inline-block -mt-0.5 mr-1" />
                          {ex.hint}
                        </p>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            {/* CTA: переход в конструктор с предзаполненными subject/grade/topic */}
            <div className="mt-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-2xl border border-brand-100 bg-brand-50/60 p-5 sm:p-6">
              <p className="text-sm sm:text-base text-warm-700 leading-snug sm:max-w-md">
                Хотите 10 таких заданий в PDF? <span className="text-warm-500">Сгенерируем за 30 секунд, с шифром ответов на отдельной странице.</span>
              </p>
              <Link
                href={`/constructor?subject=${subject.slug}&grade=${grade.num}&topic=${topic.slug}`}
                className="inline-flex items-center justify-center gap-2 px-5 py-3 sm:px-6 sm:py-3.5 bg-brand-500 text-white font-medium text-sm sm:text-base rounded-xl shadow-brand hover:bg-brand-600 active:bg-brand-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand-500 whitespace-nowrap"
              >
                <Sparkles className="w-4 h-4 shrink-0" aria-hidden />
                <span>Создать лист</span>
                <ArrowRight className="w-4 h-4 shrink-0" aria-hidden />
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* For whom */}
      <section className="py-12 sm:py-16 bg-warm-50 border-y border-warm-100">
        <div className="container-tight">
          <h2 className="text-2xl sm:text-3xl font-display font-bold mb-6">
            Кому подойдёт
          </h2>
          <div className="grid sm:grid-cols-3 gap-4">
            {[
              {
                icon: GraduationCap,
                title: "Репетиторам",
                text: "Готовьте листы под конкретного ученика. Делайте 2–3 варианта одной темы, чтобы не списывали.",
              },
              {
                icon: FileText,
                title: "Учителям",
                text: "Два варианта с шифром ответов за 5 минут. Подходит для проверочных на 10–15 минут.",
              },
              {
                icon: Sparkles,
                title: "Родителям",
                text: "Дополнительная практика по теме, где ребёнок отстаёт. Без репетитора и методичек.",
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

      {/* ТЗ-21 п.6: перелинковка на артефакты этой же темы. Идёт перед блоком
          соседних тем — учитель доходит до сюда уже решив, что ему нужно, и здесь
          получает готовый материал, а не уходит в конструктор. */}
      <section className="py-12 sm:py-16">
        <div className="container-tight">
          <h2 className="text-2xl sm:text-3xl font-display font-bold mb-2">
            Готовые материалы по этой теме
          </h2>
          <p className="text-warm-600 mb-6">
            Не нужно ничего придумывать: заполните только своими данными и распечатайте.
          </p>
          <div className="grid sm:grid-cols-3 gap-4">
            {artifactLinks.map((a) => (
              <Link key={a.href} href={a.href} className="group">
                <Card hover className="h-full">
                  <div className="w-10 h-10 rounded-xl bg-brand-500 text-white grid place-items-center mb-3">
                    <a.icon className="w-5 h-5" />
                  </div>
                  <h3 className="font-semibold text-warm-950 group-hover:text-brand-700 transition-colors flex items-start gap-1.5">
                    {a.title}
                    <ArrowRight className="w-4 h-4 mt-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </h3>
                  <p className="mt-1.5 text-sm text-warm-600 leading-relaxed">
                    {a.text}
                  </p>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Other topics — это и есть блок «Смотрите также»: соседние темы того же
          предмета и класса. Отдельный второй блок не делаем (ТЗ-21 п.6). */}
      {otherTopics.length > 0 && (
        <section className="py-12 sm:py-16">
          <div className="container-tight">
            <h2 className="text-2xl sm:text-3xl font-display font-bold mb-6">
              Другие темы · {subject.shortTitle} {grade.num} класс
            </h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {otherTopics.map((t: Topic) => (
                <Link
                  key={t.slug}
                  href={`/subject/${subject.slug}/${grade.num}/${t.slug}`}
                  className="group"
                >
                  <Card hover className="h-full">
                    <h3 className="font-medium text-warm-950 group-hover:text-brand-700 transition-colors">
                      {t.title}
                    </h3>
                    <div className="mt-2 text-xs text-warm-500 line-clamp-1 font-mono">
                      {t.examples[0]?.text}
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Final CTA */}
      <section className="py-12 sm:py-16">
        <div className="container-tight">
          <Card className="bg-gradient-to-br from-brand-500 to-brand-700 text-white border-0 text-center py-10 sm:py-14">
            <h2 className="text-2xl sm:text-4xl font-display font-bold tracking-tight">
              Готовы сгенерировать лист по теме {quotedTopic(topic.title)}?
            </h2>
            <p className="mt-3 text-brand-100 max-w-xl mx-auto">
              30 секунд — и PDF у вас. Можно скачать, распечатать или отправить ученику.
            </p>
            <div className="mt-7 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Button
                as="link"
                href={`/constructor?subject=${subject.slug}&grade=${grade.num}&topic=${topic.slug}`}
                variant="accent"
                size="xl"
                leftIcon={<Sparkles className="w-5 h-5" />}
              >
                Создать рабочий лист
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

      {/* TZ-10 §6.2 / §9.5: FAQPage JSON-LD откатил вместе с FaqBlock — таймауты static generation. Подключим позже. */}
      {/* TZ-10 §6.1 / §9.12: Related topics откатил — таймауты static generation. */}
    </>
  );
}