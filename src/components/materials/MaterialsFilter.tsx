"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

/**
 * Фильтры по предмету и классу для `/materials/`.
 *
 * ## Почему это клиентский компонент, а не отдельные страницы
 *
 * Сайт собирается статическим экспортом (`next.config.mjs` →
 * `output: "export"`). Чтобы фильтр жил по отдельному адресу, пришлось бы
 * заранее описать 13 предметов × 11 классов в `generateStaticParams` — это
 * десятки почти одинаковых страниц, а ровно такие тонкие дубли аудит и
 * просил не плодить (план работ, §3). Поэтому фильтр живёт на одной
 * странице, состояние — в React, URL не меняется.
 *
 * ## Почему каталог приезжает пропсом
 *
 * Чтобы сузить выдачу, браузеру нужны записи каталога. Браузер берёт их
 * не из базы (при статическом экспорте её нет), а из HTML — точнее, из
 * RSC-payload, который Next кладёт рядом с разметкой. Поэтому сюда уходит
 * НЕ весь каталог, а тонкая проекция: слаг, заголовок и три признака для
 * фильтра. Описания, тексты тем, счётчики и связи с конструктором здесь
 * не нужны — они лежат на самой карточке материала.
 *
 * Проекция собирается на сервере (`src/app/materials/page.tsx`) из того же
 * каталога, что и страницы `/material/<slug>/`, — источник данных один.
 */

/** Запись каталога в том виде, в котором она нужна фильтру. */
export interface MaterialFilterItem {
  slug: string;
  title: string;
  /** Слаг предмета — по нему фильтруем. */
  subject: string;
  /** Число класса — по нему фильтруем. */
  grade: number;
  /** Код цели: показываем подпись из `purposeLabels`. */
  purpose: string;
}

/** Подписи предметов: эмодзи и короткое имя — рисуем в карточке. */
export interface MaterialSubjectMeta {
  emoji: string;
  shortTitle: string;
}

export interface MaterialsFilterProps {
  items: MaterialFilterItem[];
  /** Код цели → подпись («Проверить», «Объяснить»…). */
  purposeLabels: Record<string, string>;
  /** Слаг предмета → эмодзи и короткое имя. */
  subjectMeta: Record<string, MaterialSubjectMeta>;
  /** Сколько карточек показываем до нажатия «показать ещё». */
  pageSize?: number;
}

/** Сколько карточек уходит в первую отрисовку. */
const DEFAULT_PAGE_SIZE = 12;

/** Сколько добавляем по кнопке. */
const PAGE_STEP = 24;

export function MaterialsFilter({
  items,
  purposeLabels,
  subjectMeta,
  pageSize = DEFAULT_PAGE_SIZE,
}: MaterialsFilterProps) {
  const [subject, setSubject] = useState("");
  const [grade, setGrade] = useState("");
  const [limit, setLimit] = useState(pageSize);

  /** Предметы, которые реально есть в выдаче, вместе с количеством. */
  const subjectOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) counts.set(item.subject, (counts.get(item.subject) ?? 0) + 1);
    return [...counts.entries()]
      .map(([slug, count]) => ({ slug, count }))
      .sort((a, b) => (subjectMeta[b.slug]?.shortTitle ?? b.slug).localeCompare(
        subjectMeta[a.slug]?.shortTitle ?? a.slug,
        "ru",
      ));
  }, [items, subjectMeta]);

  /**
   * Классы для выбранного предмета. Без предмета — все, где есть хоть
   * одна карточка. Класс, под который нечего показать, учителю не
   * предлагаем: пустой список выглядит как ошибка, а не как фильтр.
   */
  const gradeOptions = useMemo(() => {
    const grades = new Set<number>();
    for (const item of items) {
      if (!subject || item.subject === subject) grades.add(item.grade);
    }
    return [...grades].sort((a, b) => a - b);
  }, [items, subject]);

  /** Выдача под текущим выбором. Порядок — редакционный, как в каталоге. */
  const filtered = useMemo(
    () =>
      items.filter(
        (item) =>
          (!subject || item.subject === subject) && (!grade || item.grade === Number(grade)),
      ),
    [items, subject, grade],
  );

  const visible = filtered.slice(0, limit);
  const rest = filtered.length - visible.length;
  const isFiltered = Boolean(subject || grade);

  /** Смена фильтра возвращает список к началу — иначе учитель увидит пустоту. */
  const changeSubject = (next: string) => {
    setSubject(next);
    setLimit(pageSize);
    // Класс из прежнего предмета может не существовать в новом — сбрасываем,
    // чтобы не показывать «0 материалов» там, где выбора просто не было.
    if (next && grade) {
      const exists = items.some((item) => item.subject === next && item.grade === Number(grade));
      if (!exists) setGrade("");
    }
  };

  const changeGrade = (next: string) => {
    setGrade(next);
    setLimit(pageSize);
  };

  const reset = () => {
    setSubject("");
    setGrade("");
    setLimit(pageSize);
  };

  return (
    <div>
      {/* Фильтры. Подписи настоящие, не иконки: список без подписи читается
          только глазами, а с клавиатуры — никак. */}
      <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div>
          <label
            htmlFor="materials-subject"
            className="mb-1.5 block text-sm font-medium text-warm-800"
          >
            Предмет
          </label>
          <select
            id="materials-subject"
            value={subject}
            onChange={(event) => changeSubject(event.target.value)}
            className="w-full h-11 rounded-xl border border-warm-200 bg-white px-3 text-sm text-warm-900 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
          >
            <option value="">Все предметы</option>
            {subjectOptions.map((option) => (
              <option key={option.slug} value={option.slug}>
                {subjectMeta[option.slug]?.shortTitle ?? option.slug} ({option.count})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="materials-grade"
            className="mb-1.5 block text-sm font-medium text-warm-800"
          >
            Класс
          </label>
          <select
            id="materials-grade"
            value={grade}
            onChange={(event) => changeGrade(event.target.value)}
            className="w-full h-11 rounded-xl border border-warm-200 bg-white px-3 text-sm text-warm-900 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
          >
            <option value="">Все классы</option>
            {gradeOptions.map((value) => (
              <option key={value} value={value}>
                {value} класс
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={reset}
          disabled={!isFiltered}
          className="h-11 rounded-xl border border-warm-200 bg-white px-4 text-sm font-medium text-warm-700 transition-colors hover:border-warm-300 hover:text-warm-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-warm-200 disabled:hover:text-warm-700"
        >
          Сбросить
        </button>
      </div>

      {/*
        Счётчик выдачи — «показано N из M».

        Оба числа настоящие: N — сколько карточек реально нарисовано сейчас,
        M — сколько подходит под текущий выбор. Показывать только M нельзя:
        учитель выбрал предмет, увидел «37» и не понял, показана ему вся
        выдача или её часть. Ни одно из чисел не выдумано — это длины
        отфильтрованного и отрисованного массивов.
      */}
      <p className="mt-4 text-sm text-warm-600" role="status">
        {isFiltered ? "Найдено" : "В каталоге"}: показано {visible.length} из{" "}
        {filtered.length}
      </p>

      {visible.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-warm-200 bg-warm-50 p-8 text-center">
          <p className="text-base font-medium text-warm-900">
            По этому выбору материалов нет
          </p>
          <p className="mt-2 text-sm text-warm-600">
            Соберите свой лист в конструкторе — тема и класс подставятся сами.
          </p>
          <Link
            href="/constructor"
            className="mt-4 inline-flex h-10 items-center rounded-xl bg-brand-500 px-4 text-sm font-medium text-white hover:bg-brand-600"
          >
            Открыть конструктор
          </Link>
        </div>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((item) => {
            const meta = subjectMeta[item.subject];
            return (
              <li key={item.slug}>
                <Link
                  href={`/material/${item.slug}/`}
                  className="group flex h-full flex-col rounded-2xl border border-warm-100 bg-white p-4 shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-soft-lg"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center rounded-full bg-brand-100 px-2.5 py-1 text-xs font-medium text-brand-800">
                      {purposeLabels[item.purpose] ?? item.purpose}
                    </span>
                    <span className="inline-flex items-center rounded-full bg-warm-100 px-2.5 py-1 text-xs font-medium text-warm-800">
                      {item.grade} класс
                    </span>
                  </div>
                  <h3 className="font-semibold leading-snug text-warm-950 transition-colors group-hover:text-brand-700">
                    {item.title}
                  </h3>
                  <p className="mt-auto pt-3 text-xs text-warm-500">
                    {meta?.emoji ?? "📄"} {meta?.shortTitle ?? item.subject}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {rest > 0 && (
        <div className="mt-8 flex justify-center">
          <button
            type="button"
            onClick={() => setLimit((value) => value + PAGE_STEP)}
            className="inline-flex h-11 items-center rounded-xl border border-warm-200 bg-white px-5 text-sm font-medium text-warm-800 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800"
          >
            Показать ещё {rest}
          </button>
        </div>
      )}
    </div>
  );
}