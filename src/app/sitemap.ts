import type { MetadataRoute } from "next";
import { subjects } from "@/lib/content/subjects";
import { EXAM_SUBJECTS } from "@/lib/content/exam-taxonomy";
import { WEEKLY_TOPICS } from "@/lib/content/weekly-topics";
import { MATERIALS_CATALOG, materialToSitemapEntry } from "@/lib/content/materials-catalog";
import { SITE_URL } from "@/lib/site";

// Next 16 при `output: "export"` требует явного указания статики на
// маршрутах метаданных, иначе сборка падает на сборе данных страницы.
// Подробности — в комментарии к такой же строке в `robots.ts`.
export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = SITE_URL;

  // Завершающий слэш обязателен: в `next.config.mjs` стоит `trailingSlash: true`,
  // поэтому `canonical` на каждой странице — со слэшем (`…/exam/oge/math/1/`).
  // Раньше здесь писали url("/exam") и подобное, то есть карта отдавала адреса
  // БЕЗ слэша, и она разошлась с каноникой на 1640 записях из 1641. Поисковики
  // такую пару обычно сводят сами, но «обычно» — не «правильно»: приоритет
  // отдаётся канонике, и расхождение лишний раз тратит сигнал на угадывание.
  //
  // Правило простое: адрес без слэша (корень — исключение) дописываем им же.
  const url = (path: string): string =>
    path === "/" ? `${base}/` : `${base}${path.replace(/\/+$/, "")}/`;

  // TZ-10 §5.3 / §9.8: `lastModified` убрали намеренно. Таксономия
  // (subjects/topics/grades) не содержит полей updatedAt/createdAt, поэтому
  // Next.js подставлял таймстамп сборки — одинаковый для всех ~1854 URL.
  // Google такие значения считает недостоверными и игнорирует, поэтому честнее
  // не отдавать поле вообще, чем отдавать враньё. Вернём lastModified, когда
  // в таксономии появятся реальные createdAt/updatedAt.
  // `changeFrequency` тоже убрали: поисковики его не используют.

  const staticPages: MetadataRoute.Sitemap = [
    { url: url("/"), priority: 1 },
    { url: url("/constructor"), priority: 1 },
    // Хабы экзаменов (аудит P0-1 / P0-3). До их появления все 218 страниц
    // заданий лежали в карте сиротами: входящих ссылок на них не было ни
    // откуда. Теперь путь от главной — два клика.
    { url: url("/exam"), priority: 0.9 },
    { url: url("/exam/oge"), priority: 0.9 },
    { url: url("/exam/ege"), priority: 0.9 },
    { url: url("/oge"), priority: 0.9 },
    // Оглавление всех предметов (создано в TZ-10). Ставим перед /pricing —
    // список отсортирован по убыванию priority, и /subject — хаб с priority 0.8.
    { url: url("/subject"), priority: 0.8 },
    { url: url("/pricing"), priority: 0.8 },
    // TZ-15: хаб «Банка материалов» — вход в каталог из поиска.
    { url: url("/materials"), priority: 0.8 },
    // Страницы доверия (аудит P1-3): до них все три отдавали 404, а для
    // сервиса с приёмом оплаты это критично. /contact/ обязателен по 54-ФЗ.
    { url: url("/about"), priority: 0.6 },
    { url: url("/contact"), priority: 0.6 },
    { url: url("/methodology"), priority: 0.6 },
    // /register намеренно НЕ попадает в карту: страница помечена
    // noindex, follow — это тонкий дубль /login. В sitemap.noindex-страницам
    // места нет, иначе робот будет переходить по ней и упираться в запрет.
    //
    // /dashboard и /login в карту не попадают намеренно: это закрытые
    // страницы (см. robots.ts → disallow), отдавать их в sitemap нельзя.
  ];

  // Subject hubs
  const subjectPages = subjects.map((s) => ({
    url: url(`/subject/${s.slug}`),
    priority: 0.8,
  }));

  // Grade + topic pages — самое важное для SEO
  const topicPages: MetadataRoute.Sitemap = [];
  for (const s of subjects) {
    for (const g of s.grades) {
      topicPages.push({
        url: url(`/subject/${s.slug}/${g.num}`),
        priority: 0.7,
      });
      for (const t of g.topics) {
        topicPages.push({
          url: url(`/subject/${s.slug}/${g.num}/${t.slug}`),
          priority: 0.6,
        });
      }
    }
  }

  // TZ-21 §3.3 (блокер 3) / SEO-аудит P0-5: страницы артефактов
  // (`/lesson-plan/*`, `/presentation/*`, `/ktp/*`) сняты из карты сайта — 2140 URL.
  //
  // ПОЧЕМУ. Текст на них шаблонный: страницы отличаются только названием предмета
  // и цифрой класса (проверено на трёх КТП подряд — отличаются словом «Алгебра»).
  // Это профиль «массовый тонкий контент», который поисковики сворачивают
  // ПОСТРАНИЧНО, а в худшем случае целиком вместе с каталогом предмета. 2140 таких
  // URL в карте — против ~1500 нормальных страниц вокруг: рискуем выдачей целиком.
  //
  // ЧТО СДЕЛАНО НЕ ТАК. Сами страницы НЕ удалены и НЕ закрыты noindex — по ссылке
  // (например, из внешнего источника или старой закладки) они должны открываться,
  // иначе получим битые ссылки вместо тонкого контента. В sitemap.xml попадают
  // только те, кто туда положен.
  //
  // КОГДА ВЕРНУТЬ. Возвращаем порциями, по мере наполнения реальным содержимым,
  // а не сразу все 2140 (ТЗ-21 P2, п.20 «Наполнить страницы артефактов реальным
  // содержимым, вернуть в карту сайта»). Условие для возврата конкретного URL:
  // на странице появился уникальный текст по этой теме, которого нет на соседних
  // страницах того же предмета (хотя бы 2–3 уникальных абзаца + примеры заданий
  // именно по этой теме). Возвращать начинаем с сильных тем предмета, не с конца
  // алфавита, и по частям — 200 страниц, смотреть индексацию, потом следующие 200.
  //
  // Отдельный сигнал к пересмотру решения: если после снятия из карты в Метрике
  // падает трафик на /subject/* — значит, по этим URL всё-таки приходили запросы
  // и страницы стоит наполнять в первую очередь.

  // F-04-B: SEO-страницы по номерам ОГЭ/ЕГЭ — источник exam-taxonomy.ts
  const examPages: MetadataRoute.Sitemap = EXAM_SUBJECTS.flatMap((s) =>
    s.numbers.map((n) => ({
      url: url(`/exam/${s.exam}/${s.subject}/${n.number}`),
      priority: 0.6,
    })),
  );

  // Хабы предметов внутри экзамена (аудит P0-1). Появились после проверки:
  // страницы заданий ссылались на `/exam/<экзамен>/<предмет>/` («все задания
  // предмета»), а такого адреса не строилось — 218 ссылок в 404. Теперь это
  // настоящие страницы, и без них ссылка «все задания предмета» снова повисла бы
  // в воздухе. Собираются из тех же EXAM_SUBJECTS, поэтому предмет, у которого
  // нет ни одного номера, в карту не попадёт.
  const examSubjectPages: MetadataRoute.Sitemap = Array.from(
    new Set(EXAM_SUBJECTS.map((s) => `${s.exam}/${s.subject}`)),
  ).map((path) => ({
    url: url(`/exam/${path}`),
    priority: 0.7,
  }));

  // TZ-09: «Тема недели» — поыточный сезонный трафик
  const themePages: MetadataRoute.Sitemap = WEEKLY_TOPICS.map((t) => ({
    url: url(`/theme/${t.seoSlug}/`),
    priority: 0.7,
  }));

  // TZ-15 §5.4: «Банк материалов» — редакционный каталог из git.
  // Статический экспорт, поэтому страницы строятся только по тому, что в репозитории.
  // `materialToSitemapEntry` (вне моего скоупа) собирает запись с lastModified/
  // changeFrequency — здесь оставляем только url/priority, чтобы формат карты
  // был единым. Сама функция не меняется.
  //
  // ПОЧЕМУ ЭТИ URL ОСТАЮТСЯ В КАРТЕ. Аудит предлагал убрать `/material/*` и
  // закрыть от индекса, посчитав их пользовательским контентом. Проверено по
  // коду: это неверно. `app/material/[slug]/page.tsx` кормится единственным
  // источником — `MATERIALS_CATALOG`, git-модуль с редакционным каталогом,
  // `generateStaticParams` возвращает `MATERIALS_CATALOG.map(...)`. Базы
  // пользовательских публикаций в проекте нет, адреса детерминированные
  // (заголовок + хэш для снятия коллизий), автор у всех записей один.
  // Убрать их = выбросить 150 живых страниц. Поэтому остаются.
  //
  // Когда появится настоящий пользовательский контент, директива уже
  // действует на уровне записи, а не маршрута (см. `materialOrigin.ts`):
  // материал учителя уходит в `noindex, follow`, редакционный остаётся в индексе.
  const materialPages: MetadataRoute.Sitemap = MATERIALS_CATALOG.map((m) => {
    const { url, priority } = materialToSitemapEntry(m, base);
    return { url, priority };
  });

  return [
    ...staticPages,
    ...subjectPages,
    ...topicPages,
    // ...artifactTopicPages и ...ktpPages — намеренно не входят: см. комментарий
    // выше про тонкий контент (ТЗ-21 §3.3). Код-генераторы оставлены в истории
    // git, чтобы наполнение страниц вернуть одной правкой, а не с нуля.
    ...examPages,
    ...examSubjectPages,
    ...themePages,
    ...materialPages,
  ];
}
