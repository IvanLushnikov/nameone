# TZ-03: КТП (Q1-2027, Worker C)

**Что.** Генерируем календарно-тематическое планирование (КТП) на год: ~34 недели (для 68 ч/год) или ~17 недель (для 34 ч/год), в каждой неделе 1-2 урока с темой, типом, часами, привязкой к ФГОС.

## Файлы — строго свои

- `src/lib/mock/ktp.ts` — **заменить заглушку** на полноценную генерацию.
- `src/components/constructor/KtpPreview.tsx` — new, A4-превью с таблицей по неделям.
- `src/lib/utils/ktp-docx.ts` — new, экспорт DOCX через `docx` пакет с таблицей + merged cells.
- `tests/ktp.test.ts` — new, vitest.

## Что в моке

1. Из `req: { subject, grade, topic, schoolYear }` (default `schoolYear = "2026/2027"`) собрать `Ktp`.
2. `totalHours` — для русского/математики 5–9 кл = **68 ч/год** (2 ч/нед), для 10–11 = **102 ч/год** (3 ч/нед), для иностранных 2–11 = **102 ч/год**. Простая матрица по subject+grade в хардкоде.
3. Покрытие недель: 34 недели (по 2 ч) или 17 недель (по 3 ч) — в зависимости от `totalHours`.
4. Каждая запись `KtpEntry`: `num`, `dates` («08.09–13.09» — вычислить от 1 сентября), `topic` (взять из `src/lib/content/subjects.ts` — `Subject[grade].topics`), `kind` (80% `lesson`, 10% `control`, 5% `test`, 5% `review`/`reserve`/`project`), `hours` (1 или 2), `fgosRef`.
5. На `num = 1` — тема из `topics[0]`, дальше идём по массиву `topics` циклически, пропуская уже использованные.

## Контракт UI превью

- `KtpPreview({ ktp: Ktp })` — A4-страница с заголовком «КТП · <subject> · <grade> кл · <schoolYear>», большой таблицей `<table>` (НЕ через `docx`-API — нативная HTML-таблица).
- Колонки: № | Неделя | Даты | Тема | Тип | Часы | ФГОС.
- Каждая неделя — `<thead>` с номером недели, под ним 1-2 строки уроков.
- `kind === "control"` или `"test"` — выделить фоном (`bg-warm-100`) + emoji.
- Footer: «Всего: <totalHours> ч · <weeks.length> недель».

## Экспорт DOCX

- `ktp-docx.ts`: `generateKtpDocx(ktp): Promise<Blob>`.
- Использовать `Table`, `TableRow`, `TableCell` из пакета `docx` (см. пример: https://docx.js.org/#/usage/tables).
- Merged cells: первая ячейка каждой недели (col «№») объединена на все уроки недели (`rowSpan`).
- Стили: header-row — bold + серый фон, control-row — peach фон.

## Acceptance

1. `npx tsc --noEmit` ✅
2. `npx vitest run tests/ktp.test.ts` — минимум 2 теста (happy-path для 5 кл русский = 68 ч + edge-case когда topics меньше чем нужно — циклический обход).
3. `npm run build` ✅
4. Ручная проверка: `/constructor?subject=math&grade=5&topic=...&type=ktp`, сгенерировать, увидеть таблицу на ~34 строки с merged cells.
5. Скачать DOCX, открыть в LibreOffice — таблица с merged cells корректно отображается.

## Out-of-scope

- Реальный производственный календарь РФ (праздники, каникулы) — захардкоженное «34 недели с 1 сентября», сдвиги дат позже.
- Интеграция со Сферум / Moodle — отдельная TZ.
- Лендинг, pricing, dashboard, SEO — родитель.
- Возможность править КТП вручную в продукте — отложена (сейчас только generate + скачать).
