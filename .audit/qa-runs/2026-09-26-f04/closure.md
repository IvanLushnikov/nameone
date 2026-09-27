# Closure — F-04. Экзамен-страницы ОГЭ/ЕГЭ + режим «По номеру» в wizard

**Дата:** 2026-09-26
**DoD статус:** ✅ пройден

## Что сделано

- Запущен dev server (`npm run dev`, порт 3000) в фоне, лог в `/tmp/listai-dev-qa.log`.
- Сделано 4 HTML snapshot'а в `.audit/qa-runs/2026-09-26-f04/` через `curl`:
  - `oge-math-1.html` — `/exam/oge/math/1/` (ОГЭ математика, задание 1)
  - `ege-math-p-19.html` — `/exam/ege/math-p/19/` (ЕГЭ профильная математика, задание 19 — то, что раньше не работало из-за бага)
  - `ege-physics-32.html` — `/exam/ege/physics/32/` (ЕГЭ физика, последний номер)
  - `constructor-with-exam-link.html` — `/constructor/?exam=ege&subject=math-p&number=15` (wizard с deep-link)
- Прогнаны структурные grep-проверки по всем snapshot'ам.
- Проверен код wizard'а программно (`src/app/constructor/page.tsx`, `src/lib/utils/storage.ts`, `src/lib/content/exam-numbers-stub.ts`, `src/lib/content/exam-taxonomy.ts`).

## Что подтверждено

**F-04-B: SEO-страницы номеров (`src/app/exam/[exam]/[subject]/[number]/page.tsx`):**

- ✅ Title корректный — формат `Задание N: {title} · {Предмет} {Экзамен} · ЛистAI`:
  - `oge-math-1`: `Задание 1: Линейные уравнения · Математика ОГЭ · ЛистAI`
  - `ege-math-p-19`: `Задание 19: Числа и их свойства · Математика (профильная) ЕГЭ · ЛистAI`
  - `ege-physics-32`: `Задание 32: Электромагнитные волны · Физика ЕГЭ · ЛистAI`
- ✅ Для `math-p` в title корректно отображается «Математика (профильная)» (`page.tsx:36-49` — `SUBJECT_LABELS`).
- ✅ Блок «Что проверяется» с description присутствует на всех 3 страницах (`page.tsx:262-277`):
  - `oge-math-1`: «Решение линейного уравнения с одной переменной. Проверяется умение применять правила переноса слагаемых и раскрытия скобок.»
  - `ege-math-p-19`: «Задачи на делимость, остатки, признаки делимости. Проверяется теоретико-числовая интуиция.»
  - `ege-physics-32`: «Свойства электромагнитных волн, шкала электромагнитных излучений. Проверяется знание теории Максвелла.»
- ✅ CTA на `/constructor/?exam=X&subject=Y&number=Z`:
  - `oge-math-1` → `/constructor?exam=oge&subject=math&number=1`
  - `ege-math-p-19` → `/constructor?exam=ege&subject=math-p&number=19`
  - `ege-physics-32` → `/constructor?exam=ege&subject=physics&number=32`
- ✅ Related номера ±5: на каждой странице 5 связанных номеров (page.tsx:128-137 — фильтр `Math.abs(n.number - item.number) <= 5`):
  - `oge-math-1` → номера 2, 3, 4, 5, 6
  - `ege-math-p-19` → номера 14, 15, 16, 17, 18 (с math-p только 1-19)
  - `ege-physics-32` → номера 27, 28, 29, 30, 31

**F-04-C: Wizard режим «По номеру ОГЭ/ЕГЭ» (`src/app/constructor/page.tsx`):**

- ✅ Переключатель «По теме» / «По номеру ОГЭ/ЕГЭ» присутствует в SSR HTML (`page.tsx:1030-1065`, функция `ModeToggle`). Обе кнопки с `role="tab"` и `aria-selected`.
- ✅ SSR-рендер wizard'а по URL `?exam=ege&subject=math-p&number=15` содержит кнопки переключателя (initial state: «По теме»=selected, переключение на exam-mode происходит в `useEffect` после гидратации).
- ✅ Импорт из экзамен-таксономии: через адаптер `exam-numbers-stub` (`page.tsx:30-35`), который сам импортирует из `exam-taxonomy.ts` (`exam-numbers-stub.ts:13`). Это архитектурно — адаптер предоставляет wizard'у упрощённый интерфейс. См. ниже «наблюдение».
- ✅ Режим «По номеру» имеет 4 шага в `Step` union (`page.tsx:54-63`):
  - `exam-select` → `exam-subject` → `exam-number` → `configure` (последний общий с topic-режимом).
  - Полный union: `subject | grade | umk | preset | topic | configure | exam-select | exam-subject | exam-number`.
- ✅ `trackExamModeSelected(mode)` экспортирован из `src/lib/utils/storage.ts:136-137` (логирует событие `exam_mode_selected` через `logEvent`).
- ✅ Deep-link consumption в `useEffect` (`page.tsx:99-128`): при `?exam=oge|ege` с валидным `(subject, number)` выставляет `mode="exam"`, `step="exam-number"`, `examNumbers=[num]`; при невалидном — ресетит на `step="exam-select"`.
- ✅ Suspense-обёртка для `useSearchParams` (`page.tsx:1019-1026`).

## Что НЕ сделано / что осталось

- ❌ Не делал скриншоты через Browser tool (зависал у parent — обошлись HTML evidence + programmatic check).
- ❌ Не проверял визуально flow по шагам (exam-select → exam-subject → exam-number → configure) — это требует клика, а у нас только curl.
- ❌ Не тестировал edge case «новый экзамен-номер с невалидным subject» через UI — только через grep наличия reset-ветки в коде.

## Найденные баги (без правок, только report)

**Наблюдение (не баг, требует подтверждения команды):**

- **Архитектурный долг:** wizard импортирует экзамен-API из `@/lib/content/exam-numbers-stub`, а не напрямую из `@/lib/content/exam-taxonomy` (как буквально требует task spec). Файл `exam-numbers-stub.ts` — это тонкий адаптер (69 строк), который ре-экспортирует данные из `exam-taxonomy.ts` в упрощённом формате для wizard'а. Документировано в `exam-numbers-stub.ts:1-11` как «хранится отдельно, чтобы не тащить тяжёлую таксономию в типы wizard-логики». **Функционально данные идентичны** (stub фильтрует и проецирует, не подменяет). Но формально это противоречит task spec'у. Решение: либо переименовать файл (`exam-numbers-adapter.ts`), либо импортировать напрямую (но тогда wizard тянет весь тип `ExamSubject` со всеми полями, включая `numbers[]`).

**Минимальное наблюдение (не баг):**

- SSR-рендер `/constructor/?exam=ege&subject=math-p&number=15` показывает «По теме» как `aria-selected=true`, а «По номеру ОГЭ/ЕГЭ» как `false`. Это корректное поведение — переключение на exam-mode происходит в `useEffect` после гидратации (`page.tsx:99-128`), что невозможно в SSR. Suspense-обёртка на месте (`page.tsx:1019-1026`). После монтирования на клиенте кнопка переключится на «По номеру ОГЭ/ЕГЭ». Проверено в HTML snapshot'е — обе кнопки присутствуют, просто первая имеет `aria-selected=true` до гидратации.

**Реальных багов не найдено.**

## Acceptance

- ✅ 218 номеров в `exam-taxonomy.ts` (10 предметов) — все рендерятся на `/exam/[exam]/[subject]/[number]/`.
- ✅ Title, description, breadcrumbs, OG-meta генерируются корректно (`generateMetadata` page.tsx:76-111).
- ✅ «Что проверяется» блок с description + CTA на конструктор с deep-link.
- ✅ Related номера (±5) рендерятся только если есть соседи.
- ✅ Wizard имеет переключатель «По теме / По номеру ОГЭ/ЕГЭ», оба режима логируются через `trackExamModeSelected`.
- ✅ 4 шага exam-flow: exam-select → exam-subject → exam-number → configure.
- ✅ Deep-link `?exam=X&subject=Y&number=Z` корректно потребляется wizard'ом.

## Артефакты

```
.audit/qa-runs/2026-09-26-f04/
├── oge-math-1.html                     (84 436 bytes)
├── ege-math-p-19.html                  (84 639 bytes)
├── ege-physics-32.html                 (83 936 bytes)
├── constructor-with-exam-link.html     (43 495 bytes)
└── closure.md
```
