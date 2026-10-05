"use client";

import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Calendar, ArrowRight, Clock } from "lucide-react";
import { getSubject } from "@/lib/content/subjects";

/**
 * «Что проходят сейчас в школах» — событийно-календарный блок.
 *
 * По research (docs/05-fgos-and-taxonomy-research.md, паттерн #2):
 * - Pervoklass / Obuchai используют привязку к календарю как SEO-движок
 * - «Тема недели» даёт повторный трафик каждый учебный год
 * - Текущая неделя в школах (по РФ): октябрь — длинные каникулы уже прошли,
 *   дети втянулись, контрольные через 2-3 недели.
 *
 * Здесь — набор заготовок «что проходят в N классе сейчас» с быстрым
 * переходом в конструктор.
 */

interface WeekTopic {
  grade: number;
  subjectSlug: string;
  topicTitle: string;
  topicSlug?: string;
  hook: string;
  emoji: string;
}

const NOW = new Date();
const MONTH = NOW.getMonth(); // 0-11
// Адаптируем контент под текущий месяц (учебный год сентябрь-май)
function getSeasonalTopics(): WeekTopic[] {
  // По месяцам (привязка к учебному году)
  if (MONTH >= 8 || MONTH <= 1) {
    // Сентябрь-Февраль: первое полугодие
    return [
      { grade: 5, subjectSlug: "math", topicTitle: "Дроби и действия с ними", hook: "Самая частая тема четверти", emoji: "🔢" },
      { grade: 6, subjectSlug: "math", topicTitle: "Пропорции и проценты", hook: "Решаем задачи на проценты каждый день", emoji: "📐" },
      { grade: 7, subjectSlug: "algebra", topicTitle: "Линейные уравнения", hook: "Базовая тема для всего года", emoji: "🧮" },
      { grade: 8, subjectSlug: "geometry", topicTitle: "Четырёхугольники. Площади", hook: "Самая сложная тема четверти", emoji: "📐" },
      { grade: 9, subjectSlug: "algebra", topicTitle: "Неравенства и системы", topicSlug: "neravenstva", hook: "Ближе к ОГЭ — повторяем", emoji: "📚" },
      { grade: 10, subjectSlug: "algebra", topicTitle: "Тригонометрия", hook: "Вход в старшую школу", emoji: "📐" },
      { grade: 11, subjectSlug: "algebra", topicTitle: "Производная и интеграл", hook: "Финиш перед ЕГЭ", emoji: "🎓" },
    ];
  } else if (MONTH >= 2 && MONTH <= 4) {
    // Март-Май: второе полугодие, подготовка к ОГЭ/ЕГЭ
    return [
      { grade: 9, subjectSlug: "algebra", topicTitle: "Квадратные неравенства", hook: "Разбор перед ОГЭ", emoji: "🎓" },
      { grade: 11, subjectSlug: "algebra", topicTitle: "Параметры на ЕГЭ", hook: "Самая сложная задача №18", emoji: "🔥" },
      { grade: 9, subjectSlug: "russian", topicTitle: "Сжатое изложение ОГЭ", topicSlug: "podgotovka-k-oge-rus", hook: "Задание №1 на экзамене", emoji: "📝" },
      { grade: 5, subjectSlug: "russian", topicTitle: "Причастие", hook: "Новая тема в&nbsp;программе", emoji: "📖" },
      { grade: 7, subjectSlug: "algebra", topicTitle: "Системы уравнений", hook: "Базовый навык для ОГЭ", emoji: "🧮" },
    ];
  } else {
    // Июнь-Август: каникулы, лёгкие темы, карточки
    return [
      { grade: 1, subjectSlug: "math", topicTitle: "Таблица умножения (карточки)", topicSlug: "tablitsa-umnozheniya", hook: "На&nbsp;лето&nbsp;— без&nbsp;потери навыка", emoji: "📚" },
      { grade: 3, subjectSlug: "russian", topicTitle: "Безударные гласные (карточки)", topicSlug: "bezudarnye-glasnye", hook: "На&nbsp;лето&nbsp;— без&nbsp;потери навыка", emoji: "📝" },
      { grade: 5, subjectSlug: "math", topicTitle: "Дроби", topicSlug: "drobi-obyknovennye", hook: "Повторяем перед 6&nbsp;классом", emoji: "🔢" },
    ];
  }
}

export function Seasonal() {
  const topics = getSeasonalTopics();
  const monthName = NOW.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });

  return (
    <section className="py-20 sm:py-28 bg-gradient-to-b from-white to-brand-50/40">
      <div className="container-tight">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-10">
          <div>
            <Badge tone="brand" className="mb-3">
              <Calendar className="w-3 h-3" />
              Календарь
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-display font-bold tracking-tight">
              Что проходят в&nbsp;школах сейчас
            </h2>
            <p className="mt-3 text-warm-600 max-w-2xl">
              Актуальные темы по&nbsp;классам на&nbsp;<span className="font-semibold text-warm-950">{monthName}</span>&nbsp;— выберите тему, конструктор откроется с&nbsp;ней.
            </p>
          </div>
          <Link
            href="/constructor"
            className="text-sm font-semibold text-brand-600 hover:text-brand-700 inline-flex items-center gap-1.5"
          >
            Создать лист
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {topics.slice(0, 6).map((t, i) => {
            const subject = getSubject(t.subjectSlug);
            return (
              <Link
                key={`${t.grade}-${t.subjectSlug}-${t.topicSlug ?? t.topicTitle}`}
                href={
                  t.topicSlug
                    ? `/constructor?subject=${t.subjectSlug}&grade=${t.grade}&topic=${t.topicSlug}`
                    : `/constructor?subject=${t.subjectSlug}&grade=${t.grade}`
                }
                className="group"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <Card hover className="h-full relative overflow-hidden">
                  {/* Subtle gradient bg reveal on hover */}
                  <div
                    className="absolute inset-0 bg-gradient-to-br from-brand-100/0 via-brand-50/60 to-accent-100/0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                    aria-hidden
                  />
                  <div className="absolute top-3 right-3 text-3xl opacity-80 group-hover:opacity-100 group-hover:scale-110 transition-all">
                    {t.emoji}
                  </div>
                  <Badge tone="warm" className="mb-2">
                    {t.grade} класс
                  </Badge>
                  <h3 className="font-semibold text-warm-950 group-hover:text-brand-700 transition-colors">
                    {t.topicTitle}
                  </h3>
                  <p className="text-xs text-warm-500 mt-1">{subject?.shortTitle ?? t.subjectSlug}</p>
                  <div className="mt-3 pt-3 border-t border-warm-100 flex items-center gap-1.5 text-xs text-warm-500">
                    <Clock className="w-3.5 h-3.5" />
                    {t.hook}
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>

        <p className="mt-8 text-center text-xs text-warm-500">
          Темы обновляются по&nbsp;учебному году. <Link href="/constructor" className="text-brand-600 hover:text-brand-700 font-medium">Создать лист →</Link>
        </p>
      </div>
    </section>
  );
}
