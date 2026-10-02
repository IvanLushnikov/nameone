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
  Lightbulb,
  Target,
  GraduationCap,
  FileText,
  Clock,
  ListChecks,
} from "lucide-react";
import { EXAM_SUBJECTS, getExamNumber, type ExamKind } from "@/lib/content/exam-taxonomy";

/**
 * F-04-B: SEO-страницы по конкретным номерам ОГЭ/ЕГЭ.
 *
 * Источник данных — `exam-taxonomy.ts` (218 номеров, 10 предметов).
 * Безопасность: все title/description рендерятся как React text nodes,
 * что автоматически экранирует `<`, `>`, `&` (XSS невозможен).
 */

// ========================== Хелперы ==========================

const EXAM_LABELS: Record<ExamKind, { full: string; short: string; classHint: string }> = {
  oge: { full: "ОГЭ", short: "ОГЭ", classHint: "9 класс" },
  ege: { full: "ЕГЭ", short: "ЕГЭ", classHint: "11 класс" },
};

const SUBJECT_LABELS: Record<string, string> = {
  math: "Математика",
  "math-p": "Математика (профильная)",
  "math-b": "Математика (базовая)",
  russian: "Русский язык",
  physics: "Физика",
  chemistry: "Химия",
  biology: "Биология",
  history: "История",
  social: "Обществознание",
  english: "Английский язык",
  informatics: "Информатика",
  literature: "Литература",
};

function getSubjectLabel(subject: string): string {
  return SUBJECT_LABELS[subject] ?? subject;
}

function getExamLabel(exam: string) {
  if (exam !== "oge" && exam !== "ege") return null;
  return EXAM_LABELS[exam];
}

// ========================== Static params ==========================

type Props = { params: { exam: string; subject: string; number: string } };

export function generateStaticParams() {
  return EXAM_SUBJECTS.flatMap((s) =>
    s.numbers.map((n) => ({
      exam: s.exam,
      subject: s.subject,
      number: String(n.number),
    }))
  );
}

// ========================== Metadata ==========================

export function generateMetadata({ params }: Props): Metadata {
  const numberN = Number(params.number);
  const examLabel = getExamLabel(params.exam);
  const examKind: ExamKind | null = params.exam === "oge" || params.exam === "ege" ? params.exam : null;
  const item = examKind ? getExamNumber(examKind, params.subject, numberN) : undefined;

  if (!examLabel || !item || !Number.isFinite(numberN) || numberN <= 0) {
    return {
      title: "Задание не найдено",
      robots: { index: false, follow: true },
    };
  }

  const subjectLabel = getSubjectLabel(item.subject);
  const fullTitle = `Задание ${item.number}: ${item.title} · ${subjectLabel} ${examLabel.full}`;
  const description = `${item.title} — задание ${item.number} ${examLabel.full}, предмет «${subjectLabel}». ${item.description} Сгенерируйте лист по этому номеру за 30 секунд.`;

  return {
    title: fullTitle,
    description,
    keywords: [
      `${item.title} ${subjectLabel.toLowerCase()} ${examLabel.full}`,
      `задание ${item.number} ${examLabel.full}`,
      `задание ${item.number} ${subjectLabel.toLowerCase()}`,
      "ФИПИ",
      examLabel.full,
    ],
    robots: { index: true, follow: true },
    openGraph: {
      title: fullTitle,
      description,
      locale: "ru_RU",
      type: "article",
    },
  };
}

// ========================== Page ==========================

export default function ExamNumberPage({ params }: Props) {
  const numberN = Number(params.number);
  const examLabel = getExamLabel(params.exam);
  const examKind: ExamKind | null = params.exam === "oge" || params.exam === "ege" ? params.exam : null;
  const item = examKind ? getExamNumber(examKind, params.subject, numberN) : undefined;

  // 404 handling: несуществующий exam/subject/number
  if (!examLabel || !item || !Number.isFinite(numberN) || numberN <= 0) {
    return notFound();
  }

  const subjectLabel = getSubjectLabel(item.subject);

  // Related: соседние номера ±5 того же предмета и экзамена, исключая текущий
  const related = (() => {
    const subj = EXAM_SUBJECTS.find(
      (s) => s.exam === item.exam && s.subject === item.subject,
    );
    if (!subj) return [];
    return subj.numbers
      .filter((n) => n.number !== item.number && Math.abs(n.number - item.number) <= 5)
      .sort((a, b) => a.number - b.number);
  })();

  const ctaHref = `/constructor?exam=${item.exam}&subject=${item.subject}&number=${item.number}`;

  return (
    <>
      {/* Hero */}
      <section className="relative bg-gradient-to-b from-warm-50 to-white pt-8 sm:pt-12 pb-10">
        <div className="absolute inset-0 -z-10 bg-grid opacity-50" />
        <div className="container-tight">
          {/* Breadcrumbs */}
          <nav
            aria-label="breadcrumb"
            className="flex flex-wrap items-center gap-2 mb-5 text-sm"
          >
            <Link href="/" className="text-warm-500 hover:text-warm-900">
              Главная
            </Link>
            <span className="text-warm-300">/</span>
            <Link href="/oge" className="text-warm-500 hover:text-warm-900">
              {examLabel.full}
            </Link>
            <span className="text-warm-300">/</span>
            <Link
              href={`/oge#${item.subject}`}
              className="text-warm-500 hover:text-warm-900"
            >
              {subjectLabel}
            </Link>
            <span className="text-warm-300">/</span>
            <span className="text-warm-700">Задание {item.number}</span>
          </nav>

          <div className="grid lg:grid-cols-[1fr_400px] gap-8 items-start">
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <Badge tone="brand">
                  <Target className="w-3 h-3" />
                  Задание {item.number} · {examLabel.full}
                </Badge>
                <Badge tone="neutral">{subjectLabel}</Badge>
                <Badge tone="warm">
                  <span className="text-warm-500">Раздел ФИПИ:</span>
                  <span className="ml-1">{item.fgosRef}</span>
                </Badge>
                <Badge tone="brand" className="bg-brand-50 text-brand-700 ring-brand-200">
                  <CheckCircle2 className="w-3 h-3" />
                  Соответствует ФГОС&nbsp;2021
                </Badge>
              </div>
              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-display font-bold tracking-tight text-balance">
                Задание {item.number}. {item.title}
              </h1>
              <p className="mt-4 text-lg text-warm-600 text-pretty">
                Тренировка по конкретному номеру {examLabel.full} — задание {item.number} из кодификатора ФИПИ.
                Сгенерируйте лист за 30 секунд и отработайте именно этот тип.
              </p>

              <div className="mt-7 flex flex-wrap items-center gap-3">
                <Button
                  as="link"
                  href={ctaHref}
                  variant="primary"
                  size="lg"
                  leftIcon={<Sparkles className="w-4 h-4" />}
                >
                  Создать лист по этому номеру
                </Button>
                <Button
                  as="link"
                  href="/oge"
                  variant="secondary"
                  size="lg"
                  rightIcon={<ArrowRight className="w-4 h-4" />}
                >
                  Все варианты {examLabel.full}
                </Button>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-warm-600">
                <span className="inline-flex items-center gap-1.5">
                  <Check className="w-4 h-4 text-brand-500" />
                  По кодификатору ФИПИ
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Check className="w-4 h-4 text-brand-500" />
                  PDF в формате А4
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Check className="w-4 h-4 text-brand-500" />
                  С шифром ответов
                </span>
              </div>
            </div>

            {/* Quick snapshot */}
            <Card className="bg-gradient-to-br from-brand-50 to-white border-brand-100">
              <h3 className="font-semibold text-warm-950 mb-3 flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-brand-600" />
                Что внутри листа
              </h3>
              <ul className="space-y-2 text-sm text-warm-700">
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-brand-500 shrink-0 mt-0.5" />
                  <span>Только задания этого типа — никакого мусора</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-brand-500 shrink-0 mt-0.5" />
                  <span>3 уровня сложности: лёгкий / средний / сложный</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-brand-500 shrink-0 mt-0.5" />
                  <span>Шифр ответов на отдельной странице</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-brand-500 shrink-0 mt-0.5" />
                  <span>Готов к печати: 5–30 заданий на одном листе А4</span>
                </li>
              </ul>
            </Card>
          </div>
        </div>
      </section>

      {/* «Что проверяется» */}
      <section className="py-12 sm:py-16" id="about">
        <div className="container-tight">
          <div className="grid lg:grid-cols-[1fr_320px] gap-8 items-start">
            <div>
              <h2 className="text-2xl sm:text-3xl font-display font-bold mb-2">
                Что проверяется
              </h2>
              <p className="text-warm-600 mb-6">
                Содержание задания {item.number} соответствует разделу ФИПИ «{item.fgosRef}».
                Это {examLabel.classHint}, предмет — {subjectLabel.toLowerCase()}.
              </p>
              <Card className="bg-warm-50/60 border-warm-100">
                <p className="text-base text-warm-800 leading-relaxed">
                  {item.description}
                </p>
              </Card>

              <h2 className="text-2xl sm:text-3xl font-display font-bold mt-10 mb-2">
                Примеры заданий
              </h2>
              <Card>
                <div className="flex items-start gap-3">
                  <span className="worksheet-task-num shrink-0">i</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-warm-700 leading-relaxed italic">
                      Скоро здесь появятся примеры заданий этого типа. Пока вы можете
                      сгенерировать свой лист в генераторе — он сразу даст 5–30 заданий
                      именно этого номера ФИПИ.
                    </p>
                  </div>
                </div>
              </Card>

              {/* CTA: переход в конструктор с предзаполненными exam/subject/number */}
              <div className="mt-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-2xl border border-brand-100 bg-brand-50/60 p-5 sm:p-6">
                <p className="text-sm sm:text-base text-warm-700 leading-snug sm:max-w-md">
                  Хотите лист по этому номеру?{" "}
                  <span className="text-warm-500">
                    Откроем генератор с уже выбранным заданием — останется задать сложность и количество.
                  </span>
                </p>
                <Link
                  href={ctaHref}
                  className="inline-flex items-center justify-center gap-2 px-5 py-3 sm:px-6 sm:py-3.5 bg-brand-500 text-white font-medium text-sm sm:text-base rounded-xl shadow-brand hover:bg-brand-600 active:bg-brand-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand-500 whitespace-nowrap"
                >
                  <Sparkles className="w-4 h-4 shrink-0" aria-hidden />
                  <span>Создать лист</span>
                  <ArrowRight className="w-4 h-4 shrink-0" aria-hidden />
                </Link>
              </div>
            </div>

            <aside className="lg:sticky lg:top-6 space-y-4">
              <Card>
                <h3 className="font-semibold text-warm-950 mb-3 flex items-center gap-2">
                  <ListChecks className="w-4 h-4 text-brand-600" />
                  Параметры листа
                </h3>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-warm-500">Экзамен</dt>
                    <dd className="text-warm-950 font-medium">{examLabel.full}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-warm-500">Предмет</dt>
                    <dd className="text-warm-950 font-medium">{subjectLabel}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-warm-500">Номер</dt>
                    <dd className="text-warm-950 font-medium">{item.number}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-warm-500">Раздел</dt>
                    <dd className="text-warm-950 font-medium text-right">{item.fgosRef}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-warm-500">Класс</dt>
                    <dd className="text-warm-950 font-medium">{examLabel.classHint}</dd>
                  </div>
                </dl>
              </Card>
              <Card className="bg-warm-50/60 border-warm-100">
                <p className="text-xs text-warm-600 leading-relaxed">
                  <Clock className="w-3.5 h-3.5 inline-block -mt-0.5 mr-1 text-warm-500" />
                  Всего 30 секунд — и PDF у вас. Можно скачать, распечатать или отправить ученику.
                </p>
              </Card>
            </aside>
          </div>
        </div>
      </section>

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
                title: "Ученикам 9 и 11 класса",
                text: `Точечная тренировка по заданию ${item.number} ${examLabel.full}. Не весь вариант — только то, что нужно подтянуть.`,
              },
              {
                icon: FileText,
                title: "Учителям и репетиторам",
                text: `Готовая подборка заданий типа «${item.title.toLowerCase()}» — для разбора в классе или домашней работы.`,
              },
              {
                icon: Sparkles,
                title: "Родителям",
                text: "Понятный тренажёр под кодификатор ФИПИ: ребёнок решает именно то, что будет на экзамене.",
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

      {/* Related: соседние номера */}
      {related.length > 0 && (
        <section className="py-12 sm:py-16">
          <div className="container-tight">
            <h2 className="text-2xl sm:text-3xl font-display font-bold mb-2">
              Другие номера {examLabel.full} · {subjectLabel}
            </h2>
            <p className="text-warm-600 mb-6">
              Тренируйтесь по соседним заданиям — это закрывает смежные темы из кодификатора.
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {related.map((r) => (
                <Link
                  key={`${r.exam}-${r.subject}-${r.number}`}
                  href={`/exam/${r.exam}/${r.subject}/${r.number}/`}
                  className="group"
                >
                  <Card hover className="h-full">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <Badge tone="brand">Задание {r.number}</Badge>
                      <span className="text-xs text-[color:var(--text-muted)]">{r.fgosRef}</span>
                    </div>
                    <h3 className="font-medium text-warm-950 group-hover:text-brand-700 transition-colors">
                      {r.title}
                    </h3>
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
              Готовы тренировать задание {item.number}?
            </h2>
            <p className="mt-3 text-brand-100 max-w-xl mx-auto">
              Откройте генератор — там уже выбран номер {item.number}, {examLabel.full}, {subjectLabel.toLowerCase()}.
              Останется задать сложность и количество заданий.
            </p>
            <div className="mt-7 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Button
                as="link"
                href={ctaHref}
                variant="accent"
                size="xl"
                leftIcon={<Sparkles className="w-5 h-5" />}
              >
                Создать лист по заданию {item.number}
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
