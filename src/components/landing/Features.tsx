"use client";

import { Card } from "@/components/ui/Card";
import { useInView } from "@/hooks/useInView";
import {
  TimerIllustration,
  ShieldIllustration,
  LayersIllustration,
} from "@/components/shared/Illustrations";
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

/**
 * Главная — вокруг рабочих листов (аудит 11.10, Д-4).
 *
 * БЫЛО: десять карточек, из которых четыре — другие продукты (план урока,
 * презентация, КТП, проверка по фото). Учитель выбирал из девяти продуктов и
 * не понимал, за что платить. Эти функции остались в продукте — их место в
 * кабинете, на них ведут ссылки из блока «Что происходит с листом дальше».
 * Здесь осталось то, ради чего учитель приходит на главную.
 *
 * ЧЕСТНОСТЬ ПРО ПРОВЕРКУ (Д-1). Старая формулировка обещала результат
 * («решает заново и сверяет с ключом»). Что происходит на самом деле, видно
 * по коду: проверку запускает сам учитель кнопкой «Проверить ответы»
 * (src/app/constructor/page.tsx), она идёт по одному заданию за раз, 5–20 секунд
 * на задание и 1–3 минуты на лист (замеры на проде 06.10.2026,
 * src/lib/llm/verify-sheet.ts). Результат — не «правильно», а три состояния
 * на задание: «ИИ-проверено», «Требует проверки», «не проверено»
 * (components/constructor/VerifiedBadge.tsx). Поэтому здесь честная рамка:
 * система даёт черновик разбора, решение остаётся за учителем.
 */
const features = [
  {
    Illustration: TimerIllustration,
    title: "Рабочий лист за минуту",
    description:
      "Выбираете класс, предмет и тему — получаете PDF с заданиями, ответами и пояснениями, готовый к печати. Задания распределены по уровням сложности: ФГОС 2021 для 1–9 классов, действующий ФГОС СОО для 10–11.",
    accent: "from-brand-400 to-brand-600",
  },
  {
    Illustration: LayersIllustration,
    title: "Варианты для всего класса",
    description:
      "Делаете 2–3 варианта одной темы, чтобы у разных учеников были разные задания. Два варианта — в один клик.",
    accent: "from-brand-400 to-brand-600",
  },
  {
    Illustration: ShieldIllustration,
    title: "Ответы — на сверку, не на веру",
    description:
      "По вашей команде нейросеть решает каждое задание заново и сверяет с вашим ключом. Что сошлось — отмечено, что спорно — жёлтым «требует проверки». Это черновик разбора: 5–20 секунд на задание, 1–3 минуты на лист, решение остаётся за вами.",
    accent: "from-accent-400 to-accent-600",
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
            Что здесь есть
          </p>
          <h2 className="text-3xl sm:text-4xl font-display font-bold tracking-tight">
            Рабочие листы. Остальное&nbsp;— в&nbsp;кабинете.
          </h2>
          <p className="mt-4 text-lg text-warm-600">
            Лист, варианты для класса и сверка ответов. План урока, презентация,
            КТП и проверка по&nbsp;фото тоже работают&nbsp;— но их место в
            кабинете, а&nbsp;не на главной.
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
  const { Illustration, title, description, accent } = feature;
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
      </div>
    </Card>
  );
}