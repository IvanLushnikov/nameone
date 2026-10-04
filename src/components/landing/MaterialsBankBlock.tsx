import Link from "next/link";
import { plural } from "@/lib/utils/cn";
import { ArrowRight, Layers, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { MaterialCard } from "@/components/materials/MaterialCard";
import {
  MATERIALS_CATALOG,
  MATERIAL_PURPOSE_LABELS,
  MATERIAL_PURPOSE_ORDER,
  getTopMaterials,
} from "@/lib/content/materials-catalog";

/**
 * Блок «Банк материалов» на главной — по образцу `WeeklyTopicBlock` (TZ-09).
 * Показывает, что каталог есть и он живой: топ-6 карточек + пять категорий по цели.
 */
export function MaterialsBankBlock() {
  const top = getTopMaterials(6);
  const counts = MATERIAL_PURPOSE_ORDER.map((purpose) => ({
    purpose,
    count: MATERIALS_CATALOG.filter((m) => m.purpose === purpose).length,
  }));

  return (
    <section
      data-materials-bank-block
      className="py-12 sm:py-16 bg-white border-y border-warm-100"
    >
      <div className="container-tight">
        <div className="text-center mb-8">
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-600 mb-2">
            Банк материалов
          </p>
          <h2 className="text-2xl sm:text-3xl font-display font-bold tracking-tight">
            Готовые материалы по школьной программе
          </h2>
          <p className="mt-3 text-sm text-warm-500 max-w-2xl mx-auto">
            {MATERIALS_CATALOG.length} материалов для учителя. Нашли подходящий — соберём такой
            же под ваш класс за 30 секунд.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {top.map((m) => (
            <MaterialCard key={m.slug} material={m} compact />
          ))}
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
          <Layers className="w-4 h-4 text-warm-600" aria-hidden />
          {counts.map(({ purpose, count }) => (
            <Badge key={purpose} tone="warm">
              {/* Без единицы «Проверить — 30» ничего не значило. */}
              {MATERIAL_PURPOSE_LABELS[purpose]} — {count}{" "}
              {plural(count, "материал", "материала", "материалов")}
            </Badge>
          ))}
        </div>

        <div className="mt-8 flex justify-center">
          <Link
            href="/materials/"
            className="inline-flex items-center justify-center gap-2 h-11 px-6 rounded-xl bg-brand-500 text-white font-medium shadow-brand hover:bg-brand-600 active:bg-brand-700 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand-500"
          >
            <Sparkles className="w-4 h-4" aria-hidden />
            Открыть банк материалов
            <ArrowRight className="w-4 h-4" aria-hidden />
          </Link>
        </div>
      </div>
    </section>
  );
}
