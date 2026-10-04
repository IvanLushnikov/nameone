/**
 * SEO: блок FAQ с JSON-LD FAQPage.
 *
 * Использование:
 *   <FaqBlock faqs={[
 *     { question: "Сколько заданий в листе?", answer: "От 5 до 30 ..." },
 *     ...
 *   ]} />
 *
 * TZ-10 §5.2 / §6.2 / §9.5 (P0): FAQPage JSON-LD на теме с 3–5 вопросами.
 *
 * Использует нативный <details>/<summary> — zero-JS accordion,
 * работает без JS и доступен для screen readers.
 */

import { JsonLd } from "./JsonLd";
import type { JsonLdData } from "./JsonLd";

export interface FaqItem {
  question: string;
  /** Допускается простой текст, многострочный через \n — рендерится как <p>. */
  answer: string;
}

export interface FaqBlockProps {
  faqs: FaqItem[];
  /** Заголовок блока. */
  title?: string;
  /** Подпись под заголовком. */
  subtitle?: string;
  /** id для связи aria-labelledby (по умолчанию "faq"). */
  id?: string;
}

export function FaqBlock({
  faqs,
  title = "Часто задаваемые вопросы",
  subtitle = "Коротко о том, как устроен рабочий лист по этой теме.",
  id = "faq",
}: FaqBlockProps) {
  // Пустой FAQ — не рендерим ничего (и не плодим пустой JSON-LD).
  if (!faqs || faqs.length === 0) return null;

  const ld: JsonLdData = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: f.answer,
      },
    })),
  };

  return (
    <>
      <section
        aria-labelledby={`${id}-title`}
        className="py-12 sm:py-16 border-t border-warm-100"
      >
        <div className="container-tight">
          <h2
            id={`${id}-title`}
            className="text-2xl sm:text-3xl font-display font-bold mb-2 text-warm-950"
          >
            {title}
          </h2>
          {subtitle && (
            <p className="text-warm-600 mb-6 text-sm sm:text-base">{subtitle}</p>
          )}
          <div className="space-y-2">
            {faqs.map((f, idx) => (
              <details
                key={idx}
                className="group rounded-xl border border-warm-100 bg-white shadow-soft open:shadow-soft-lg transition-shadow"
              >
                <summary className="cursor-pointer list-none flex items-start justify-between gap-3 px-5 py-4 font-medium text-warm-950 hover:text-brand-700 transition-colors">
                  <span className="flex-1">{f.question}</span>
                  <span
                    aria-hidden
                    className="mt-1 text-warm-600 text-xs transition-transform group-open:rotate-180 shrink-0"
                  >
                    ▼
                  </span>
                </summary>
                <div className="px-5 pb-4 -mt-1 text-warm-700 leading-relaxed text-sm sm:text-base whitespace-pre-line">
                  {f.answer}
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>
      <JsonLd data={ld} id="ld-faq" />
    </>
  );
}