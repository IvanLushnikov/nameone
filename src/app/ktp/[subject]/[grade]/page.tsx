import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Breadcrumb } from "@/components/seo";
import { plural } from "@/lib/utils/cn";
import {
  Sparkles,
  ArrowRight,
  Check,
  CheckCircle2,
  CalendarDays,
  Table2,
  FileText,
  Target,
  GraduationCap,
  ListChecks,
} from "lucide-react";
import {
  getSubject,
  getGrade,
  subjects,
} from "@/lib/content/subjects";
import { prepositionalTitle } from "@/lib/content/subject-cases";

type Props = { params: { subject: string; grade: string } };

const SCHOOL_YEAR = "2026/2027";

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
  const grade = getGrade(params.subject, Number(params.grade));
  if (!subject || !grade) return { title: "Класс не найден" };

  // Бренд в конце не дописываем — его добавляет template в корневом layout.
  // Название предмета в предложном падеже — «по математике», а не «по Математика».
  const title = `КТП по ${prepositionalTitle(subject.slug, subject.title)} · ${grade.num} класс · ${SCHOOL_YEAR}`;
  const description = `Календарно-тематическое планирование для ${grade.num} класса по предмету «${subject.title}» на ${SCHOOL_YEAR} учебный год по ФГОС. Скачивайте готовый DOCX с merged cells — все темы курса, контрольные и тесты.`;

  return {
    title,
    description,
    keywords: [
      `КТП ${subject.shortTitle.toLowerCase()} ${grade.num} класс`,
      `календарно-тематическое планирование ${grade.num} класс`,
      `тематическое планирование ${subject.shortTitle.toLowerCase()} ${grade.num} класс`,
      `${SCHOOL_YEAR}`,
      "ФГОС",
      "DOCX",
    ],
  };
}

export default function KtpGradePage({ params }: Props) {
  const subject = getSubject(params.subject);
  const grade = getGrade(params.subject, Number(params.grade));
  if (!subject || !grade) return notFound();

  // Часы: 68 стандарт (4-5 часов в неделю), 102 для математики/русского в ряде программ.
  // Базовая формула: 34 учебные недели × N часов в неделю.
  const hoursPerWeek = subject.slug === "math" || subject.slug === "russian" ? 5 : 2;
  const totalHours = 34 * hoursPerWeek;
  const weeks = 34;

  return (
    <>
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
              { name: "КТП", url: "" },
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
                  <CalendarDays className="w-3 h-3" />
                  <span className="ml-1">КТП на {SCHOOL_YEAR}</span>
                </Badge>
                <Badge tone="brand" className="bg-brand-50 text-brand-700 ring-brand-200">
                  <CheckCircle2 className="w-3 h-3" />
                  Соответствует ФГОС&nbsp;2021
                </Badge>
              </div>
              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-display font-bold tracking-tight text-balance">
                Календарно-тематическое планирование по{" "}
                {prepositionalTitle(subject.slug, subject.title)} · {grade.num} класс
              </h1>
              <p className="mt-4 text-lg text-warm-600 text-pretty">
                Готовое КТП на {totalHours} ч ({weeks} недель) по ФГОС. Скачивайте в DOCX с merged cells —
                все темы курса, контрольные, тесты и резерв.
              </p>

              <div className="mt-7 flex flex-wrap items-center gap-3">
                <Button
                  as="link"
                  href={`/constructor?subject=${subject.slug}&grade=${grade.num}&type=ktp&schoolYear=${SCHOOL_YEAR}`}
                  variant="primary"
                  size="lg"
                  leftIcon={<Sparkles className="w-4 h-4" />}
                >
                  Создать КТП →
                </Button>
                <Button
                  as="link"
                  href={`/constructor?subject=${subject.slug}&grade=${grade.num}`}
                  variant="secondary"
                  size="lg"
                  rightIcon={<ArrowRight className="w-4 h-4" />}
                >
                  Рабочие листы к КТП
                </Button>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-warm-600">
                <span className="inline-flex items-center gap-1.5">
                  <Check className="w-4 h-4 text-brand-500" />
                  {totalHours} часов · {weeks} недели
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Check className="w-4 h-4 text-brand-500" />
                  Готовый DOCX с merged cells
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Check className="w-4 h-4 text-brand-500" />
                  По ФГОС 2021
                </span>
              </div>
            </div>

            {/* Snapshot */}
            <Card className="bg-gradient-to-br from-brand-50 to-white border-brand-100">
              <h3 className="font-semibold text-warm-950 mb-3 flex items-center gap-2">
                <Table2 className="w-4 h-4 text-brand-600" />
                Структура КТП
              </h3>
              <ul className="space-y-2 text-sm text-warm-700">
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-brand-500 shrink-0 mt-0.5" />
                  <span>Все темы курса ({grade.topics.length} {plural(grade.topics.length, "базовая тема", "базовые темы", "базовых тем")})</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-brand-500 shrink-0 mt-0.5" />
                  <span>Поле «Раздел ФГОС» / параграф</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-brand-500 shrink-0 mt-0.5" />
                  <span>Тип урока (урок / контрольная / тест / повторение / резерв)</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-brand-500 shrink-0 mt-0.5" />
                  <span>Контрольные и срезы знаний</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-brand-500 shrink-0 mt-0.5" />
                  <span>Готовый DOCX с merged cells</span>
                </li>
              </ul>
            </Card>
          </div>
        </div>
      </section>

      {/* «Что включает КТП» */}
      <section className="py-12 sm:py-16">
        <div className="container-tight">
          <h2 className="text-2xl sm:text-3xl font-display font-bold mb-2">
            Что включает КТП
          </h2>
          <p className="text-warm-600 mb-6">
            Полный комплект для {grade.num} класса: темы на весь учебный год, типы уроков, контрольные точки.
          </p>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              {
                icon: ListChecks,
                title: "Все темы курса",
                text: `${grade.topics.length} ${plural(grade.topics.length, "базовая тема", "базовые темы", "базовых тем")} курса + резерв на повторение и проектную работу.`,
              },
              {
                icon: Target,
                title: "Поле ФГОС",
                text: "Для каждой темы — раздел ФГОС / параграф учебника, чтобы пройти проверку.",
              },
              {
                icon: CalendarDays,
                title: "Тип урока",
                text: "Урок, контрольная, тест, повторение, резерв, проект — выбирается автоматически.",
              },
              {
                icon: FileText,
                title: "Готовый DOCX",
                text: "Merged cells для шапки таблицы — открывается в Word без ручной правки.",
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

      {/* Темы курса */}
      <section className="py-12 sm:py-16 bg-warm-50 border-y border-warm-100">
        <div className="container-tight">
          <h2 className="text-2xl sm:text-3xl font-display font-bold mb-2">
            Темы курса · {subject.shortTitle} {grade.num} класс
          </h2>
          <p className="text-warm-600 mb-6">
            Эти и соседние темы войдут в КТП. К каждой теме можно открыть рабочий лист или план урока.
          </p>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {grade.topics.slice(0, 9).map((t) => (
              <Card key={t.slug} padded>
                <h3 className="font-medium text-warm-950 text-sm">{t.title}</h3>
                {t.fgosRef && (
                  <Badge tone="neutral" className="mt-2">
                    ФГОС {t.fgosRef}
                  </Badge>
                )}
              </Card>
            ))}
          </div>
          {grade.topics.length > 9 && (
            <p className="mt-4 text-sm text-warm-500">
              И ещё {grade.topics.length - 9} {plural(grade.topics.length - 9, "тема", "темы", "тем")} — полный список попадёт в КТП.
            </p>
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
                q: "Можно ли менять количество часов в неделю?",
                a: "Да. По умолчанию мы используем 5 часов для математики и русского, 2 часа для остальных предметов. В комментариях к генерации можно указать другое количество — КТП пересчитается.",
              },
              {
                q: "Что с merged cells в DOCX?",
                a: "Шапка таблицы (предмет, класс, год) объединена — файл открывается в Word и Google Docs без ручной правки.",
              },
              {
                q: "Подходит ли КТП для внеурочной деятельности?",
                a: "Базовый шаблон рассчитан на основную программу. Для внеурочки — укажите это в комментариях, ИИ подстроит распределение часов.",
              },
              {
                q: "Сколько стоит генерация КТП?",
                a: "Бесплатно — 3 генерации. На тарифе Плюс КТП входит в объём тарифа.",
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
              Готовы получить КТП на {SCHOOL_YEAR}?
            </h2>
            <p className="mt-3 text-brand-100 max-w-xl mx-auto">
              30 секунд — и готовое тематическое планирование у вас в DOCX. С темами, типами уроков и контрольными точками.
            </p>
            <div className="mt-7 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Button
                as="link"
                href={`/constructor?subject=${subject.slug}&grade=${grade.num}&type=ktp&schoolYear=${SCHOOL_YEAR}`}
                variant="accent"
                size="xl"
                leftIcon={<Sparkles className="w-5 h-5" />}
              >
                Создать КТП
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
