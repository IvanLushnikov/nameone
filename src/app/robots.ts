import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Next 16 при `output: "export"` требует от маршрутов-метаданных явного
// указания, что их нужно запечь в статику на этапе сборки. Без этой строки
// сборка падает на этапе сбора данных страницы: «export const dynamic =
// "force-static" not configured on route /robots.txt».
export const dynamic = "force-static";

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