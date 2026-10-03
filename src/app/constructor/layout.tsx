import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site";

/**
 * Метаданные /constructor живут здесь, а не в page.tsx: страница — клиентский
 * компонент («use client»), а export const metadata в таком файле запрещён.
 * Layout — серверный компонент, и его metadata покрывают всю страницу.
 *
 * До этого файла страница наследовала description главной, поэтому в выдаче
 * конструктор и главная выглядели одинаково. Своё описание здесь — и своё
 * слово «ИИ», а не «AI»: аудитория школьная.
 *
 * Корневой layout (src/app/layout.tsx) даёт template "%s · УчЛист", поэтому
 * бренд в title руками не пишем — иначе будет «… · УчЛист · УчЛист».
 */
export const metadata: Metadata = {
  title: "Конструктор рабочего листа",
  description:
    "Соберите рабочий лист по своему предмету, классу и теме: задания, ответы и пояснения, файл A4 для печати. Генерация листа занимает около 30 секунд.",
  alternates: { canonical: `${SITE_URL}/constructor` },
};

export default function ConstructorLayout({ children }: { children: React.ReactNode }) {
  return children;
}
