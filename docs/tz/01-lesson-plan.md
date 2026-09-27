# TZ-01: План урока (Q1-2027, Worker A)

**Что.** Генерируем план урока по ФГОС-конспекту на 45 мин: цели (обуч/разв/восп), оборудование, шаги (орг. момент → мотивация → новая тема → отработка → рефлексия → домашка), текст ДЗ.

## Файлы — строго свои

- `src/lib/mock/lesson-plan.ts` — **заменить заглушку** на полноценную генерацию.
- `src/components/constructor/LessonPlanPreview.tsx` — new, A4-превью в стиле `WorksheetPreview.tsx`.
- `src/lib/utils/lesson-plan-docx.ts` — new, экспорт DOCX через `docx` пакет (уже в `package.json:18`).
- `tests/lesson-plan.test.ts` — new, vitest.

## Что в моке

1. Из `req: { subject, grade, topic }` достать `Subject` + `Topic` через `getSubject`/`getTopic` (есть в `src/lib/content/subjects.ts`).
2. Сгенерировать **5–6 шагов урока** в порядке: `org-moment` (3 мин) → `motivation` (5 мин) → `new-topic` (15 мин) → `practice` (15 мин) → `reflex` (5 мин) → `homework` (2 мин). Сумма ≈ 45 ± 2.
3. `goals`: 2–3 educational / 1–2 developmental / 1 nurturing (по типу темы).
4. `equipment`: 1–3 строки (учебник, доска, ПК, раздатка — по subject).
5. `homework`: text + 1–2 alternatives.

Опора на шаблоны `src/lib/mock/generator.ts:12-93` (TASK_TEMPLATES) — НЕ копипастить, а сделать свои шаблоны под урок.

## Контракт UI превью

- `LessonPlanPreview({ plan: LessonPlan })` — рендер A4-страницы с заголовком «План урока», блоком целей, списком шагов (таблица: этап | время | действия учителя | действия учеников), блоком ДЗ.
- Стиль — как у `WorksheetPreview.tsx:24-165`: `<article className="worksheet-page">`, header с шифром и т.д.
- Если `plan.stages.length === 0` (заглушка ещё не заменена) — показывать пустое состояние «Скоро будет».

## Экспорт DOCX

- `lesson-plan-docx.ts`: функция `generateLessonPlanDocx(plan): Promise<Blob>`.
- Использовать `Document`, `Paragraph`, `TextRun`, `HeadingLevel` из пакета `docx` (пример: `src/lib/utils/docx.ts:1-30`).
- Включать заголовок, цели, шаги (таблица `Table` с 4 колонками), ДЗ.

## Acceptance

1. `npx tsc --noEmit` ✅
2. `npx vitest run tests/lesson-plan.test.ts` — минимум 2 теста (happy + topic-not-found).
3. `npm run build` ✅
4. Ручная проверка: `cd out && python3 -m http.server 8080` → открыть `/constructor?subject=math&grade=5&topic=drobi-obyknovennye`, выбрать тип «План урока», сгенерировать, увидеть A4-превью с 5–6 шагами.
5. Скачать DOCX, открыть в LibreOffice — таблица шагов и ДЗ на месте.

## Out-of-scope

- Лендинг, pricing, dashboard, SEO — родитель.
- Реальный LLM-вызов — фасад готов, fallback на mock.
- Self-verification (проверка качества плана) — отдельная TZ.
- Анимация/интерактив в превью — статичная A4.
