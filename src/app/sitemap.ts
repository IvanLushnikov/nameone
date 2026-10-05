import type { MetadataRoute } from "next";
import { subjects } from "@/lib/content/subjects";
import { EXAM_SUBJECTS } from "@/lib/content/exam-taxonomy";
import { WEEKLY_TOPICS } from "@/lib/content/weekly-topics";
import { MATERIALS_CATALOG, materialToSitemapEntry } from "@/lib/content/materials-catalog";
import { SITE_URL } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = SITE_URL;

  // TZ-10 §5.3 / §9.8: `lastModified` убрали намеренно. Таксономия
  // (subjects/topics/grades) не содержит полей updatedAt/createdAt, поэтому
  // Next.js подставлял таймстамп сборки — одинаковый для всех ~1854 URL.
  // Google такие значения считает недостоверными и игнорирует, поэтому честнее
  // не отдавать поле вообще, чем отдавать враньё. Вернём lastModified, когда
  // в таксономии появятся реальные createdAt/updatedAt.
  // `changeFrequency` тоже убрали: поисковики его не используют.

  const staticPages: MetadataRoute.Sitemap = [
    { url: `${base}/`, priority: 1 },
    { url: `${base}/constructor`, priority: 1 },
    { url: `${base}/oge`, priority: 0.9 },
    // Оглавление всех предметов (создано в TZ-10). Ставим перед /pricing —
    // список отсортирован по убыванию priority, и /subject — хаб с priority 0.8.
    { url: `${base}/subject`, priority: 0.8 },
    { url: `${base}/pricing`, priority: 0.8 },
    // TZ-15: хаб «Банка материалов» — вход в каталог из поиска.
    { url: `${base}/materials`, priority: 0.8 },
    // /dashboard и /login в карту не попадают намеренно: это закрытые
    // страницы (см. robots.ts → disallow), отдавать их в sitemap нельзя.
  ];

  // Subject hubs
  const subjectPages = subjects.map((s) => ({
    url: `${base}/subject/${s.slug}`,
    priority: 0.8,
  }));

  // Grade + topic pages — самое важное для SEO
  const topicPages: MetadataRoute.Sitemap = [];
  for (const s of subjects) {
    for (const g of s.grades) {
      topicPages.push({
        url: `${base}/subject/${s.slug}/${g.num}`,
        priority: 0.7,
      });
      for (const t of g.topics) {
        topicPages.push({
          url: `${base}/subject/${s.slug}/${g.num}/${t.slug}`,
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
      url: `${base}/exam/${s.exam}/${s.subject}/${n.number}`,
      priority: 0.6,
    })),
  );

  // TZ-09: «Тема недели» — поыточный сезонный трафик
  const themePages: MetadataRoute.Sitemap = WEEKLY_TOPICS.map((t) => ({
    url: `${base}/theme/${t.seoSlug}/`,
    priority: 0.7,
  }));

  // TZ-15 §5.4: «Банк материалов» — редакционный каталог из git.
  // Статический экспорт, поэтому страницы строятся только по тому, что в репозитории.
  // `materialToSitemapEntry` (вне моего скоупа) собирает запись с lastModified/
  // changeFrequency — здесь оставляем только url/priority, чтобы формат карты
  // был единым. Сама функция не меняется.
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
    ...themePages,
    ...materialPages,
  ];
}
