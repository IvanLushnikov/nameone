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

  // TZ-06: SEO-страницы по артефактам (lesson-plan / presentation) под тему.
  const artifactTopicPages: MetadataRoute.Sitemap = [];
  for (const s of subjects) {
    for (const g of s.grades) {
      for (const t of g.topics) {
        artifactTopicPages.push(
          {
            url: `${base}/lesson-plan/${s.slug}/${g.num}/${t.slug}`,
            priority: 0.6,
          },
          {
            url: `${base}/presentation/${s.slug}/${g.num}/${t.slug}`,
            priority: 0.6,
          }
        );
      }
    }
  }

  // TZ-06: SEO-страницы по КТП (без [topic] — на весь год).
  const ktpPages: MetadataRoute.Sitemap = [];
  for (const s of subjects) {
    for (const g of s.grades) {
      ktpPages.push({
        url: `${base}/ktp/${s.slug}/${g.num}`,
        priority: 0.7,
      });
    }
  }

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
    ...artifactTopicPages,
    ...ktpPages,
    ...examPages,
    ...themePages,
    ...materialPages,
  ];
}
