import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Calendar } from "lucide-react";
import { Breadcrumb, JsonLd } from "@/components/seo";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { SITE_URL } from "@/lib/site";
import { getPost, getPostSlugs, getRelatedPosts, formatDate } from "../_lib/posts";

type Props = { params: { slug: string } };

/**
 * Страница поста блога: `/blog/<slug>/`.
 *
 * Статический экспорт требует `generateStaticParams` — без него Next не знает,
 * какие адреса записать в `out/`. `dynamicParams = false` закрывает путь
 * «зашли по несуществующему слагу, а страница неожиданно отрисовалась».
 */
export function generateStaticParams() {
  return getPostSlugs().map((slug) => ({ slug }));
}

export const dynamicParams = false;

/**
 * Длина title и description проверяется на сборке, а не «на глаз».
 * Лимит title — 60 символов: за ним в выдаче Google обрезается заголовок.
 * Description держим в 155–160 — это длина с которой сниппет не режется
 * ещё сильнее. Сборка падает, а не «длина разъедется по сантиметрам».
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = getPost(params.slug);
  if (!post) return { title: "Пост не найден" };

  if (post.title.length > 60) {
    throw new Error(
      `Title поста ${post.slug} — ${post.title.length} символов, максимум 60: «${post.title}»`,
    );
  }
  if (post.description.length < 155 || post.description.length > 160) {
    throw new Error(
      `Description поста ${post.slug} — ${post.description.length} символов, нужно 155–160: «${post.description}»`,
    );
  }

  const canonical = `${SITE_URL}/blog/${post.slug}`;
  const ogImage = `${SITE_URL}${post.ogImage}`;

  return {
    // `absolute` — без шаблона «%s · УчЛист» из корневого layout. Лимит в 60
    // символов задан на весь заголовок в выдаче, и дописывать к нему ещё
    // десять символов бренда значит вылезти за него. В og:title бренд остаётся
    // отдельным полем siteName.
    title: { absolute: post.title },
    description: post.description,
    alternates: { canonical },
    openGraph: {
      type: "article",
      title: post.title,
      description: post.description,
      url: canonical,
      siteName: "УчЛист",
      locale: "ru_RU",
      publishedTime: post.date,
      authors: ["Команда УчЛист"],
      images: [{ url: ogImage, width: 1200, height: 630, alt: post.title }],
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.description,
      images: [ogImage],
    },
  };
}

export default function BlogPostPage({ params }: Props) {
  const post = getPost(params.slug);
  if (!post) notFound();

  const related = getRelatedPosts(post.slug);
  const canonical = `${SITE_URL}/blog/${post.slug}`;

  // BreadcrumbList разметку рендерит сам компонент <Breadcrumb>, здесь только BlogPosting.
  const blogPosting = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    image: [`${SITE_URL}${post.ogImage}`],
    datePublished: post.date,
    // Даты правки у поста нет: она была бы выдуманной. В `dateModified`
    // ставим дату публикации — посты дописываем в ту же дату, отдельного
    // «обновлено» нет.
    dateModified: post.date,
    inLanguage: "ru-RU",
    mainEntityOfPage: { "@type": "WebPage", "@id": canonical },
    author: { "@type": "Organization", name: "Команда УчЛист", url: SITE_URL },
    publisher: {
      "@type": "Organization",
      name: "УчЛист",
      url: SITE_URL,
      logo: { "@type": "ImageObject", url: `${SITE_URL}/og/default.png` },
    },
    articleSection: post.category,
  };

  return (
    <article className="container-tight py-8 sm:py-12">
      <JsonLd data={blogPosting} id="ld-blogposting" />

      <Breadcrumb
        className="flex flex-wrap items-center text-sm mb-5"
        items={[
          { name: "Главная", url: "/" },
          { name: "Блог", url: "/blog" },
          { name: post.title, url: "" },
        ]}
      />

      <header className="max-w-3xl">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <Badge tone="brand">{post.category}</Badge>
          <span className="inline-flex items-center gap-1.5 text-sm text-warm-600">
            <Calendar className="w-4 h-4" aria-hidden />
            <time dateTime={post.date}>{formatDate(post.date)}</time>
          </span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-display font-bold tracking-tight text-balance">
          {post.title}
        </h1>
        <p className="mt-4 text-lg text-warm-600 text-pretty">{post.description}</p>
      </header>

      {/* Тело поста. Ширина ограничена 720px: строка длиннее — читать неудобно.
          Стили — арбитражными вариантами Tailwind прямо здесь. Плагина
          @tailwindcss/typography в проекте нет, а править `globals.css` вне
          этого маршрута нельзя, поэтому абзацы, списки и заголовки описаны
          селекторами-потомками: правило статьи живёт вместе с самой статьёй. */}
      <div className="mt-10 max-w-[45rem] text-warm-800 text-[1.05rem] leading-[1.75]
        [&_a]:text-brand-700 [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-brand-800
        [&_h2]:font-display [&_h2]:font-bold [&_h2]:text-2xl [&_h2]:text-warm-950 [&_h2]:mt-10 [&_h2]:mb-3
        [&_h3]:font-display [&_h3]:font-bold [&_h3]:text-xl [&_h3]:text-warm-950 [&_h3]:mt-8 [&_h3]:mb-2
        [&_p]:mt-4 [&_p]:first:mt-0
        [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ul_li]:mt-2
        [&_ol]:mt-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol_li]:mt-2
        [&_strong]:font-semibold [&_strong]:text-warm-950
        [&_blockquote]:border-l-4 [&_blockquote]:border-brand-300 [&_blockquote]:bg-brand-50 [&_blockquote]:rounded-r-xl [&_blockquote]:px-5 [&_blockquote]:py-3 [&_blockquote]:mt-6 [&_blockquote]:text-warm-700
        [&_table]:w-full [&_table]:mt-6 [&_td]:border [&_td]:border-warm-200 [&_td]:p-2 [&_td]:align-top
        [&_th]:border [&_th]:border-warm-200 [&_th]:bg-warm-50 [&_th]:p-2 [&_th]:text-left
        [&_code]:bg-warm-100 [&_code]:rounded [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[0.95em]">
        {/* HTML приходит из наших же .md-файлов в репозитории: `renderMarkdown`
            экранирует сырые теги, так что произвольную разметку сюда не вставить. */}
        {/* eslint-disable-next-line react/no-danger */}
        <div dangerouslySetInnerHTML={{ __html: post.html }} />
      </div>

      <div className="mt-12 max-w-[45rem]">
        <Card className="bg-brand-50 border-brand-100">
          <h2 className="font-display font-bold text-warm-950 text-lg">Что дальше</h2>
          <p className="text-sm text-warm-700 mt-2">
            Готовый лист по любой теме ФГОС можно собрать бесплатно — без регистрации даются
            три листа. Это быстрее, чем верстать вёрстку в Word.
          </p>
          <div className="flex flex-wrap gap-3 mt-4">
            <Link
              href="/constructor"
              className="inline-flex items-center gap-2 rounded-full bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 transition-colors"
            >
              Собрать рабочий лист
              <ArrowRight className="w-4 h-4" aria-hidden />
            </Link>
            <Link
              href="/blog"
              className="inline-flex items-center gap-2 rounded-full border border-warm-300 px-5 py-2.5 text-sm font-semibold text-warm-800 hover:bg-warm-50 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden />
              Все посты блога
            </Link>
          </div>
        </Card>
      </div>

      {related.length > 0 && (
        <section className="mt-12">
          <h2 className="font-display font-bold text-warm-950 text-xl mb-4">
            Ещё посты блога
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((p) => (
              <Link key={p.slug} href={`/blog/${p.slug}`} className="group">
                <Card hover className="h-full">
                  <Badge tone="neutral">{p.category}</Badge>
                  <h3 className="mt-3 font-display font-bold text-warm-950 group-hover:text-brand-700 transition-colors text-pretty">
                    {p.title}
                  </h3>
                  <p className="mt-2 text-sm text-warm-600 text-pretty">{p.description}</p>
                  <time dateTime={p.date} className="mt-3 block text-xs text-warm-500">
                    {formatDate(p.date)}
                  </time>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}