import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { MaterialsFilter, type MaterialFilterItem } from "@/components/materials/MaterialsFilter";
import { SubmitMaterialDialog, UserMaterialsList } from "@/components/materials/SubmitMaterialDialog";
import {
  MATERIALS_CATALOG,
  MATERIAL_PURPOSE_HINTS,
  MATERIAL_PURPOSE_LABELS,
  MATERIAL_PURPOSE_ORDER,
  getMaterialsByPurpose,
  getSubjectCounts,
} from "@/lib/content/materials-catalog";
import { getSubject, subjects } from "@/lib/content/subjects";
import { getUMK } from "@/lib/content/umk";
import { umkEntryLabel } from "@/lib/content/landing-seo";
import { SITE_URL } from "@/lib/site";
import { ogImages, twitterCard } from "@/lib/seo/metadata";

export const metadata: Metadata = {
  // «· УчЛист» дописывает шаблон из корневого layout, поэтому бренд в title
  // руками не пишем — иначе будет «… · УчЛист · УчЛист».
  // ТЗ-26 Б-4, вариант Б: страница больше не «банк материалов», а каталог
  // образцов с честным признанием — выгрузка после генерации. Заголовок в
  // поиске обещал «готовые рабочие листы», которых на странице нет.
  title: "Каталог рабочих листов по ФГОС",
  // Длина посчитана, а не на глаз: было 209 знаков, поисковик показывает
  // примерно 160, а хвост с обещанием готового файла не видел никто.
  // Из трёх частей оставляем две самые нужные — что это за страница и что на
  // ней делать, — а перечисление видов материала ужимается до одной строки.
  // Формулировка «соберите такой же лист» вместо «скачайте готовый» — на
  // странице нет кнопки выгрузки: файл появляется после генерации в
  // конструкторе (см. текст первого экрана ниже), обещать скачивание нельзя.
  description:
    "Каталог образцов по школьным предметам: рабочие листы, контрольные, карточки, конспекты, презентации. Откройте образец и соберите такой же лист под свой класс.",
  alternates: { canonical: `${SITE_URL}/materials/` },
  // ТЗ-21 п.14: og:image — витрина каталога, своей картинки нет, поэтому
  // брендовая карточка из public/og/default.png.
  openGraph: {
    title: "Каталог рабочих листов по ФГОС",
    description:
      "Каталог образцов рабочих листов по школьным предметам. Откройте любой и соберите такой же в конструкторе — готовый файл появляется после генерации.",
    url: `${SITE_URL}/materials/`,
    siteName: "УчЛист",
    locale: "ru_RU",
    images: ogImages(undefined, "Каталог рабочих листов УчЛист по ФГОС"),
  },
  twitter: twitterCard(undefined),
};

/** Избранные темы — темы, на которые в каталоге больше всего материалов. */
const featuredTopics = (() => {
  const counts = new Map<string, { topicSlug: string; topicTitle: string; subject: string; grade: number; hits: number }>();
  for (const m of MATERIALS_CATALOG) {
    const key = `${m.subject}:${m.grade}:${m.topicSlug}`;
    const prev = counts.get(key);
    if (prev) {
      prev.hits += 1;
    } else {
      counts.set(key, {
        topicSlug: m.topicSlug,
        topicTitle: m.topicTitle,
        subject: m.subject,
        grade: m.grade,
        hits: 1,
      });
    }
  }
  return [...counts.values()].sort((a, b) => b.hits - a.hits || a.grade - b.grade).slice(0, 12);
})();

/**
 * Проекция каталога для фильтра.
 *
 * Раньше страница рисовала все 150 карточек `MaterialCard` прямо на сервере
 * («Весь каталог»). Каждая карточка — это ~1,4 КБ разметки с длинными
 * Tailwind-классами, и в RSC-payload она уезжала второй раз. Итог: 819 КБ
 * HTML, из которых половина — дублирующая копия одной и той же выдачи.
 *
 * Фильтру нужны только слаг, заголовок и признаки для отбора. Всё остальное
 * (описание на 250–800 символов, текст темы, счётчик заданий, сложность,
 * автор) лежит на странице самого материала и в фильтре не используется —
 * поэтому в проекцию не входит. Замерено: тонкая проекция весит 47 КБ
 * против 166 КБ у полного каталога, а 150 карточек разметки не рендерятся
 * вовсе — фильтр выводит первые 12 и добавляет по 24 по кнопке.
 */
const filterItems: MaterialFilterItem[] = MATERIALS_CATALOG.map((m) => ({
  slug: m.slug,
  title: m.title,
  subject: m.subject,
  grade: m.grade,
  purpose: m.purpose,
}));

/** Эмодзи и короткое имя предмета — рисуются в карточке фильтра. */
const subjectMeta = Object.fromEntries(
  subjects
    .filter((s) => (getSubject(s.slug) ?? null) !== null)
    .map((s) => [s.slug, { emoji: s.emoji, shortTitle: s.shortTitle }]),
);

/**
 * Предметы для формы сдачи материала.
 *
 * Список тот же, что у фильтра и конструктора, — источник один. Форма уходит в
 * браузер, поэтому предметы передаются пропсом, а не импортом в клиентский
 * компонент: иначе в бандл уехал бы весь файл таксономии.
 */
const submitSubjectOptions = subjects.map((s) => ({
  value: s.slug,
  label: `${s.emoji} ${s.shortTitle}`,
}));

/**
 * Оформление списка УМК задано один раз на контейнере через
 * arbitrary-варианты Tailwind (`[&>div]:…`, `[&>div>a]:…`).
 *
 * В списке 126 учебников в 21 строке. Когда строки классов стояли на каждой
 * ссылке и на каждой строке, они уезжали и в разметку, и в RSC-payload —
 * почти 40 КБ на страницу. Здесь класс один, а элементы внутри чистые.
 * Вид не меняется: это те же utility-классы, просто заданные выше.
 */
const UMK_LIST_CLASS = [
  "space-y-5",
  "[&>div]:flex [&>div]:flex-wrap [&>div]:items-center [&>div]:gap-2",
  "[&>div>span]:text-sm [&>div>span]:font-medium [&>div>span]:text-warm-800",
  "[&>div>span]:w-full [&>div>span]:sm:w-auto [&>div>span]:sm:min-w-[11rem]",
  "[&>div>a]:inline-flex [&>div>a]:items-center [&>div>a]:px-3.5 [&>div>a]:py-1.5",
  "[&>div>a]:rounded-full [&>div>a]:border [&>div>a]:border-warm-200 [&>div>a]:bg-white",
  "[&>div>a]:text-sm [&>div>a]:text-warm-700 [&>div>a]:transition-colors",
  "[&>div>a]:hover:border-brand-300 [&>div>a]:hover:bg-brand-50",
].join(" ");

/**
 * Оформление ссылок «Каталога по цели» — по той же причине, что и у УМК.
 *
 * Селектор проходит через `li`: ссылка лежит внутри элемента списка, поэтому
 * `[&>div>ul>a]` не срабатывал и плашки выглядели как обычный текст.
 */
const PURPOSE_LIST_CLASS = [
  "space-y-8",
  "[&>div>ul]:flex [&>div>ul]:flex-wrap [&>div>ul]:gap-2 [&>div>ul]:list-none [&>div>ul]:p-0",
  "[&>div>ul>li>a]:rounded-full [&>div>ul>li>a]:border [&>div>ul>li>a]:border-warm-200",
  "[&>div>ul>li>a]:bg-white [&>div>ul>li>a]:px-3.5 [&>div>ul>li>a]:py-1.5",
  "[&>div>ul>li>a]:text-sm [&>div>ul>li>a]:text-warm-700 [&>div>ul>li>a]:transition-colors",
  "[&>div>ul>li>a]:hover:border-brand-300 [&>div>ul>li>a]:hover:bg-brand-50",
  "[&>div>ul>li>a]:hover:text-brand-800",
].join(" ");

/** Оформление ссылок «Избранных тем» — как у остальных списков на странице. */
const TOPIC_LIST_CLASS = [
  "flex flex-wrap gap-2",
  "[&>li>a]:group [&>li>a]:inline-flex [&>li>a]:items-center [&>li>a]:gap-2 [&>li>a]:h-9",
  "[&>li>a]:rounded-full [&>li>a]:border [&>li>a]:border-warm-200 [&>li>a]:bg-white",
  "[&>li>a]:px-4 [&>li>a]:text-sm [&>li>a]:text-warm-800 [&>li>a]:transition-colors",
  "[&>li>a]:hover:border-brand-300 [&>li>a]:hover:bg-brand-50 [&>li>a]:hover:text-brand-800",
  "[&>li>a>span]:text-[color:var(--text-muted)]",
].join(" ");

export default function MaterialsHubPage() {
  const subjectCounts = getSubjectCounts();
  /** Предметы, у которых задан хотя бы один УМК, — для блока «По учебнику». */
  const umkSubjects = subjects.filter((s) => (getUMK(s.slug) ?? []).length > 0);

  return (
    <>
      {/* Хиро */}
      <section className="relative overflow-hidden bg-gradient-to-b from-warm-50 to-white pt-12 sm:pt-16 pb-12">
        <div className="absolute inset-0 -z-10 bg-grid opacity-50" />
        <div className="container-tight">
          <div className="max-w-3xl">
            <Badge tone="brand" className="mb-4">
              <Sparkles className="w-3 h-3" />
              Каталог образцов
            </Badge>
            <h1 className="text-4xl sm:text-5xl font-display font-bold tracking-tight text-balance">
              Каталог листов по школьной программе
            </h1>
            {/*
              ТЗ-26 Б-4, вариант Б (решение владельца 13.10.2026): скачивания
              из каталога не делаем. Раньше здесь стояло «Банк наполняется» и
              «Здесь будут материалы, которые вы сами создали» — то есть
              страница обещала учителю его собственные файлы, которых там нет
              и не было. Теперь страница говорит правду: это каталог образцов,
              а файл появляется после генерации в конструкторе.
            */}
            <p className="mt-5 text-lg text-warm-600 text-pretty max-w-2xl">
              Каталог показывает, какие листы и по каким темам можно собрать.
              Откройте любой образец и сделайте такой же в конструкторе — со
              своими числами и под свой класс. Готовый файл появляется после
              генерации, на странице материала его нет.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Button
                as="link"
                href="/constructor"
                variant="primary"
                size="lg"
                leftIcon={<Sparkles className="w-4 h-4" />}
              >
                Создать свой лист
              </Button>
              <Button as="link" href="#categories" variant="secondary" size="lg">
                Смотреть по цели
              </Button>
              {/* Кнопка авторской части листа 5.1.1: учитель отдаёт свой материал
                  на модерацию прямо с этой страницы. */}
              <SubmitMaterialDialog subjectOptions={submitSubjectOptions} />
            </div>
          </div>
        </div>
      </section>

      {/*
        Каталог с фильтрами.

        Раньше здесь стояли шесть карточек `MaterialCard`, а ниже — ещё 150 в
        блоке «Весь каталог», плюс 30 в «Каталоге по цели». Всего страница
        рендерила 186 карточек: это и есть раздувание, из-за которого файл
        весил 819 КБ вместо 150.

        Теперь выдача одна и она фильтруется. Заголовок про «чаще всего
        берут» убрали раньше вместе с выдуманным счётчиком: обещать учителю
        популярность, которую мы не считали, нельзя.
      */}
      <section id="catalog" className="py-12 sm:py-16">
        <div className="container-tight">
          <div className="mb-6">
            <h2 className="text-2xl sm:text-3xl font-display font-bold tracking-tight">
              Каталог материалов
            </h2>
            <p className="mt-2 text-sm text-warm-500">
              Выберите предмет и класс — список сузится. Кнопки и подписи работают
              с клавиатуры.
            </p>
          </div>
          <MaterialsFilter
            items={filterItems}
            purposeLabels={MATERIAL_PURPOSE_LABELS}
            subjectMeta={subjectMeta}
          />
        </div>
      </section>

      {/*
        Материалы учителей (лист 5.1.1).

        Отдельный блок от редакционного каталога не из оформления, а из смысла:
        это ЧУЖАЯ работа, которую принёс человек. Такую публикацию нельзя смешивать
        с нашими образцами — иначе учитель, взяв материал, не поймёт, чей он, и
        решит, что это наша проверка.

        Что здесь НЕ написано: сколько учителей смотрит каталог, сколько раз
        скачали и «как набрать популярность». Счётчик скачиваний настоящий и
        считает нажатия, а аудитории у нас нет — обещать её нечем.

        Список приезжает в браузер: сайт собран статически, а материалы появляются
        после модерации, то есть уже после сборки. Поэтому здесь нет ни числа
        материалов, ни счётчика в заголовке — их пришлось бы выдумать.
      */}
      <section id="teacher-materials" className="py-12 sm:py-16 bg-warm-50 border-y border-warm-100">
        <div className="container-tight">
          <div className="mb-6 max-w-2xl">
            <h2 className="text-2xl sm:text-3xl font-display font-bold tracking-tight">
              Материалы учителей
            </h2>
            <p className="mt-2 text-sm text-warm-600">
              Сюда попадают работы, которые учитель принёс сам, а владелец сайта
              посмотрел и разрешил. У каждого материала подписан автор — так вы
              видите, чья это работа. Чужую работу можно скачать и взять в свой
              кабинет, но нельзя поправить или снять: это делает только автор.
            </p>
          </div>
          <UserMaterialsList />
        </div>
      </section>

      {/*
        Блок «По учебнику». На странице банка материалов УМК не упоминались
        ни разу, хотя именно по этой странице учитель ищет «материалы по
        Виленкину». Список собирается из `umk.ts` — того же источника, что и
        фильтр в конструкторе. Предметы берём из таксономии, чтобы не дублировать
        список вручную; пустой блок не выводится.

        Иконку `BookOpen` из ссылок убрали: список содержит 126 УМК, а одна
        отрисованная иконка — 452 байта, то есть 57 КБ инлайнового SVG на
        страницу (замерено). Иконка не несла смысла: рядом стоит название
        учебника текстом, а ссылка и так подписана.

        Б-7. Текст выше переписан. Здесь стояло «Задания собираются под
        конкретный УМК, а не „по предмету вообще“» — обещание, которое код
        не выполняет: параметр `?umk=` не читает ни одна страница (проверено
        поиском по `searchParams` и по конструктору), поэтому ссылка просто
        возвращала на ту же страницу предмета. Отбор по учебнику в
        конструкторе есть, но включается только для тем, у которых проставлены
        метки `umk`, а таких тем сейчас единицы (алгебра, 7–9 класс).
        Ссылка ведёт на страницу предмета — это правда, и она полезнее
        обещания. Сама реализация отбора по УМК — отдельная задача.
      */}
      {umkSubjects.length > 0 && (
        <section className="py-12 sm:py-16">
          <div className="container-tight">
            <h2 className="text-2xl sm:text-3xl font-display font-bold tracking-tight mb-2">
              Материалы под ваш учебник
            </h2>
            <p className="text-sm text-warm-500 mb-6 max-w-2xl">
              Учебники, по которым ведётся предмет. Выберите свой — откроется
              страница предмета с темами и заданиями.
            </p>
            <div className={UMK_LIST_CLASS}>
              {umkSubjects.map((s) => (
                <div key={s.slug}>
                  <span>{s.title}</span>
                  {(getUMK(s.slug) ?? []).map((entry) => (
                    <Link key={entry.id} href={`/subject/${s.slug}?umk=${entry.id}`}>
                      {umkEntryLabel(entry)}
                    </Link>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/*
        Категории по цели.

        Раньше здесь стояло 30 карточек `MaterialCard` — 42 КБ разметки и
        столько же в RSC-payload. Карточки показывали те же записи каталога,
        что и фильтр выше, поэтому заменили их ссылкой-плашкой: ссылка на
        `/material/<slug>/` остаётся (она нужна перелинковке), а оболочки
        карточки с превью и бейджами — нет.

        Как и в блоке УМК, оформление ссылок задано один раз на контейнере:
        30 ссылок × длинная строка классов × два места (разметка и
        RSC-payload) — это ровно тот вес, который уносил страницу за 200 КБ.
      */}
      <section id="categories" className="py-12 sm:py-16 bg-warm-50 border-y border-warm-100">
        <div className="container-tight">
          <h2 className="text-2xl sm:text-3xl font-display font-bold tracking-tight mb-2">
            Каталог по цели
          </h2>
          <p className="text-sm text-warm-500 mb-8 max-w-2xl">
            Пять категорий — как у крупных каталогов. Выбирайте то, что вам нужно прямо сейчас.
          </p>

          <div className={PURPOSE_LIST_CLASS}>
            {MATERIAL_PURPOSE_ORDER.map((purpose) => {
              const items = getMaterialsByPurpose(purpose, 6);
              return (
                <div key={purpose}>
                  <div className="[&>h3]:text-xl [&>h3]:font-semibold [&>h3]:text-warm-950 [&>span]:text-sm [&>span]:text-warm-500 mb-3 flex flex-wrap items-baseline gap-3">
                    <h3>{MATERIAL_PURPOSE_LABELS[purpose]}</h3>
                    <span>{MATERIAL_PURPOSE_HINTS[purpose]}</span>
                  </div>
                  <ul>
                    {items.map((m) => (
                      <li key={m.slug}>
                        <Link href={`/material/${m.slug}/`}>{m.title}</Link>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Топ-предметы */}
      <section className="py-12 sm:py-16">
        <div className="container-tight">
          <h2 className="text-2xl sm:text-3xl font-display font-bold tracking-tight mb-6">
            Материалы по предметам
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {subjectCounts.map(({ subject, count }) => {
              const info = getSubject(subject);
              return (
                <Link
                  key={subject}
                  href={`/subject/${subject}/`}
                  className="group rounded-2xl border border-warm-100 bg-white p-4 shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:border-warm-200 hover:shadow-soft-lg"
                >
                  <span className="text-xl" aria-hidden>
                    {info?.emoji ?? "📄"}
                  </span>
                  <p className="mt-2 font-medium text-warm-950 group-hover:text-brand-700 transition-colors">
                    {info?.shortTitle ?? subject}
                  </p>
                  <p className="text-xs text-warm-500 mt-0.5">
                    {count} {count === 1 ? "материал" : "материалов"}
                  </p>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/*
        Избранные темы. Иконку `Layers` убрали по той же причине, что и
        `BookOpen` в блоке УМК: она повторялась в каждой ссылке, а рядом
        текстом стоит название темы. Ссылка и так подписана.
      */}
      <section className="py-12 sm:py-16 bg-warm-50 border-y border-warm-100">
        <div className="container-tight">
          <h2 className="text-2xl sm:text-3xl font-display font-bold tracking-tight mb-6">
            Избранные темы
          </h2>
          <ul className={TOPIC_LIST_CLASS}>
            {featuredTopics.map((t) => (
              <li key={`${t.subject}:${t.grade}:${t.topicSlug}`}>
                <Link href={`/subject/${t.subject}/${t.grade}/${t.topicSlug}/`}>
                  {t.topicTitle}
                  <span>{t.grade} класс</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/*
        «Весь каталог» раньше рисовал все 150 карточек `MaterialCard` —
        205 КБ чистой разметки, плюс столько же в RSC-payload. Это был
        главный источник раздувания страницы.

        Все 150 записей уже доступны учителю: через фильтр выше (с названием
        предмета, классом и целью) и через страницы предметов. Дублировать
        их третьим способом на хабе незачем, поэтому здесь осталась только
        ссылка на конструктор.
      */}
      <section className="py-12 sm:py-16">
        <div className="container-tight">
          <div className="rounded-2xl border border-brand-100 bg-brand-50/60 p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <p className="text-base sm:text-lg text-warm-800 leading-snug sm:max-w-xl">
              Не нашли нужный формат? Соберите свой лист по теме и классу — это занимает
              меньше минуты.
            </p>
            <Link
              href="/constructor"
              className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-xl bg-brand-500 text-white font-medium shadow-brand hover:bg-brand-600 active:bg-brand-700 transition-all whitespace-nowrap"
            >
              Открыть конструктор
              <ArrowRight className="w-4 h-4" aria-hidden />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
