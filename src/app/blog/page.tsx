import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Breadcrumb } from "@/components/seo";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { SITE_URL } from "@/lib/site";
import { getAllPosts, formatDate } from "./_lib/posts";

export const metadata: Metadata = {
  title: { absolute: "Блог о рабочих листах и уроках — УчЛист" },
  description:
    "Разборы тем школьной программы, типичные ошибки учеников, подготовка к ОГЭ и советы по планированию. Материалы для учителей и репетиторов.",
  alternates: { canonical: `${SITE_URL}/blog` },
  openGraph: {
    type: "website",
    title: "Блог о рабочих листах и уроках — УчЛист",
    description:
      "Разборы тем школьной программы, типичные ошибки учеников, подготовка к ОГЭ и советы по планированию. Материалы для учителей и репетиторов.",
    url: `${SITE_URL}/blog`,
    siteName: "УчЛист",
    locale: "ru_RU",
    images: [{ url: `${SITE_URL}/og/default.png`, width: 1200, height: 630, alt: "Блог УчЛист" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Блог о рабочих листах и уроках — УчЛист",
    description:
      "Разборы тем школьной программы, типичные ошибки учеников, подготовка к ОГЭ и советы по планированию.",
    images: [`${SITE_URL}/og/default.png`],
  },
};

export default function BlogIndexPage() {
  const posts = getAllPosts();

  return (
    <div className="container-tight py-8 sm:py-12">
      <Breadcrumb
        className="flex flex-wrap items-center text-sm mb-5"
        items={[
          { name: "Главная", url: "/" },
          { name: "Блог", url: "" },
        ]}
      />

      <header className="max-w-3xl">
        <h1 className="text-3xl sm:text-4xl font-display font-bold tracking-tight text-balance">
          Блог
        </h1>
        <p className="mt-4 text-lg text-warm-600 text-pretty">
          Разборы тем, типичные ошибки учеников и подготовка к экзаменам. Каждый пост —
          рабочий материал: бери и делай по нему урок, даже если не знаешь про УчЛист.
        </p>
      </header>

      {/* Список. Рубрики не фильтруем: постов пока четыре, фильтр на четырёх
          карточках — это кнопка, которая ничего не убирает. Появится рубрика —
          добавим фильтр здесь, в списке, не в постах. */}
      <div className="mt-10 grid gap-6 sm:grid-cols-2">
        {posts.map((post) => (
          <Link key={post.slug} href={`/blog/${post.slug}`} className="group">
            <Card hover className="h-full flex flex-col">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="brand">{post.category}</Badge>
                <time dateTime={post.date} className="text-xs text-warm-500">
                  {formatDate(post.date)}
                </time>
              </div>
              <h2 className="mt-3 font-display font-bold text-xl text-warm-950 group-hover:text-brand-700 transition-colors text-pretty">
                {post.title}
              </h2>
              <p className="mt-2 text-sm text-warm-600 text-pretty flex-1">{post.description}</p>
              <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700">
                Читать
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </span>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}