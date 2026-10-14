import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, X } from "lucide-react";
import { Breadcrumb, JsonLd } from "@/components/seo";
import { Card } from "@/components/ui/Card";
import { PageTracker } from "@/components/shared/PageTracker";
import { catalogStats, gradeRangeLabel, subjectsWord, topicsWord } from "@/lib/content/trust";
import { SITE_URL } from "@/lib/site";
import { plural } from "@/lib/utils/cn";
import {
  HUB_COMPARE,
  HUB_POSTS,
  HUB_SECTIONS,
  HUB_SUBJECTS,
} from "./_lib/hub-data";

/**
 * Хаб «ИИ для учителя» — `/ai-dlya-uchitelya/`.
 *
 * ## Зачем эта страница
 *
 * На сайте есть восемь постов, три сравнения и каталог тем, но не было
 * страницы, которая объясняет, что это всё за одно. Хаб и есть такая
 * страница: он собирает блог, предметы и сравнения вокруг одного вопроса —
 * «где ИИ в школе помогает, а где нет».
 *
 * ## Почему здесь половина текста — про ограничения
 *
 * Учитель приходит с вопросом «а это вообще работает?». Ответ только в
 * плюс он не считает ответом: через месяц он выдаст классу лист с ошибкой и
 * сделает вывод, что его обманули. Поэтому блок «Где ИИ ломается» стоит
 * выше блока про предметы и говорит о том же, о чём говорит `/methodology/`:
 * ответ в ключе — черновик, лист перед выдачей смотрит живой человек.
 *
 * ## Почему цифры считаются, а не вписаны
 *
 * Предметы и темы лежат в таксономии (`src/lib/content/subjects.ts`) и растут
 * каждым расширением. Вписанная нами «1075 тем» через месяц разошлась бы с
 * кодом, и хаб — входной узел раздела — начал бы врать первым.
 *
 * ## Чего на странице нет
 *
 * Ни одной цифры о том, сколько времени экономит нейросеть, какой процент
 * учителей ею пользуется и насколько точны ответы. Таких замеров у проекта
 * нет, а выдуманная цифра на странице доверия обходится дороже, чем её
 * отсутствие.
 */

const HUB_PATH = "/ai-dlya-uchitelya/";
const canonicalUrl = `${SITE_URL}${HUB_PATH}`;
const ogImagePath = "/og/ai-dlya-uchitelya.png";
const ogImage = `${SITE_URL}${ogImagePath}`;

const title = "ИИ для учителя: где помогает, а где ломается";

/**
 * Описание собирается из тех же счётчиков, что и остальной текст страницы.
 *
 * Длина не обрезается, а проверяется: если в описании появится правка,
 * сборка падает с обоими числами, и новое значение правится осознанно.
 * Обрезать здесь нечего — описание и так состоит из фактов.
 */
const description = `ИИ для учителя: ${HUB_POSTS.length} ${plural(HUB_POSTS.length, "разбор", "разбора", "разборов")}, ${HUB_COMPARE.length} ${plural(HUB_COMPARE.length, "сравнение", "сравнения", "сравнений")} с конкурентами и ${catalogStats.topics} ${topicsWord} по ФГОС. Разбираем, на каких задачах нейросеть помогает учителю, а на каких ломается.`;

if (title.length > 60) {
  throw new Error(`Title хаба — ${title.length} символов, максимум 60: «${title}»`);
}
if (description.length < 150 || description.length > 160) {
  throw new Error(
    `Description хаба — ${description.length} символов, нужно 150–160: «${description}»`,
  );
}

export const metadata: Metadata = {
  // `absolute` — без шаблона «%s · УчЛист» из корневого layout: лимит в 60
  // символов задан на весь заголовок в выдаче.
  title: { absolute: title },
  description,
  alternates: { canonical: canonicalUrl },
  openGraph: {
    type: "website",
    title,
    description,
    url: canonicalUrl,
    siteName: "УчЛист",
    locale: "ru_RU",
    images: [{ url: ogImage, width: 1200, height: 630, alt: title }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [ogImage],
  },
};

/**
 * Что нейросеть закрывает без участия методиста.
 *
 * Формулировки здесь намеренно конкретные под задачу, а не «экономит время»:
 * учителю нужен ответ «с чего начать», а не обещание результата.
 */
const HELPS: { title: string; body: string }[] = [
  {
    title: "Собрать лист по теме, которая есть в программе",
    body: `Не «что-нибудь про дроби», а конкретная тема вашего класса с заданиями трёх уровней сложности. Тема приходит из каталога: ${catalogStats.subjects} ${subjectsWord}, ${catalogStats.topics} ${topicsWord} по ${gradeRangeLabel}.`,
  },
  {
    title: "Получить второй вариант того же задания",
    body: "Нужен, когда класс застрял на одном виде записи: все пишут одинаково, потому что видели один пример. Та же задача в другой формулировке сбивает этот эффект.",
  },
  {
    title: "Разобрать типичную ошибку",
    body: "Показать, как неправильное предложение выглядит в работе, и объяснить, почему оно неправильное. Два примера рядом читаются лучше, чем пересказ правила.",
  },
  {
    title: "Собрать три уровня сложности под разные группы",
    body: "Лёгкий, средний и сложный — у каждого своя рамка в баллах, а не один лист на весь класс.",
  },
  {
    title: "Перепроверить ключ",
    body: "Сервис решает задание заново и сверяет со своим ответом, расхождение помечает. Запускает проверку учитель и только по своему запросу.",
  },
];

/**
 * Где модель не справляется. Этот блок — не формальность: без него ответ
 * «да, поможет» превращается в обещание, которое продукт не держит.
 */
const BREAKS: { title: string; body: string }[] = [
  {
    title: "Он не знает ваш класс",
    body: "Задание может быть верным по программе и бессмысленным после того, что вы объясняли в прошлом месяце. Никакой памяти о вашем уроке у модели нет — есть тема и номер класса.",
  },
  {
    title: "Он не знает ваш учебник, пока вы не указали",
    body: "Без УМК темы берутся из общей программы, и это не всегда те темы, по которым вы идёте. УМК выбирается вручную, темы его учебника подставляются вручную же.",
  },
  {
    title: "Он ошибается уверенно",
    body: "Неверный ответ выглядит так же аккуратно, как верный, — отличить их на глаз нельзя. Ответ в ключе остаётся черновиком, и решение по нему принимаете вы.",
  },
  {
    title: "Он не скажет, что делать с классом",
    body: "Диагностику проходит человек: по ВПР или по пробнику вы сами решаете, к какой теме возвращаться. Лист закрывает вопрос «на чём потренировать», но не решает, кому и когда это отдать.",
  },
  {
    title: "Живой методист лист не проверяет",
    body: "Перед выдачей его смотрит человек. Это не страховка от ошибки — это условие работы с любым сгенерированным материалом.",
  },
];

/** Маршрут по задаче: «мне нужно вот это» → «открывай вот это». */
const ROUTE: { need: string; href: string; label: string }[] = [
  {
    need: "Понять, откуда берутся темы и почему лист выглядит именно так",
    href: "/methodology/",
    label: "Методика",
  },
  {
    need: "Собрать лист по своему предмету и классу",
    href: "/constructor/",
    label: "Генератор листов",
  },
  {
    need: "Найти тему по предмету и классу",
    href: "/subject/",
    label: "Каталог предметов",
  },
  {
    need: "Понять, чего УчЛист не умеет вовсе",
    href: "/compare/uchlist-ili-obuchay/",
    label: "Сравнения",
  },
  {
    need: "Посмотреть, сколько это стоит и сколько листов даёт норма",
    href: "/pricing/",
    label: "Тарифы",
  },
];

export default function AiDlyaUchitelyaPage() {
  /**
   * `CollectionPage` с `ItemList` внутри: поисковик должен увидеть оглавление,
   * а не сплошной текст. Список строится из `HUB_SECTIONS` — той же константы,
   * что рендерит блоки на странице, поэтому разметка и текст не расходятся.
   */
  const collectionPage = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: title,
    description,
    url: canonicalUrl,
    image: [ogImage],
    inLanguage: "ru-RU",
    isPartOf: { "@type": "WebSite", name: "УчЛист", url: SITE_URL },
    mainEntity: {
      "@type": "ItemList",
      name: "Что собрано на странице",
      numberOfItems: HUB_SECTIONS.length,
      itemListOrder: "https://schema.org/ItemListOrderAscending",
      itemListElement: HUB_SECTIONS.map((section, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: section.name,
        url: `${SITE_URL}${section.href}`,
      })),
    },
  };

  return (
    <>
      <PageTracker eventName="ai_dlya_uchitelya_view" />
      <JsonLd data={collectionPage} id="ld-collection" />

      <section className="bg-gradient-to-b from-warm-50 to-white pt-12 pb-14 sm:pt-16">
        <div className="container-tight">
          <Breadcrumb
            className="mb-4 flex flex-wrap items-center text-sm"
            items={[
              { name: "Главная", url: "/" },
              { name: "ИИ для учителя", url: "" },
            ]}
          />
          <h1 className="text-4xl font-display font-bold tracking-tight sm:text-5xl">
            ИИ для учителя
          </h1>
          <p className="mt-4 max-w-3xl text-lg text-warm-600">
            Здесь собрано всё, что на сайте про ИИ в школе: восемь разборов, три
            сравнения и каталог из {catalogStats.topics} {topicsWord} по ФГОС. Ниже —
            ответ на вопрос, с которого начинается разговор: где нейросеть
            выигрывает, а где вы получите правдоподобную ошибку и будете искать
            её сами.
          </p>
        </div>
      </section>

      <section className="pb-12">
        <div className="container-tight max-w-3xl space-y-12">
          <section>
            <h2 id="pomaogaet" className="text-2xl font-display font-bold tracking-tight">
              Где ИИ учителю помогает
            </h2>
            <ul className="mt-4 space-y-4">
              {HELPS.map((item) => (
                <li key={item.title} className="flex gap-3">
                  <Check className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" aria-hidden />
                  <div>
                    <p className="font-medium text-warm-950">{item.title}</p>
                    <p className="mt-1 text-warm-700">{item.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 id="lomaetsia" className="text-2xl font-display font-bold tracking-tight">
              Где ИИ ломается
            </h2>
            <p className="mt-3 text-warm-700">
              Этот список важнее предыдущего. Нейросеть, которая сошлась на
              демонстрации, и нейросеть, которая выдала ошибку в ключе, —
              один и тот же инструмент, и разница между ними обнаруживается
              только на вашем классе.
            </p>
            <ul className="mt-4 space-y-4">
              {BREAKS.map((item) => (
                <li key={item.title} className="flex gap-3">
                  <X className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" aria-hidden />
                  <div>
                    <p className="font-medium text-warm-950">{item.title}</p>
                    <p className="mt-1 text-warm-700">{item.body}</p>
                  </div>
                </li>
              ))}
            </ul>
            <Link
              href="/methodology/"
              className="mt-6 inline-flex items-center gap-1.5 font-medium text-brand-700 hover:text-brand-800"
            >
              Как собирается лист и проверяются ответы
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </section>
        </div>
      </section>

      <section className="pb-12">
        <div className="container-tight">
          <h2
            id="razbory"
            className="text-2xl font-display font-bold tracking-tight sm:text-3xl"
          >
            Разборы
          </h2>
          <p className="mt-3 max-w-3xl text-warm-600">
            {HUB_POSTS.length} {plural(HUB_POSTS.length, "материал", "материала", "материалов")}{" "}
            о баллах, ошибках и подготовке к экзаменам. Порядок не по дате:
            сначала то, что вы ищете перед ноябрём, потом методика урока.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {HUB_POSTS.map((post) => (
              <Card key={post.href} hover>
                <p className="text-xs font-medium uppercase tracking-wide text-warm-500">
                  {post.category}
                </p>
                <h3 className="mt-2 text-lg font-semibold text-warm-950">
                  <Link href={post.href} className="hover:text-brand-800">
                    {post.title}
                  </Link>
                </h3>
                <p className="mt-2 text-sm text-warm-700">{post.note}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="pb-12">
        <div className="container-tight">
          <h2
            id="predmety"
            className="text-2xl font-display font-bold tracking-tight sm:text-3xl"
          >
            Предметы
          </h2>
          <p className="mt-3 max-w-3xl text-warm-600">
            Темы лежат в каталоге, а не генерируются случайно: {catalogStats.subjects}{" "}
            {subjectsWord}, {catalogStats.topics} {topicsWord}, у {catalogStats.topicsWithSection}{" "}
            из них указан раздел ФГОС. С предмета и класса начинается любая
            генерация.
          </p>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2">
            {HUB_SUBJECTS.map((subject) => (
              <li key={subject.href}>
                <Link
                  href={subject.href}
                  className="flex h-full flex-col rounded-2xl border border-warm-100 bg-white p-4 shadow-soft transition-colors hover:border-brand-300 hover:bg-brand-50/40"
                >
                  <span className="font-medium text-warm-950">{subject.label}</span>
                  <span className="mt-1 text-sm text-warm-600">{subject.note}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="pb-12">
        <div className="container-tight">
          <h2
            id="sravneniia"
            className="text-2xl font-display font-bold tracking-tight sm:text-3xl"
          >
            Сравнения
          </h2>
          <p className="mt-3 max-w-3xl text-warm-600">
            На каждой странице есть блок «Чего у нас нет» — он длиннее блока о
            достоинствах, и специально. Цены и лимиты конкурентов сняты с их
            сайтов 14 октября 2026 года и меняются, поэтому на страницах стоит
            дата проверки.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {HUB_COMPARE.map((item) => (
              <Card key={item.href} hover>
                <h3 className="font-semibold text-warm-950">
                  <Link href={item.href} className="hover:text-brand-800">
                    {item.label}
                  </Link>
                </h3>
                <p className="mt-2 text-sm text-warm-700">{item.note}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="pb-14">
        <div className="container-tight max-w-3xl">
          <h2
            id="s-chego-nachat"
            className="text-2xl font-display font-bold tracking-tight"
          >
            С чего начать
          </h2>
          <Card padded={false} className="mt-5">
            <ul className="divide-y divide-warm-100">
              {ROUTE.map((row) => (
                <li
                  key={row.href}
                  className="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="text-warm-800">{row.need}</span>
                  <Link
                    href={row.href}
                    className="inline-flex shrink-0 items-center gap-1.5 font-medium text-brand-700 hover:text-brand-800"
                  >
                    {row.label}
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          <p className="mt-4 text-sm text-warm-600">
            Если коротко: ИИ в школе — это черновик, а не методист. Он быстро
            даёт вариант, решение остаётся за учителем.
          </p>
        </div>
      </section>
    </>
  );
}