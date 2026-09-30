import type { MetadataRoute } from "next";
import { subjects } from "@/lib/content/subjects";
import { EXAM_SUBJECTS } from "@/lib/content/exam-taxonomy";
import { WEEKLY_TOPICS } from "@/lib/content/weekly-topics";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://rabochielisty.ru";

  // TZ-10 §5.3 / §9.8: добавили lastModified. Таксономия (subjects/topics/grades)
  // не содержит полей updatedAt/createdAt — Next.js подставит дату сборки,
  // что и требуется для "время последнего изменения контента".
  const now = new Date();

  const staticPages: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified: now, priority: 1, changeFrequency: "daily" },
    { url: `${base}/constructor`, lastModified: now, priority: 1, changeFrequency: "weekly" },
    { url: `${base}/oge`, lastModified: now, priority: 0.9, changeFrequency: "weekly" },
    { url: `${base}/pricing`, lastModified: now, priority: 0.8, changeFrequency: "weekly" },
    { url: `${base}/dashboard`, lastModified: now, priority: 0.4, changeFrequency: "monthly" },
    { url: `${base}/login`, lastModified: now, priority: 0.3, changeFrequency: "yearly" },
  ];

  // Subject hubs
  const subjectPages = subjects.map((s) => ({
    url: `${base}/subject/${s.slug}`,
    lastModified: now,
    priority: 0.8,
    changeFrequency: "weekly" as const,
  }));

  // Grade + topic pages — самое важное для SEO
  const topicPages: MetadataRoute.Sitemap = [];
  for (const s of subjects) {
    for (const g of s.grades) {
      topicPages.push({
        url: `${base}/subject/${s.slug}/${g.num}`,
        lastModified: now,
        priority: 0.7,
        changeFrequency: "weekly" as const,
      });
      for (const t of g.topics) {
        topicPages.push({
          url: `${base}/subject/${s.slug}/${g.num}/${t.slug}`,
          lastModified: now,
          priority: 0.6,
          changeFrequency: "weekly" as const,
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
            lastModified: now,
            priority: 0.6,
            changeFrequency: "monthly" as const,
          },
          {
            url: `${base}/presentation/${s.slug}/${g.num}/${t.slug}`,
            lastModified: now,
            priority: 0.6,
            changeFrequency: "monthly" as const,
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
        lastModified: now,
        priority: 0.7,
        changeFrequency: "monthly" as const,
      });
    }
  }

  // F-04-B: SEO-страницы по номерам ОГЭ/ЕГЭ — источник exam-taxonomy.ts
  const examPages: MetadataRoute.Sitemap = EXAM_SUBJECTS.flatMap((s) =>
    s.numbers.map((n) => ({
      url: `${base}/exam/${s.exam}/${s.subject}/${n.number}`,
      lastModified: now,
      priority: 0.6,
      changeFrequency: "monthly" as const,
    })),
  );

  // TZ-09: «Тема недели» — поыточный сезонный трафик
  const themePages: MetadataRoute.Sitemap = WEEKLY_TOPICS.map((t) => ({
    url: `${base}/theme/${t.seoSlug}/`,
    lastModified: now,
    priority: 0.7,
    changeFrequency: "weekly" as const,
  }));

  return [
    ...staticPages,
    ...subjectPages,
    ...topicPages,
    ...artifactTopicPages,
    ...ktpPages,
    ...examPages,
    ...themePages,
  ];
}