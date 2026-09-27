# TZ-02: Презентация (Q1-2027, Worker B)

**Что.** Генерируем презентацию (5/10/15/20 слайдов) по теме: титульный → определение → буллеты-объяснение → примеры → итог. Экспорт PPTX через `pptxgenjs`.

## Файлы — строго свои

- `src/lib/mock/presentation.ts` — **заменить заглушку** на полноценную генерацию.
- `src/components/constructor/PresentationPreview.tsx` — new, компонент-превью (НЕ полноценный viewer, а эскизы слайдов списком).
- `src/lib/utils/pptx.ts` — new, экспорт через `pptxgenjs`.
- `tests/presentation.test.ts` — new, vitest.

## Что в моке

1. Из `req: { subject, grade, topic, slideCount }` (default `slideCount = 10`) сгенерировать массив `slides` длиной `slideCount`.
2. Первый слайд — `kind: "title"`, `title: <topic.title>`, `bullets: [<subject> · <grade> класс]`.
3. Слайды 2..N-1 — `kind: "bullets"`, чередуем `definition` / `example` / `bullets` (простой шаблон по позиции).
4. Последний слайд — `kind: "summary"`, `bullets: 3-5 пунктов-выводов`.
5. Каждый слайд имеет `notes` (1-2 строки для режима докладчика).

## Контракт UI превью

- `PresentationPreview({ presentation: Presentation })` — список миниатюр слайдов (CSS grid, 2-3 колонки на десктопе, 1 на мобиле).
- Каждая миниатюра — `<article className="aspect-video bg-white border rounded">` с уменьшенным рендером title + bullets (text-ellipsis на 3-4 строки).
- Первый слайд — с плашкой «Титульный».
- Кнопка «Скачать PPTX» сверху справа.
- Стиль — нейтральный, не вырвиглазный, шрифт без serif.

## Экспорт PPTX

- `pptx.ts`: `generatePptx(presentation): Promise<Blob>` через `pptxgenjs`.
- Тема: один из `presentation.theme` (default/modern/school/minimal) — `pres.layout` или `pres.theme` (см. доки pptxgenjs).
- На каждый слайд: `pres.addSlide()` → `slide.addText(title, { x, y, fontSize, bold })` → `slide.addNotes(notes)`.
- Title слайд — крупный шрифт, центрирование.
- Summary — нумерованный список.

## Acceptance

1. `npx tsc --noEmit` ✅
2. `npx vitest run tests/presentation.test.ts` — минимум 2 теста (happy + slideCount validation).
3. `npm run build` ✅
4. Ручная проверка: открыть `/constructor?...&type=presentation`, выбрать 10 слайдов, сгенерировать, увидеть 10 миниатюр.
5. Скачать PPTX, открыть в LibreOffice Impress / Google Slides — все 10 слайдов отображаются с текстом.

## Out-of-scope

- Лендинг, pricing, dashboard, SEO — родитель.
- Онлайн-редактор слайдов (типа Canva) — отложен.
- Темы оформления (тема как актив) — пока только выбор из 4 фиксированных.
- Картинки к слайдам (AI image gen) — отложено, требует vision-тарифа.
