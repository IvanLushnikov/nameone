/**
 * TZ-16 §3.1: печать карточек на A4 (PDF через `window.print()`).
 *
 * Новые зависимости не нужны: тот же приём, что у рабочих листов —
 * `window.print()` + `@media print` в глобальных стилях
 * (`src/app/globals.css`, блок `@media print` и класс `no-print`).
 *
 * Почему не правим `globals.css`: файл содержит чужие незакоммиченные правки
 * (другие сессии), а глобальный `@media print` уже занят листами.
 * Поэтому карточки печатаются своими классами `.cards-print-*`, а готовые
 * правила отдаются наружу двумя способами:
 *   • `CARDS_PRINT_CSS` — строка, её можно целиком вставить в общий
 *     `@media print`-блок, когда оркестратор будет делать интеграцию;
 *   • `ensureCardsPrintStyles()` — ленивая инъекция в `<style>`, если
 *     интеграции в globals.css ещё нет.
 * Правила скоупированы по префиксу `.cards-print-`, поэтому конфликтов
 * с существующим блоком печати нет.
 *
 * Разметка листа: сетка 2×5 = 10 карточек на страницу, у каждой рамка
 * и пунктирная линия сгиба (учитель режет по рамке, перегибает по пунктиру).
 */

/** Сколько карточек помещается на один лист A4 — сетка 2×5. */
export const CARDS_PER_SHEET = 10;

/**
 * Готовые CSS-правила печати.
 *
 * Сознательно НЕ включает `@page` и `.no-print` — это уже есть в
 * `globals.css`, дублировать нельзя.
 */
export const CARDS_PRINT_CSS = `
/* TZ-16 §3.1: карточки 2×5 на A4. Дополняет общий @media print в globals.css. */
@media print {
  .cards-print-root {
    padding: 0 !important;
    margin: 0 !important;
    background: none !important;
    display: block !important;
  }
  .cards-print-sheet {
    width: 100% !important;
    box-shadow: none !important;
    border: 0 !important;
    border-radius: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    page-break-after: always;
    break-after: page;
  }
  .cards-print-sheet:last-child {
    page-break-after: auto;
    break-after: auto;
  }
  .cards-print-grid {
    display: grid !important;
    grid-template-columns: repeat(2, 1fr) !important;
    grid-auto-rows: 52mm !important;
    gap: 0 !important;
  }
  .cards-print-card {
    border: 1px solid #000 !important;
    border-radius: 0 !important;
    box-shadow: none !important;
    background: #fff !important;
    min-height: 52mm !important;
    padding: 4mm !important;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  /* Линия сгиба: карточку перегибают пополам, лицевая сторона вверх. */
  .cards-print-card__fold {
    border-top: 1px dashed #666 !important;
    background: none !important;
    height: auto !important;
    min-height: 0 !important;
    margin: 0 !important;
  }
  .cards-print-header,
  .cards-print-footer {
    display: none !important;
  }
  /* Бэк скрыт на печати: режем карточки, ответы — на отдельном листе (опция учителя). */
  .cards-print-back {
    display: none !important;
  }
}
`;

/** id инъецированного `<style>` — по нему же идёт защита от двойной вставки. */
const STYLE_ID = "cards-print-styles";

/**
 * Инъектирует правила печати в документ (один раз за сессию).
 * SSR-safe: без `document` ничего не делает.
 */
export function ensureCardsPrintStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CARDS_PRINT_CSS;
  document.head.appendChild(style);
}

/**
 * Разбивает карточки на листы по 10 штук (сетка 2×5).
 * Экспортировано отдельно, чтобы интеграция могла рендерить листы
 * без обращения к `window.print()`.
 */
export function paginateCards<T>(cards: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < cards.length; i += CARDS_PER_SHEET) {
    out.push(cards.slice(i, i + CARDS_PER_SHEET));
  }
  return out;
}

/**
 * Печать карточек: гарантируем наличие правил и вызываем `window.print()`.
 * В диалоге печати учитель выбирает «Сохранить как PDF».
 */
export function printCards(): void {
  if (typeof window === "undefined") return;
  ensureCardsPrintStyles();
  window.print();
}
