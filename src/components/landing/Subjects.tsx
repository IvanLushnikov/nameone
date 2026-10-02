"use client";

import Link from "next/link";
import { ArrowRight, Sparkles, BookOpen, GraduationCap } from "lucide-react";
import { subjects } from "@/lib/content/subjects";
import type { Subject as SubjectType, Grade as GradeType } from "@/lib/types";
// GradeType retained for totalTopics aggregation
import { useInView } from "@/hooks/useInView";
import { plural } from "@/lib/utils/cn";
import {
  MathIllustration,
  RussianIllustration,
  EnglishIllustration,
} from "@/components/shared/Illustrations";
import {
  PhysicsIllustration,
  ChemistryIllustration,
  BiologyIllustration,
  InformaticsIllustration,
  HistoryIllustration,
  SocialIllustration,
  GeographyIllustration,
  AlgebraIllustration,
  GeometryIllustration,
  LiteratureIllustration,
  OkruzhaetIllustration,
  GermanIllustration,
  ObzhIllustration,
  TechnologyIllustration,
  FinanceIllustration,
  MusicIllustration,
  ArtIllustration,
  PeIllustration,
} from "@/components/shared/Illustrations2";

const illustrationMap: Record<string, React.ElementType> = {
  math: MathIllustration,
  algebra: AlgebraIllustration,
  geometry: GeometryIllustration,
  russian: RussianIllustration,
  literature: LiteratureIllustration,
  english: EnglishIllustration,
  informatics: InformaticsIllustration,
  physics: PhysicsIllustration,
  chemistry: ChemistryIllustration,
  biology: BiologyIllustration,
  geography: GeographyIllustration,
  history: HistoryIllustration,
  social: SocialIllustration,
  okruzhaet: OkruzhaetIllustration,
  german: GermanIllustration,
  obzh: ObzhIllustration,
  technology: TechnologyIllustration,
  finance: FinanceIllustration,
  music: MusicIllustration,
  art: ArtIllustration,
  pe: PeIllustration,
};

const colorGradients: Record<SubjectType["color"], string> = {
  brand: "from-brand-400/30 to-brand-500/10",
  accent: "from-accent-400/30 to-accent-500/10",
  warm: "from-warm-300/40 to-warm-400/10",
  info: "from-blue-400/30 to-blue-500/10",
};

const ringColors: Record<SubjectType["color"], string> = {
  brand: "ring-brand-200",
  accent: "ring-accent-200",
  warm: "ring-warm-200",
  info: "ring-blue-200",
};

// Bento layout configuration: size = "lg" (spans 2x2), "md" (spans 1x2), "sm" (1x1)
const bentoConfig: Array<{ slug: string; size: "lg" | "md" | "sm"; icon?: React.ElementType }> = [
  { slug: "math", size: "lg", icon: Sparkles },
  { slug: "russian", size: "md", icon: BookOpen },
  { slug: "english", size: "md", icon: GraduationCap },
  { slug: "physics", size: "sm" },
  { slug: "chemistry", size: "sm" },
  { slug: "biology", size: "sm" },
  { slug: "informatics", size: "sm" },
  { slug: "history", size: "sm" },
  { slug: "social", size: "sm" },
];

export function Subjects() {
  const [ref, inView] = useInView<HTMLDivElement>({ once: true });

  // Считаем реальные метрики из каталога (не выдуманные числа)
  const totalTopics = subjects.reduce(
    (sum: number, s) => sum + s.grades.reduce((g: number, grade) => g + grade.topics.length, 0),
    0,
  );
  const totalCount = subjects.length;

  // Предметы, которые уже показаны в bento (визуальный акцент)
  const bentoSlugs = new Set(bentoConfig.map((cfg) => cfg.slug));
  // Оставшиеся предметы — рендерим как обычные sm-карточки
  const remainingSubjects = subjects.filter((s) => !bentoSlugs.has(s.slug));

  return (
    <section ref={ref} className="py-20 sm:py-28 bg-white border-y border-warm-100">
      <div className="container-tight">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-10">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-brand-600 mb-3">
              Предметы
            </p>
            <h2 className="text-3xl sm:text-4xl font-display font-bold tracking-tight">
              {totalCount}&nbsp;{plural(totalCount, "предмет", "предмета", "предметов")} · {totalTopics}+&nbsp;{plural(totalTopics, "тема", "темы", "тем")}
            </h2>
            <p className="mt-3 text-warm-600 max-w-2xl">
              От&nbsp;окружающего мира в&nbsp;1&nbsp;классе до&nbsp;ЕГЭ по&nbsp;обществознанию. Таксономия по&nbsp;ФГОС, генерация под&nbsp;уровень ученика.
            </p>
          </div>
          <Link
            href="/constructor"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:text-brand-700 group"
          >
            Создать лист
            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
          </Link>
        </div>

        {/* auto-rows, а не фиксированная высота: строки Grid всегда одинаковые
            внутри себя, поэтому карточки в ряду равны. Фиксированные 180px были
            ниже контента карточки с описанием — overflow-hidden срезал текст
            посреди предложения без многоточия. minmax(180px, auto) даёт строку
            «не меньше 180px, но по контенту»: обрезки невозможны ни на одной
            ширине, а пустая полоса не появляется. */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 auto-rows-[minmax(180px,auto)]">
          {bentoConfig.map((cfg, i) => {
            const subject = subjects.find((s) => s.slug === cfg.slug);
            if (!subject) return null;
            return (
              <SubjectBentoCard
                key={cfg.slug}
                subject={subject}
                size={cfg.size}
                index={i}
                inView={inView}
                badge={cfg.icon}
              />
            );
          })}

          {/* Остальные предметы из каталога — реальные карточки вместо плейсхолдера "+ 5" */}
          {remainingSubjects.map((subject, i) => (
            <SubjectBentoCard
              key={subject.slug}
              subject={subject}
              size="sm"
              index={bentoConfig.length + i}
              inView={inView}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function SubjectBentoCard({
  subject,
  size,
  index,
  inView,
  badge,
}: {
  subject: SubjectType;
  size: "lg" | "md" | "sm";
  index: number;
  inView: boolean;
  badge?: React.ElementType;
}) {
  const Illustration = illustrationMap[subject.slug];
  const totalTopics = subject.grades.reduce((sum: number, g: GradeType) => sum + g.topics.length, 0);
  const firstTopic = subject.grades[0]?.topics[0];

  // md:min-h-[372px] больше не нужен: высоту ряда задаёт auto-rows, а фиксированный
  // min-h только конфликтовал с ней (и был рассчитан на старые 180px).
  const sizeClasses = {
    lg: "md:col-span-2 md:row-span-2 min-h-[180px]",
    md: "md:col-span-2",
    sm: "",
  }[size];

  // Рамка иллюстрации. У крупной карточки (2×2) она не фиксированная, а
  // квадрат по ширине контейнера (до 280px): свободную высоту карточки забирает
  // сама иллюстрация, а не пустое место под ней. SVG с viewBox центрируется сам.
  const iconBox = {
    lg: "w-full max-w-[280px] aspect-square mx-auto",
    md: "w-16 h-16",
    sm: "w-12 h-12",
  }[size];

  return (
    <Link
      href={
        firstTopic
          ? `/subject/${subject.slug}/${subject.grades[0].num}/${firstTopic.slug}`
          : `/subject/${subject.slug}`
      }
      className={`group relative rounded-2xl border border-warm-100 bg-white overflow-hidden hover:shadow-soft-lg hover:-translate-y-0.5 transition-all duration-300 ${sizeClasses}`}
      style={{
        opacity: inView ? 1 : 0,
        transform: inView ? "translateY(0)" : "translateY(20px)",
        transitionProperty: "opacity, transform",
        transitionDuration: "500ms",
        transitionDelay: `${index * 80}ms`,
      }}
    >
      {/* Gradient glow background */}
      <div
        className={`absolute inset-0 bg-gradient-to-br ${colorGradients[subject.color]} opacity-0 group-hover:opacity-100 transition-opacity duration-500`}
      />

      {/* Decorative blob */}
      {size !== "sm" && (
        <div
          className={`absolute -top-12 -right-12 w-32 h-32 rounded-full bg-gradient-to-br ${colorGradients[subject.color]} opacity-50 blur-2xl`}
        />
      )}

      {badge && size === "lg" && (
        <div className="absolute top-3 right-3 z-10">
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-warm-900/80 text-white text-[10px] font-semibold backdrop-blur">
            <Sparkles className="w-3 h-3" />
            Самый популярный
          </span>
        </div>
      )}

      <div className="relative p-4 sm:p-5 h-full flex flex-col">
        {/* Крупная карточка занимает 2×2, а контента в ней меньше — пустоту внизу
            закрывает разросшаяся иллюстрация (см. iconBox выше). */}
        <div
          className={`${iconBox} mb-3 shrink-0 ring-1 ${ringColors[subject.color]} rounded-2xl bg-warm-50 grid place-items-center transition-transform duration-300 ease-out group-hover:scale-110 group-hover:rotate-12`}
        >
          {Illustration ? <Illustration className="w-full h-full" /> : null}
        </div>

        <h3 className={`font-semibold text-warm-950 group-hover:text-brand-700 transition-colors ${size === "lg" ? "text-2xl" : size === "md" ? "text-lg" : "text-sm"}`}>
          {subject.title}
        </h3>

        {(size === "lg" || size === "md") && (
          <p className="text-xs text-warm-600 leading-relaxed mt-1.5 line-clamp-2">
            {subject.description}
          </p>
        )}

        <div className={`mt-auto flex items-center gap-2 text-xs text-warm-500 ${size === "sm" ? "text-[11px]" : ""}`}>
          <span className="inline-flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-500 motion-safe:group-hover:animate-pulse" />
            {subject.grades.length} кл.
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-500 motion-safe:group-hover:animate-pulse" />
            {totalTopics} {plural(totalTopics, "тема", "темы", "тем")}
          </span>
        </div>

        <ArrowRight className="absolute bottom-4 right-4 w-4 h-4 text-warm-400 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all text-brand-600" />
      </div>
    </Link>
  );
}