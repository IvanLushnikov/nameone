import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Check, X, ExternalLink, Calendar, ArrowRight } from "lucide-react";
import { Breadcrumb, FaqBlock, JsonLd } from "@/components/seo";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { SITE_URL } from "@/lib/site";
import { COMPARE_PAGES, getComparePage, TABLE_FOOTNOTE, VERIFIED_NOTE } from "../_lib/compare-data";
import type { ComparePage } from "../_lib/compare-data";

type Props = { params: { slug: string } };

/**
 * Сравнительные страницы: `/compare/<slug>/`.
 *
 * Три адреса, все статические. `generateStaticParams` отдаёт список слагов из
 * `compare-data.ts`, `dynamicParams = false` закрывает путь «зашли по
 * несуществующему слагу, а страница неожиданно отрисовалась».
 */
export function generateStaticParams() {
  return COMPARE_PAGES.map((p) => ({ slug: p.slug }));
}

export const dynamicParams = false;

/**
 * Длины title и description проверяются на сборке, а не на глаз: заголовок
 * длиннее 60 символов обрезается в выдаче, а слишком короткое описание
 * съедает строку сниптета. `scripts/check-seo-content.mjs` проверяет то же
 * по собранному `out/`, но падать дешевле на типах.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = getComparePage(params.slug);
  if (!page) return { title: "Сравнение не найдено" };

  if (page.title.length > 60) {
    throw new Error(
      `Title сравнения ${page.slug} — ${page.title.length} символов, максимум 60: «${page.title}»`,
    );
  }
  if (page.description.length < 120 || page.description.length > 160) {
    throw new Error(
      `Description сравнения ${page.slug} — ${page.description.length} символов, нужно 120–160: «${page.description}»`,
    );
  }

  const canonical = `${SITE_URL}/compare/${page.slug}`;
  const ogImage = `${SITE_URL}${page.ogImage}`;

  return {
    // `absolute` — без шаблона «%s · УчЛист» из корневого layout: лимит в 60
    // символов задан на весь заголовок в выдаче.
    title: { absolute: page.title },
    description: page.description,
    alternates: { canonical },
    openGraph: {
      type: "article",
      title: page.title,
      description: page.description,
      url: canonical,
      siteName: "УчЛист",
      locale: "ru_RU",
      images: [{ url: ogImage, width: 1200, height: 630, alt: page.title }],
    },
    twitter: {
      card: "summary_large_image",
      title: page.title,
      description: page.description,
      images: [ogImage],
    },
  };
}

/** Ячейка «да» / «нет» с крестиком там, где функции нет. */
function Mark({ value, ours }: { value: string; ours: boolean }) {
  if (value === "есть") {
    return (
      <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700">
        <Check className="w-4 h-4 shrink-0" aria-hidden />
        есть
      </span>
    );
  }
  if (value === "нет") {
    return (
      <span className="inline-flex items-center gap-1.5 font-medium text-rose-700">
        <X className="w-4 h-4 shrink-0" aria-hidden />
        нет
      </span>
    );
  }
  return (
    <span className={ours ? "text-warm-800" : "text-warm-600"}>{value}</span>
  );
}

function CompareTable({ page, blockIndex }: { page: ComparePage; blockIndex: number }) {
  const block = page.blocks[blockIndex];
  return (
    <section className="mt-10">
      <h2 className="text-2xl font-bold text-warm-950">{block.title}</h2>
      {block.intro ? (
        <p className="mt-2 text-warm-700 max-w-3xl">{block.intro}</p>
      ) : null}

      <Card padded={false} className="overflow-x-auto mt-4">
        <table className="w-full min-w-[720px] text-left">
          <thead>
            <tr className="border-b border-warm-200">
              <th className="text-sm font-semibold text-warm-700 px-6 py-4 w-[30%]">
                Что сравниваем
              </th>
              <th className="text-sm font-semibold text-warm-950 px-4 py-4 bg-brand-50 w-[35%]">
                {block.oursLabel}
              </th>
              <th className="text-sm font-semibold text-warm-700 px-4 py-4 w-[35%]">
                {block.theirsLabel}
              </th>
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row) => (
              <tr key={row.feature} className="border-b border-warm-100 last:border-0 align-top">
                <th scope="row" className="text-sm font-medium text-warm-800 px-6 py-4">
                  {row.feature}
                </th>
                <td className="text-sm text-warm-900 px-4 py-4 bg-brand-50/40">
                  <Mark value={row.ours} ours />
                </td>
                <td className="text-sm text-warm-700 px-4 py-4">
                  {row.theirs ? (
                    <Mark value={row.theirs} ours={false} />
                  ) : (
                    <span className="text-warm-500">не проверяли</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Пояснение к строке — под таблицей, а не в ячейке: в ячейке его не прочитать. */}
      <ul className="mt-3 space-y-1.5">
        {block.rows
          .filter((r) => r.note)
          .map((r) => (
            <li key={`note-${r.feature}`} className="text-sm text-warm-600">
              <span className="font-medium text-warm-700">{r.feature}:</span> {r.note}
            </li>
          ))}
      </ul>
    </section>
  );
}

function ListBlock({
  title,
  items,
  tone,
}: {
  title: string;
  items: { title: string; body: string }[];
  tone: "brand" | "warm";
}) {
  return (
    <section className="mt-10">
      <h2 className="text-2xl font-bold text-warm-950">{title}</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {items.map((item) => (
          <Card key={item.title}>
            <h3 className="font-semibold text-warm-950">{item.title}</h3>
            <p className="mt-1.5 text-sm text-warm-700">{item.body}</p>
          </Card>
        ))}
      </div>
      {tone === "warm" ? (
        <p className="mt-3 text-sm text-warm-600">
          Перечислено по страницам конкурентов 14 октября 2026 года и по коду УчЛиста. Мы пишем это прямо,
          чтобы страницу можно было читать как сравнение, а не как рекламу.
        </p>
      ) : null}
    </section>
  );
}

export default function ComparePageView({ params }: Props) {
  const page = getComparePage(params.slug);
  if (!page) notFound();

  const canonical = `${SITE_URL}/compare/${page.slug}`;
  const ogImage = `${SITE_URL}${page.ogImage}`;

  // Даты правки у этих страниц нет: они публикуются в день сверки фактов,
  // и отдельного «обновлено» не существует. Ставим дату проверки в
  // dateModified, чтобы расхождение с текстом не выглядело ошибкой.
  const verifiedDate = "2026-10-14";

  const article = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: page.title,
    description: page.description,
    image: [ogImage],
    datePublished: verifiedDate,
    dateModified: verifiedDate,
    inLanguage: "ru-RU",
    mainEntityOfPage: { "@type": "WebPage", "@id": canonical },
    author: { "@type": "Organization", name: "Команда УчЛист", url: SITE_URL },
    publisher: {
      "@type": "Organization",
      name: "УчЛист",
      url: SITE_URL,
      logo: { "@type": "ImageObject", url: `${SITE_URL}/og/default.png` },
    },
    // Дата сверки видна поисковику и редактору: цифры конкурентов меняются,
    // и страница без такой пометки через полгода становится ложью.
    about: `${page.rival}: цены и возможности на 14 октября 2026`,
  };

  return (
    <article className="container-tight py-8 sm:py-12">
      <JsonLd data={article} id="ld-article" />

      <Breadcrumb
        className="flex flex-wrap items-center text-sm mb-5"
        items={[
          { name: "Главная", url: "/" },
          { name: page.title, url: "" },
        ]}
      />

      <header>
        <h1 className="text-3xl sm:text-4xl font-bold text-warm-950 tracking-tight">
          {page.h1}
        </h1>
        <p className="mt-4 text-lg text-warm-700 max-w-3xl">{page.lead}</p>

        {/* Отметка о дате проверки. Без неё страница протухает молча: цены
            конкурентов меняются, и проверить их уже нечем. */}
        <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start gap-3">
            <Calendar className="w-5 h-5 shrink-0 mt-0.5 text-amber-700" aria-hidden />
            <div className="text-sm text-amber-900">
              <p className="font-semibold">Данные проверены 14 октября 2026 года</p>
              <p className="mt-1">{VERIFIED_NOTE}</p>
              <p className="mt-2">
                Источник:{" "}
                <a
                  href={page.rivalUrl}
                  className="font-medium underline underline-offset-2 hover:text-amber-700"
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                >
                  {page.rivalUrlLabel}
                  <ExternalLink className="w-3.5 h-3.5 inline ml-1 -mt-0.5" aria-hidden />
                </a>
                . Полный список страниц, с которых сняты цифры, — в файле фактов{" "}
                <code className="text-xs">docs/seo/competitors-factbase-2026-10-14.md</code>.
              </p>
            </div>
          </div>
        </div>
      </header>

      {page.blocks.map((_, i) => (
        <CompareTable key={page.blocks[i].title} page={page} blockIndex={i} />
      ))}

      <p className="mt-4 text-sm text-warm-600">{TABLE_FOOTNOTE}</p>

      <ListBlock title={`Что у нас есть`} items={page.strengths} tone="brand" />
      <ListBlock title="Чего у нас нет" items={page.weaknesses} tone="warm" />

      <section className="mt-10">
        <h2 className="text-2xl font-bold text-warm-950">Кому что подходит</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Card className="border-brand-200 bg-brand-50/60">
            <Badge tone="brand">Берите УчЛист</Badge>
            <p className="mt-3 text-warm-800">{page.verdict.ours}</p>
          </Card>
          <Card>
            <Badge tone="neutral">Берите {page.rival}</Badge>
            <p className="mt-3 text-warm-700">{page.verdict.theirs}</p>
          </Card>
        </div>
      </section>

      <FaqBlock faqs={page.faqs} title="Частые вопросы" id="faq" />

      <section className="mt-10">
        <h2 className="text-2xl font-bold text-warm-950">Другие сравнения</h2>
        <div className="mt-4 flex flex-wrap gap-3">
          {page.siblings.map((s) => (
            <Link
              key={s.slug}
              href={`/compare/${s.slug}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-warm-200 bg-white px-4 py-2 text-sm font-medium text-warm-800 hover:border-brand-300 hover:text-brand-800 transition-colors"
            >
              {s.title}
              <ArrowRight className="w-4 h-4" aria-hidden />
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-10 rounded-2xl bg-brand-700 p-6 sm:p-8 text-white">
        <h2 className="text-xl font-bold">Посмотрите тарифы на свои глаза</h2>
        <p className="mt-2 text-white/85 max-w-2xl">
          Цены на этой странице — из наших тарифов. Там же видно, что входит в каждый и сколько листов
          даёт норма в месяц.
        </p>
        <Link
          href="/pricing"
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-brand-800 hover:bg-brand-50 transition-colors"
        >
          Тарифы УчЛиста
          <ArrowRight className="w-4 h-4" aria-hidden />
        </Link>
      </section>
    </article>
  );
}