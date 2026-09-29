# TZ-07: ФГОС-плашка на каждой теме + JSON-LD `educationalAlignment`

> **Статус:** ✅ реализовано, проходит typecheck + build
> **Дата:** 2026-09-27 (ревизия после реализации)
> **Приоритет:** P0 (запуск Q4 2026)
> **Связано:** `docs/05-fgos-and-taxonomy-research.md` §A, `docs/POSITIONING.md` §3 (столбик d), `docs/BRAND.md`

## Контекст

Из конкурентного анализа (`05-fgos-and-taxonomy-research.md`):
- **Videouroki.net** — единственный с похожим фильтром ФГОС в каталоге, но не на карточке материала.
- **Yaklass**, **Uchi.ru** — упоминают ФГОС в hero / тексте, но без визуальной плашки на каждой теме.
- **Обучай, ПервоКласс, ZAOCHNIK** — нет визуальной маркировки ФГОС на карточках.

**Гипотеза:** зелёный чип «По ФГОС 2021» с tooltip = конкретный раздел ФГОС на каждой карточке темы:
1. Увеличит CTR в конструктор (доверие через явное соответствие стандарту).
2. Даст SEO-сигнал через JSON-LD `educationalAlignment.targetName` (Яндекс учитывает Schema.org).
3. Отстроит от 5 из 6 конкурентов в ТОП-25 vc.ru.

**Решение о разработке:** принято в чате Mavis ↔ Ivan 2026-09-25. Документ описывает **уже реализованное** состояние, чтобы новые разработчики не изобретали велосипед.

---

## Что есть (уже реализовано)

### Файл `src/components/ui/FgosBadge.tsx`

```tsx
"use client";

import clsx from "clsx";

interface Props {
  fgosRef?: string;
  size?: "sm" | "md";
  className?: string;
}

/**
 * Зелёный чип «По ФГОС 2021» с tooltip `Раздел ФГОС: {fgosRef}`.
 * Если fgosRef не задан — рендерит null.
 *
 * Цвета — Tailwind green-100 / green-800, контраст ≥ 4.5:1.
 */
export function FgosBadge({ fgosRef, size = "md", className }: Props) { /* … */ }
```

**Ключевые свойства:**
- `data-fgos-badge="true"` — для Playwright / e2e-тестов.
- `title` + `aria-label` дублируют tooltip (для скрин-ридеров).
- `null`-рендер при отсутствии `fgosRef` (не мусор в DOM).
- `size="sm"` — компактная версия для листинга (GradeHubPage).
- `size="md"` — для TopicPage.

### Интеграция в `src/app/subject/[subject]/[grade]/[topic]/page.tsx:134`

```tsx
<FgosBadge fgosRef={topic.fgosRef} />
```

В hero-блоке рядом с `Badge` (subject emoji) и `Badge` (grade num). Импорт — `src/app/subject/[subject]/[grade]/[topic]/page.tsx:7`.

### Интеграция в `src/app/subject/[subject]/[grade]/page.tsx` (GradeHubPage)

На каждой карточке темы в листинге:
```tsx
<FgosBadge fgosRef={t.fgosRef} size="sm" className="mb-2" />
```

### JSON-LD в TopicPage (`src/app/subject/[subject]/[grade]/[topic]/page.tsx:73-92`)

```ts
if (topic.fgosRef) {
  jsonLd.educationalAlignment = {
    "@type": "AlignmentObject",
    alignmentType: "educationalFramework",
    targetName: topic.fgosRef,
    educationalFramework: "ФГОС 2021",
  };
}
```

Передаётся в `<script type="application/ld+json">` только при `topic.fgosRef` (см. `src/app/subject/[subject]/[grade]/[topic]/page.tsx:94-99`).

### FAQ-блок (`src/components/landing/FAQ.tsx:9-11`)

> «Листы соответствуют ФГОС 2021?»
> «Да. Листы генерируются на основе федеральных рабочих программ (ФРП) и привязаны к конкретным разделам ФГОС. Для 9 и 11 классов — по спецификациям ФИПИ 2026. Зелёный значок рядом с темой показывает раздел ФГОС, к которому она относится.»

---

## Что НЕ трогать (out of scope)

- ❌ Цвета плашки (зелёный — намеренный сигнал «соответствие», не менять).
- ❌ Размеры `size="sm" | "md"` — покрывают 100% кейсов.
- ❌ Текст «По ФГОС 2021» — это коммерческий ярлык, не редактировать.
- ❌ `data-fgos-badge="true"` — нужен для live-verify.
- ❌ Логика `null`-рендера без `fgosRef` — убрать нельзя, иначе мусор в DOM.

---

## Скоуп (что входит в TZ-07)

| # | Что | Файл | Статус |
|---|---|---|---|
| **1** | Сам компонент `FgosBadge` | `src/components/ui/FgosBadge.tsx` | ✅ |
| **2** | Интеграция на странице темы (`[grade][topic]/page.tsx`) + JSON-LD | `src/app/subject/[subject]/[grade]/[topic]/page.tsx:7,94,134` | ✅ |
| **3** | Интеграция на листинге тем (`[grade]/page.tsx`, sm-версия) | `src/app/subject/[subject]/[grade]/page.tsx` | ✅ |
| **4** | FAQ-ответ про ФГОС | `src/components/landing/FAQ.tsx:9-11` | ✅ |

---

## Live-проверка (как проверять вручную)

### TypeScript + Build

```bash
cd /Users/ivanlusnikov/Documents/nameone
export PATH="/opt/homebrew/opt/node/bin:$PATH"
npm run typecheck    # должно быть пусто
npm run build        # должен пройти без ошибок
```

### Live-проверка плашки в браузере

| URL | Что должно быть |
|---|---|
| `/subject/math/5/drobi-obyknovennye/` | Большая плашка «По ФГОС 2021» в hero + JSON-LD `educationalAlignment` в исходнике |
| `/subject/math/5/smeshannye-chisla/` | **Нет** плашки (нет `fgosRef`); **нет** `educationalAlignment` в JSON-LD |
| `/subject/math/5/` | На каждой карточке темы — компактная sm-плашка (если у темы есть `fgosRef`) |
| `/` | В FAQ первая строка: «Листы соответствуют ФГОС 2021?» |

### Playwright-селектор

```ts
await page.waitForSelector('[data-fgos-badge="true"]', { timeout: 5000 });
```

---

## DoD (Definition of Done)

- [x] Компонент `FgosBadge` создан.
- [x] `null`-рендер при отсутствии `fgosRef`.
- [x] Контраст ≥ 4.5:1 (green-100 / green-800, проверено через axe-core в `tests/`).
- [x] `data-fgos-badge="true"` для e2e-селекторов.
- [x] `title` + `aria-label` дублируют tooltip.
- [x] `sm` и `md` размеры.
- [x] Интегрирован в TopicPage hero (md).
- [x] Интегрирован в GradeHubPage listing (sm).
- [x] JSON-LD `educationalAlignment` при наличии `fgosRef`.
- [x] FAQ-блок упоминает плашку.
- [x] `npm run typecheck` ✅
- [x] `npm run build` ✅
- [x] `clsx` импортируется из `clsx` (не из `tailwind-merge`).

---

## Связанные документы

- `docs/05-fgos-and-taxonomy-research.md` §A — паттерны конкурентов
- `docs/POSITIONING.md` §3 (столбик d) — ФГОС как один из 5 столбиков отстройки
- `docs/BRAND.md` — палитра бренда (зелёный в палитре)
- `docs/01-research-naming.md` — exact-match SEO-стратегия