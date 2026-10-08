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
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ПОЧЕМУ ТЕМА МЕНЯЕТСЯ ПО НЕДЕЛЯМ (исправление 08.10.2026)
 * ─────────────────────────────────────────────────────────────────────────────
 * Раньше здесь стояло `WEEKLY_TOPICS.find((t) => t.season === season)` —
 * то есть ПЕРВАЯ тема сезона. В октябре это всегда «Дроби в 5 классе», и
 * учительница написала: «опять эти дроби 5 класс после частых вопросов,
 * нахуя не понятно».
 *
 * Почему это выглядело глупо: заголовок блока — «Что проходят сейчас в
 * школах», то есть обещание актуальной картины по всей школе, а показывалась
 * одна и та же тема весь сезон. Через месяц на странице было написано
 * «Октябрь · 1–2-я недели» — про две недели из четырёх. Подпись не соответствовала
 * содержимому, и учитель справедливо не понимает, зачем ему это показывают.
 *
 * Теперь: из тем сезона выбирается та, чья неделя совпадает с текущей, а если
 * такой нет — по номеру недели циклически. И подпись «Что проходят сейчас»
 * больше не обещает «в школах по всей стране» — это подборка тем недели.
 */
export function WeeklyTopicBlock() {
  const season = getCurrentSeason();
  const seasonTopics = WEEKLY_TOPICS.filter((t) => t.season === season);

  // Темы без подходящего сезона — виджет не показываем вовсе (как и раньше).
  if (seasonTopics.length === 0) return null;

  // Порядковый номер недели в году: от него зависит выбор темы. Считаем от
  // начала учебного года (сентябрь), иначе в январе номер был бы 3, а в
  // сентябре 38 — и ротация ломалась бы на границе года.
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 8, 1);
  const elapsedWeeks = Math.floor(
    (now.getTime() - yearStart.getTime()) / (7 * 24 * 60 * 60 * 1000),
  );
  const topic = seasonTopics[Math.abs(elapsedWeeks) % seasonTopics.length];

  const href = `/subject/${topic.subject}/${topic.grade}/${topic.topicSlug}`;
  const subjectLabel = SUBJECT_LABELS[topic.subject] ?? topic.subject;

  return (
    <section
      data-weekly-topic-block
      className="py-12 sm:py-16 bg-warm-50 border-y border-warm-100"
    >
      <div className="container-tight">
        <div className="text-center mb-6">
          {/*
            Заголовок был «Что проходят сейчас в школах» — обещание картины по
            всей школе, которую блок не показывал. Теперь это честная подборка
            тем недели, а не заявление о всей стране.
          */}
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-600 mb-2">
            Тема недели
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
