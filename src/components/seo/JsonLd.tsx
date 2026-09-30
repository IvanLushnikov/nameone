/**
 * SEO: единый компонент для вставки JSON-LD (schema.org) в DOM.
 *
 * Использование:
 *   import { JsonLd } from "@/components/seo";
 *
 *   // Один schema-объект:
 *   <JsonLd data={{ "@context": "https://schema.org", "@type": "Organization", ... }} />
 *
 *   // Несколько schema на одной странице (например, Organization + WebSite):
 *   <JsonLd data={[ orgSchema, siteSchema ]} />
 *
 * Без side-effects, чистая презентационная компонента. JSON сериализуется
 * без отступов (экономия байт в DOM, парсится одинаково валидно).
 *
 * TZ-10 §5.2 / §9.2 (P0): убрать дубли <script type="application/ld+json"> по страницам.
 */

export type JsonLdData = Record<string, unknown>;

export interface JsonLdProps {
  /** Один schema-объект или массив schema-объектов (для нескольких типов на странице). */
  data: JsonLdData | JsonLdData[];
  /** Опциональный id для тега <script> (полезно для отладки в DevTools). */
  id?: string;
}

export function JsonLd({ data, id }: JsonLdProps) {
  const payload = JSON.stringify(data);
  return (
    <script
      id={id}
      type="application/ld+json"
      // JSON.stringify даёт валидный JSON; вставляем как строку в dangerouslySetInnerHTML.
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: payload }}
    />
  );
}