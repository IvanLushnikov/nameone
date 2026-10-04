/**
 * Водяной знак «ДЕМО» на печатном листе.
 *
 * Зачем: экранная плашка «Это демонстрационная заготовка» в конструкторе
 * помечена `no-print` и на бумаге исчезает. Сценарий потери доверия: учитель
 * видит предупреждение → печатает → отдаёт 25 ученикам лист, на котором
 * нигде не сказано, что задания типовые. Владелец продукта выбрал водяной знак
 * (docs/tz/18-money-and-trust.md, решение №4).
 *
 * Почему `position: fixed`, а не `absolute`: лист — один поток высотой в
 * несколько страниц (`WorksheetPreview.tsx:71`, `.worksheet-page`). Абсолютный
 * знак нарисовался бы один раз, на первой странице. В режиме печати `fixed`
 * повторяется на каждой странице документа.
 *
 * Почему только на печати: на экране плашка уже есть и она заметнее, а знак
 * поверх превью мешал бы и попадал бы внутрь масштабируемой обёртки листа
 * (`.worksheet-page` имеет `transform: scale()` — внутри неё `fixed` считался бы
 * относительно этого листа, а не страницы). На печати трансформации сброшены
 * (`globals.css`, @media print), поэтому `fixed` работает как задумано.
 *
 * Знак не перехватывает клики (`pointer-events-none`) и скрыт от скринридера.
 */

export function PrintWatermark({ label = "ДЕМО" }: { label?: string }) {
  return (
    <div
      aria-hidden
      className="hidden print:flex fixed inset-0 z-10 pointer-events-none select-none items-center justify-center overflow-hidden"
    >
      <div className="flex flex-col items-center gap-[16vh] -rotate-[18deg]">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="text-[12vw] font-black uppercase leading-none tracking-[0.18em] text-warm-300"
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
