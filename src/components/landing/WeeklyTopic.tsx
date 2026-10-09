"use client";

/**
 * Виджет «Тема недели» на главной (09.10.2026).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ПОЧЕМУ КЛИЕНТСКИЙ, А НЕ СЕРВЕРНЫЙ
 * ─────────────────────────────────────────────────────────────────────────────
 * Было: серверный компонент. Сайт собирается статически (`output: "export"`),
 * поэтому `new Date()` внутри него выполнялся В МОМЕНТ СБОРКИ. Виджет
 * показывал ту неделю, в которую задеплоили, и не менялся неделями. Учительница
 * написала «опять эти дроби 5 класс» — и была права: виджет не обновлялся.
 *
 * Стало: компонент клиентский и спрашивает бэк, какой сейчас учебная неделя.
 * Календарь считает cron на бэке (`backend/src/jobs/weeklyTopic.ts`) раз в
 * сутки, то есть передеплоить ради смены недели больше не нужно.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЧТО БЕРЁТСЯ ОТКУДА
 * ─────────────────────────────────────────────────────────────────────────────
 * Бэк отдаёт `{ weekIndex, season }` — только календарь. Саму тему выбирает
 * фронт из `WEEKLY_TOPICS` по этим двум числам.
 *
 * Почему не отдавать готовую тему с бэка: список тем живёт во фронтовом
 * контенте, и если продублировать его на бэке, появятся две правды об одном
 * контенте, которые разъедутся при первой же правке.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ЕСЛИ БЭК НЕ ОТВЕЧАЕТ
 * ─────────────────────────────────────────────────────────────────────────────
 * Виджет считает неделю локально. Это НЕ откат «на старые дроби»: разница
 * только в том, откуда взята дата (с сервера или из браузера), а набор тем и
 * правило ротации — те же самые. Тема не пропадает и не дублируется.
 *
 * Важно: компонент монтируется на клиенте, поэтому до гидрации сервер отдаёт
 * разметку-заглушку. Показывать её нельзя — это тот самый блок, на который
 * жаловались, только теперь он мигнул бы. Поэтому до загрузки — ничего.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { WEEKLY_TOPICS, type WeeklyTopic } from "@/lib/content/weekly-topics";
import { getCurrentSeason, type Season } from "@/lib/content/calendar";
import { getWeekIndex } from "@/lib/weekly/week";

const SUBJECT_LABELS: Record<string, string> = {
  math: "Математика",
  algebra: "Алгебра",
  geometry: "Геометрия",
  russian: "Русский язык",
};

/** «Октябрь · 2-я неделя» — считается, а не берётся из данных темы. */
function currentWeekLabel(now: Date): string {
  const MONTHS = [
    "январь", "февраль", "март", "апрель", "май", "июнь",
    "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
  ];
  const name = MONTHS[now.getMonth()] ?? "";
  const weekInMonth = Math.floor((now.getDate() - 1) / 7) + 1;
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} · ${weekInMonth}-я неделя`;
}

/**
 * Выбор темы: та, что «сейчас», иначе — по номеру недели циклически.
 *
 * Раньше стояло `WEEKLY_TOPICS.find(season)` — то есть ПЕРВАЯ тема сезона.
 * В октябре это всегда «Дроби в 5 классе», весь сезон подряд, независимо от
 * того, какая неделя шла.
 */
function pickTopic(weekIndex: number, season: Season): WeeklyTopic | null {
  const pool = WEEKLY_TOPICS.filter((t) => t.season === season);
  if (pool.length === 0) return null;
  return pool[weekIndex % pool.length];
}

export function WeeklyTopicBlock() {
  // Начальное значение считается СИНХРОННО, чтобы блок попал в серверный HTML.
  //
  // Первый вариант был `useState(null)` + рендер по загрузке: блок исчезал из
  // разметки полностью. Для статического экспорта это означало, что темы не
  // было ни в HTML, ни в поиске, а при отключённом JS — её не было вообще.
  //
  // Теперь на сервере считается тема по текущей дате (при статической сборке
  // это дата сборки — как было раньше), а на клиенте useEffect уточняет её у
  // бэка. То есть разметка есть всегда, а значение уточняется сразу после
  // монтирования.
  const [initial] = useState(() => {
    const now = new Date();
    return { topic: pickTopic(getWeekIndex(now), getCurrentSeason()), label: currentWeekLabel(now) };
  });
  const [topic, setTopic] = useState<WeeklyTopic | null>(initial.topic);
  const [label, setLabel] = useState<string>(initial.label);

  useEffect(() => {
    let alive = true;

    async function load() {
      let weekIndex = getWeekIndex(new Date());
      let season = getCurrentSeason();

      try {
        // Адрес бэка ОБЯЗАТЕЛЬНЫЙ: бэк живёт на workers.dev, а сайт — на
        // Pages. Относительный `/api/...` ушёл бы в Pages и вернул 404,
        // то есть виджет молча уехал бы в локальный расчёт и потерял связь с
        // cron. Тот же `NEXT_PUBLIC_API_URL`, что и во всём остальном клиенте.
        const base = process.env.NEXT_PUBLIC_API_URL;
        if (!base) throw new Error("NEXT_PUBLIC_API_URL не задан — считаем локально");
        const res = await fetch(`${base}/api/weekly-topic`, {
          headers: { Accept: "application/json" },
        });
        if (res.ok) {
          const data = (await res.json()) as { weekIndex?: number; season?: string };
          if (typeof data.weekIndex === "number") weekIndex = data.weekIndex;
          if (typeof data.season === "string") season = data.season as Season;
        }
      } catch {
        // Бэк недоступен или переменная не задана (статический предпросмотр,
        // сборка без прод-конфига) — считаем сами.
        // Тот же набор тем и то же правило ротации, разница только в источнике
        // даты, поэтому виджет не исчезает и не повторяет старые дроби.
      }

      if (!alive) return;
      setTopic(pickTopic(weekIndex, season));
      setLabel(currentWeekLabel(new Date()));
    }

    void load();
    return () => {
      alive = false;
    };
  }, []);

  // Пусто только когда в сезоне нет тем (лето, например) — тогда блока на
  // главной действительно быть не должно.
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
            Тема недели
          </p>
          <h2 className="text-2xl sm:text-3xl font-display font-bold tracking-tight">
            {topic.title}
          </h2>
          <p className="mt-3 text-sm text-warm-500 max-w-2xl mx-auto">
            {subjectLabel} · {topic.grade} класс · {label}
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