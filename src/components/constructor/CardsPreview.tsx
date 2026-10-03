"use client";

import * as React from "react";
import type { CardSet, FlashCard } from "@/lib/types";
import { formatDate } from "@/lib/utils/cn";
import { WorksheetScale } from "./WorksheetScale";
import { CARDS_PER_SHEET, ensureCardsPrintStyles, paginateCards } from "@/lib/utils/cards-print";
import { SITE_HOST } from "@/lib/site";

interface Props {
  set: CardSet;
}

/**
 * A4-превью карточек (TZ-16 §3.1).
 *
 * Лейаут повторяет `LessonPlanPreview.tsx`: та же обёртка `.worksheet-page`
 * (210mm × 297mm) и тот же `WorksheetScale` — лист масштабируется под экран,
 * на печати принудительно 1:1 (см. `@media print` в globals.css).
 *
 * Сетка 2×N: две карточки в ряд, на лист 10 карточек (5 строк).
 * Лицевая сторона видна всегда, оборотная — по наведению или по клику
 * (на тач-устройствах наведения нет, поэтому нужен клик).
 *
 * Печать: кнопка вызывает `printCards()`, который инъектирует правила
 * `.cards-print-*` и открывает `window.print()`.
 *
 * Пустое состояние (`cards.length === 0`) — понятное объяснение учителю:
 * тема не нашлась в таксономии, это не ошибка генерации.
 */
export function CardsPreview({ set }: Props) {
  React.useEffect(() => {
    ensureCardsPrintStyles();
  }, []);

  if (!set.cards || set.cards.length === 0) {
    return (
      <div className="bg-warm-100 rounded-2xl p-3 sm:p-6 print:p-0 print:bg-white">
        <div className="mx-auto max-w-[800px]">
          <WorksheetScale>
            <article className="worksheet-page flex items-center justify-center min-h-[60vh] animate-fade-in print:shadow-none">
              <div className="text-center max-w-md">
                <div className="text-[10px] uppercase tracking-widest text-warm-500 mb-2">
                  Карточки
                </div>
                <h1 className="text-xl font-semibold text-warm-950 mb-1">
                  Карточки не получились
                </h1>
                <p className="text-sm text-warm-600 leading-snug">
                  Тема «{set.topic}» не нашлась в списке тем по предмету {set.subject} для{" "}
                  {set.grade} класса. Выберите тему заново — и карточки соберутся сразу.
                </p>
              </div>
            </article>
          </WorksheetScale>
        </div>
      </div>
    );
  }

  const sheets = paginateCards(set.cards);

  return (
    <div className="cards-print-root bg-warm-100 rounded-2xl p-3 sm:p-6 print:p-0 print:bg-white">
      <div className="mx-auto max-w-[800px] space-y-6">
        {sheets.map((sheet, sheetIdx) => (
          <WorksheetScale key={sheetIdx}>
            <article className="worksheet-page cards-print-sheet animate-fade-in print:shadow-none">
              {/* Шапка листа: скрывается на печати — на листе нужны только карточки */}
              <header className="cards-print-header flex items-start justify-between pb-3 mb-4 border-b-2 border-warm-950">
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-warm-500">
                    Карточки для запоминания
                  </div>
                  <h1 className="text-xl font-bold text-warm-950 mt-1">
                    {set.title.replace(/^Карточки · /, "")}
                  </h1>
                  <div className="text-xs text-warm-600 mt-1">
                    {set.subject} · {set.grade} класс · {set.cards.length} карт. ·{" "}
                    {sheets.length} лист.
                  </div>
                </div>
                <div className="text-right text-xs text-warm-500 shrink-0">
                  <div>УчЛист</div>
                  <div className="mt-0.5">{formatDate(set.createdAt)}</div>
                  <div className="mt-2 inline-block px-2 py-0.5 rounded border border-brand-300 text-brand-700 text-[10px] font-semibold">
                    Режьте по рамкам
                  </div>
                </div>
              </header>

              {/* Сетка карточек 2×5 */}
              <div className="cards-print-grid grid grid-cols-2 gap-3">
                {sheet.map((card, i) => (
                  <CardTile
                    key={`${sheetIdx}-${i}`}
                    card={card}
                    index={sheetIdx * CARDS_PER_SHEET + i + 1}
                  />
                ))}
                {/* Недостающие до 10 ячеек — пустые рамки, чтобы сетка была ровной */}
                {Array.from({ length: Math.max(0, CARDS_PER_SHEET - sheet.length) }).map(
                  (_, i) => (
                    <div key={`pad-${i}`} className="cards-print-card border border-warm-200 rounded-lg min-h-[52mm]" />
                  )
                )}
              </div>

              <footer className="cards-print-footer mt-6 pt-3 border-t border-warm-200 flex items-center justify-between text-[10px] text-[color:var(--text-muted)]">
                <span>УчЛист · {SITE_HOST}</span>
                <span>Наведите или нажмите на карточку, чтобы увидеть ответ</span>
              </footer>
            </article>
          </WorksheetScale>
        ))}
      </div>
    </div>
  );
}

/**
 * Одна карточка. Показывать `back` нужно и по наведению, и по клику:
 * на тач-устройствах hover не срабатывает.
 */
function CardTile({ card, index }: { card: FlashCard; index: number }) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="cards-print-card group relative border border-warm-200 rounded-lg bg-white p-4 min-h-[52mm] flex flex-col print:border-black">
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="text-[10px] font-mono text-[color:var(--text-muted)]">#{index}</span>
        {card.category && (
          <span className="text-[9px] uppercase tracking-wide text-brand-700 bg-brand-100 rounded px-1.5 py-0.5 shrink-0">
            {card.category}
          </span>
        )}
      </div>

      <div className="text-[14px] font-semibold text-warm-950 leading-snug mb-auto">
        {card.front}
      </div>

      {/* Оборотная сторона: видна при наведении ИЛИ при раскрытии кликом.
          На печати скрывается правилом `.cards-print-back`. */}
      <div
        className={`cards-print-back cards-print-card__fold mt-3 pt-2 border-t border-dashed border-warm-300 text-[12px] text-warm-700 leading-snug ${
          open ? "block" : "hidden group-hover:block"
        }`}
      >
        {card.back}
      </div>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? "Скрыть ответ" : "Показать ответ"}
        className="no-print absolute inset-0 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
      />
    </div>
  );
}
