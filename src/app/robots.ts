import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        // TZ-12: `/form/` — страница ученика с токеном в query. Индексировать
        // нельзя (в индексе может осесть ссылка с чужим токеном), поэтому
        // закрываем и обходом, иFollow=false уже в metadata страницы.
        //
        // `/superpower` — админский раздел. Закрыт ДВУМЯ слоями, и это
        // осознанно: в разметке страницы стоит noindex, но один слой — это
        // один сбой сборки, после которого весь раздел с экранами выручки и
        // себестоимости уходит в индекс вместе с описанием того, что там
        // можно посмотреть. Обход — не замена noindex, а страховка на случай,
        // если meta-тег потеряется.
        allow: "/",
        disallow: ["/api/", "/dashboard", "/preview/", "/form/", "/superpower"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}