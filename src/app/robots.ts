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
        allow: "/",
        disallow: ["/api/", "/dashboard", "/preview/", "/form/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}