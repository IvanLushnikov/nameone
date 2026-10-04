/**
 * SEO: хлебные крошки с JSON-LD BreadcrumbList.
 *
 * Использование:
 *   import { Breadcrumb } from "@/components/seo";
 *   <Breadcrumb items={[
 *     { name: "Главная", url: "/" },
 *     { name: "Математика", url: "/subject/math" },
 *     { name: "5 класс", url: "/subject/math/5" },
 *     { name: "Дроби обыкновенные", url: "" }, // текущая страница — без ссылки
 *   ]} />
 *
 * TZ-10 §5.2 / §9.4 (P0): BreadcrumbList JSON-LD на теме + визуальный блок.
 *
 * Последний item всегда рендерится как plain text (текущая страница),
 * независимо от того, передан url или нет — в BreadcrumbList это норма.
 */

import Link from "next/link";
import { SITE_URL } from "@/lib/site";
import { JsonLd } from "./JsonLd";
import type { JsonLdData } from "./JsonLd";

export interface BreadcrumbItem {
  /** Человекочитаемое имя уровня (например, "Главная", "Математика"). */
  name: string;
  /** Путь от корня сайта (например, "/subject/math/5"). Пустая строка для текущей страницы. */
  url: string;
}

export interface BreadcrumbProps {
  items: BreadcrumbItem[];
  /** Базовый URL для абсолютных ссылок в JSON-LD (по умолчанию — SITE_URL). */
  baseUrl?: string;
  /** Класс контейнера — кастомизация отступов. */
  className?: string;
}

function toAbsolute(url: string, baseUrl: string): string {
  if (!url) return baseUrl;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${baseUrl}${url.startsWith("/") ? url : `/${url}`}`;
}

export function Breadcrumb({
  items,
  baseUrl = SITE_URL,
  className,
}: BreadcrumbProps) {
  // JSON-LD: каждый item получает position + name; абсолютный url — только если он задан.
  // Для последнего (текущего) item можно опускать `item` — Schema.org это допускает.
  const ld: JsonLdData = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, idx) => {
      const listItem: Record<string, unknown> = {
        "@type": "ListItem",
        position: idx + 1,
        name: it.name,
      };
      if (it.url) {
        listItem.item = toAbsolute(it.url, baseUrl);
      }
      return listItem;
    }),
  };

  return (
    <>
      <nav
        aria-label="breadcrumb"
        className={className ?? "flex flex-wrap items-center text-sm"}
      >
        <ol className="flex flex-wrap items-center gap-x-1 gap-y-1">
          {items.map((it, idx) => {
            const isLast = idx === items.length - 1;
            const hasUrl = Boolean(it.url && it.url.length > 0);
            return (
              <li
                key={`${it.name}-${idx}`}
                className="inline-flex items-center gap-x-1"
              >
                {idx > 0 && (
                  <span aria-hidden className="text-warm-500 select-none">
                    ›
                  </span>
                )}
                {isLast || !hasUrl ? (
                  <span
                    aria-current="page"
                    className="text-warm-700 font-medium"
                  >
                    {it.name}
                  </span>
                ) : (
                  <Link
                    href={it.url}
                    className="text-warm-500 hover:text-warm-900 transition-colors"
                  >
                    {it.name}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
      <JsonLd data={ld} id="ld-breadcrumb" />
    </>
  );
}