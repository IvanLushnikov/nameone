import Link from "next/link";
import { Star, Users } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import {
  MATERIAL_PURPOSE_LABELS,
  materialArtifactLabel,
  type MaterialEntry,
} from "@/lib/content/materials-catalog";
import { getSubject } from "@/lib/content/subjects";

/** Превью-плашка: тип материала + предмет. Настоящей картинки в Фазе 1 нет. */
const PREVIEW_TONES: Record<MaterialEntry["purpose"], string> = {
  check: "from-brand-100 to-brand-50 text-brand-800",
  explain: "from-blue-100 to-blue-50 text-blue-800",
  engage: "from-accent-100 to-accent-50 text-accent-800",
  ready: "from-emerald-100 to-emerald-50 text-emerald-800",
  decorate: "from-warm-100 to-warm-50 text-warm-800",
};

export interface MaterialCardProps {
  material: MaterialEntry;
  /** Компактный вид — для сеток на главной, где много плиток. */
  compact?: boolean;
}

/**
 * Плитка материала для «Банка материалов» (TZ-15 §5.3).
 * Серверный компонент: весь каталог статический, никакого fetch.
 */
export function MaterialCard({ material, compact = false }: MaterialCardProps) {
  const subject = getSubject(material.subject);
  const href = `/material/${material.slug}/`;

  return (
    <Link
      href={href}
      className="group flex flex-col overflow-hidden rounded-2xl border border-warm-100 bg-white shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:border-warm-200 hover:shadow-soft-lg"
    >
      {/* Превью */}
      <div
        className={`flex h-24 items-center justify-center bg-gradient-to-br ${PREVIEW_TONES[material.purpose]} ${compact ? "" : "sm:h-28"}`}
      >
        <div className="text-center px-4">
          <p className="text-xs font-medium uppercase tracking-wider opacity-70">
            {subject?.emoji ?? "📄"} {materialArtifactLabel(material.artifactType)}
          </p>
          <p className="mt-1 text-sm font-semibold leading-tight">
            {subject?.shortTitle ?? material.subject} · {material.grade} класс
          </p>
        </div>
      </div>

      <div className="flex flex-1 flex-col p-4 sm:p-5">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <Badge tone="brand">{MATERIAL_PURPOSE_LABELS[material.purpose]}</Badge>
          <Badge tone="warm">{material.grade} класс</Badge>
        </div>

        <h3 className="font-semibold leading-snug text-warm-950 transition-colors group-hover:text-brand-700 line-clamp-3">
          {material.title}
        </h3>

        {!compact && (
          <p className="mt-2 line-clamp-3 text-sm text-warm-600">{material.description}</p>
        )}

        {/* Социальное доказательство: сколько учителей взяли в работу */}
        <div className="mt-auto flex items-center gap-4 pt-4 text-xs text-warm-500">
          <span className="inline-flex items-center gap-1">
            <Users className="w-3.5 h-3.5" aria-hidden />
            {material.usesCount} взяли в работу
          </span>
          <span className="inline-flex items-center gap-1">
            <Star className="w-3.5 h-3.5 fill-accent-400 text-accent-400" aria-hidden />
            {material.rating.toFixed(1)}
            <span className="text-[color:var(--text-muted)]">({material.ratingCount})</span>
          </span>
        </div>
      </div>
    </Link>
  );
}
