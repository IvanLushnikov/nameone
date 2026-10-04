"use client";

import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { useInView } from "@/hooks/useInView";
import {
  TimerIllustration,
  ShieldIllustration,
  FileCheckIllustration,
  LayersIllustration,
  SmartphoneIllustration,
  SparklesIllustration,
} from "@/components/shared/Illustrations";
import { ArrowRight } from "lucide-react";
import * as React from "react";

/**
 * Появление карточек включается только после монтирования на клиенте:
 * `opacity: inView ? 1 : 0` попадал в статический HTML, и без JS (и у
 * поисковика) секция выглядела пустой. В разметке теперь всегда opacity 1.
 */
function useReveal(inView: boolean) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  return !mounted || inView;
}

const features = [
  {
    Illustration: TimerIllustration,
    title: "Готово за 30 секунд",
    description:
      "Выбираете класс, предмет и тему — получаете PDF с заданиями, ответами и пояснениями, готовый к печати.",
    accent: "from-brand-400 to-brand-600",
  },
  {
    Illustration: ShieldIllustration,
    title: "Проверка ответов",
    description:
      "Каждый ответ проверяется отдельно. Если ответ сошёлся — задание проходит проверку. Если нет — заменяем другим.",
    accent: "from-accent-400 to-accent-600",
  },
  {
    Illustration: FileCheckIllustration,
    title: "Подходит для ФГОС",
    description:
      "Задания распределены по уровням сложности. Для 1–9 классов — по ФГОС 2021, для 10–11 классов — по ФГОС СОО с 01.09.2027. Задания — по уровню ученика.",
    accent: "from-warm-400 to-warm-600",
  },
  {
    Illustration: LayersIllustration,
    title: "Несколько вариантов",
    description:
      "Делайте 2–3 варианта одной темы, чтобы дать разным ученикам разные задания. Два варианта — в один клик.",
    accent: "from-brand-400 to-brand-600",
  },
  {
    Illustration: SmartphoneIllustration,
    title: "Печать с телефона",
    description:
      "Открываете PDF на телефоне, отправляете на принтер или в Telegram. Никаких приложений и регистраций.",
    accent: "from-accent-400 to-accent-600",
  },
  {
    Illustration: SparklesIllustration,
    title: "История и шаблоны",
    description:
      "Сохраняйте любимые настройки. Возвращайтесь к прошлым листам. Копируйте удачные шаблоны для новых учеников.",
    accent: "from-warm-400 to-warm-600",
  },
  {
    Illustration: TimerIllustration,
    title: "План урока по ФГОС за минуту",
    description:
      "Конспект на 45 минут: цели, ход урока, домашнее задание. Готов для проверки методистом и администрацией школы.",
    accent: "from-accent-400 to-accent-600",
  },
  {
    Illustration: ShieldIllustration,
    title: "Презентация к уроку",
    description:
      "5–20 слайдов с заметками для учителя. Скачивайте в PPTX и редактируйте в PowerPoint.",
    accent: "from-warm-400 to-warm-600",
  },
  {
    Illustration: LayersIllustration,
    title: "КТП на год",
    description:
      "Календарно-тематическое планирование для 1–11 классов. Готовая таблица для администрации.",
    accent: "from-brand-400 to-brand-600",
  },
  {
    Illustration: FileCheckIllustration,
    title: "Проверка работ по фото",
    description:
      "Снимаете тетрадь — получаете балл, оценку и разбор по заданиям. Если что-то вызывает вопросы, составляем 3–5 вопросов, чтобы задать их вслух и разобраться вместе с учеником.",
    accent: "from-accent-400 to-accent-600",
    href: "/constructor?photo=1",
  },
];

export function Features() {
  const [ref, inView] = useInView<HTMLDivElement>();
  const show = useReveal(inView);

  return (
    <section ref={ref} className="py-20 sm:py-28">
      <div className="container-tight">
        <div className="max-w-2xl mx-auto text-center mb-12 sm:mb-16">
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-600 mb-3">
            Почему УчЛист
          </p>
          <h2 className="text-3xl sm:text-4xl font-display font-bold tracking-tight">
            Точно по&nbsp;программе. Быстро. Проверяем ответы&nbsp;— отсеиваем явные ошибки.
          </h2>
          <p className="mt-4 text-lg text-warm-600">
            Десять причин выбрать УчЛист вместо шаблонов и&nbsp;ручной&nbsp;работы.
          </p>
          {/* Один раз расшифровываем сокращение: дальше по сайту — «ИИ». */}
          <p className="mt-3 text-sm text-warm-500">
            ИИ&nbsp;(AI) — здесь это компьютерная программа, которая собирает
            задания по&nbsp;программе. Называем её «ИИ», чтобы было понятно
            школьникам.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {features.map((f, i) => (
            <FeatureCard key={f.title} feature={f} index={i} show={show} />
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureCard({
  feature,
  index,
  show,
}: {
  feature: typeof features[number];
  index: number;
  show: boolean;
}) {
  const { Illustration, title, description, accent, href } = feature;
  return (
    <Card
      hover
      className="h-full relative overflow-hidden group transition-all duration-500"
      style={{
        opacity: show ? 1 : 0,
        transform: show ? "translateY(0)" : "translateY(20px)",
        transitionDelay: `${index * 80}ms`,
        transitionProperty: "opacity, transform",
      }}
    >
      {/* Glow on hover */}
      <div
        className={`absolute -top-20 -right-20 w-40 h-40 rounded-full bg-gradient-to-br ${accent} opacity-0 group-hover:opacity-20 blur-3xl transition-opacity duration-500 pointer-events-none`}
      />
      <div className="relative">
        <div className="mb-4 w-14 h-14 transition-transform duration-300 ease-out motion-safe:group-hover:rotate-[8deg]">
          <Illustration className="w-full h-full" />
        </div>
        <h3 className="text-lg font-semibold text-warm-950 mb-2 transition-colors group-hover:text-brand-700">{title}</h3>
        <p className="text-sm text-warm-600 leading-relaxed">{description}</p>
        {/* Точка входа: карточки без href остаются обычными, с href — ссылкой
          на весь блок. Подпись внизу нужна, чтобы было видно, что блок ведёт
          дальше, а не просто раскрывается. */}
        {href && (
          <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-600 group-hover:text-brand-700">
            Попробовать
            <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
          </span>
        )}
        {href && (
          <Link href={href} className="absolute inset-0" aria-label={title}>
            <span className="sr-only">{title}</span>
          </Link>
        )}
      </div>
    </Card>
  );
}