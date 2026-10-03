import Link from "next/link";
import { getCurrentSeason } from "@/lib/content/calendar";
import { WEEKLY_TOPICS } from "@/lib/content/weekly-topics";

const SUBJECT_LABELS: Record<string, string> = {
  math: "Математика",
  algebra: "Алгебра",
  geometry: "Геометрия",
  russian: "Русский язык",
};

/**
 * «Октябрь · 1-2 неделя» → «Октябрь · 1–2-я неделя».
 * Подпись недели приходит данными из контента, поэтому приводим её к виду
 * с тире и порядковым числом здесь, на отображении.
 */
function weekLabel(raw: string): string {
  return raw.replace(/(\d+)-(\d+) неделя/g, "$1\u2013$2-я неделя");
}

/**
 * Виджет «Что проходят сейчас в школах» — на главной.
 * Подтягивает текущий сезон и подбирает первую тему из WEEKLY_TOPICS.
 * Если совпадений нет (лето, нет данных) — рендерит null.
 */
export function WeeklyTopicBlock() {
  const season = getCurrentSeason();
  const topic = WEEKLY_TOPICS.find((t) => t.season === season);
  if (!topic) return null;

  const href = `/subject/${topic.subject}/${topic.grade}/${topic.topicSlug}`;
  const subjectLabel = SUBJECT_LABELS[topic.subject] ?? topic.subject;

  return (
    <section
      data-weekly-topic-block
      className="py-12 sm:py-16 bg-warm-50 border-y border-warm-100"
    >
      <div className="container-tight">
        <div className="text-center mb-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-600 mb-2">
            Что проходят сейчас в школах
          </p>
          <h2 className="text-2xl sm:text-3xl font-display font-bold tracking-tight">
            {topic.title}
          </h2>
          <p className="mt-3 text-sm text-warm-500 max-w-2xl mx-auto">
            {subjectLabel} · {topic.grade} класс · {weekLabel(topic.weekLabel)}
          </p>
        </div>
        <p className="text-sm sm:text-base text-warm-700 text-center max-w-2xl mx-auto mb-6 leading-relaxed">
          {topic.whyText}
        </p>
        <div className="flex justify-center">
          <Link
            href={href}
            className="inline-flex items-center justify-center gap-2 h-11 px-6 rounded-xl bg-brand-500 text-white font-medium shadow-brand hover:bg-brand-600 active:bg-brand-700 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand-500"
          >
            Сделать рабочий лист по теме →
          </Link>
        </div>
      </div>
    </section>
  );
}
