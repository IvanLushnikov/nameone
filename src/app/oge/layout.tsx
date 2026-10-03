import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site";

/**
 * Метаданные /oge живут здесь, а не в page.tsx: страница — клиентский
 * компонент («use client»), а export const metadata в таком файле запрещён.
 * Layout — серверный компонент, и его metadata покрывают всю сегментную
 * страницу. Корневой layout (src/app/layout.tsx) не трогаем: он даёт
 * template "%s · УчЛист", поэтому бренд в title руками не пишем.
 *
 * Число заданий в description намеренно НЕ названо: длина варианта не
 * фиксирована. Демо-мок собирает 6 заданий (src/lib/mock/generator.ts),
 * а настоящий вариант с бэка собирается по реальной структуре экзамена
 * (Часть 1 — 1…19, Часть 2 — 20…25 для ОГЭ). Одно число в описании
 * гарантированно соврёт.
 */
export const metadata: Metadata = {
  title: "ОГЭ и ЕГЭ — тренажёр с разбором по ФГОС",
  description:
    "Варианты ОГЭ и ЕГЭ с разбором: задания по программе, ответы и пояснения к каждому, первичные баллы. Тренажёр входит в тариф Плюс.",
  alternates: { canonical: `${SITE_URL}/oge` },
};

export default function OgeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
