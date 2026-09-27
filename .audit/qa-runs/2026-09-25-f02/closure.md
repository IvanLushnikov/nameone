# Closure — F-02: Presets в wizard

**Дата:** 2026-09-26
**DoD статус:** ⚠️ частично — компонент реализован корректно, но **не интегрирован в основной поток wizard**

---

## Что сделано

- Запущен dev server (Next.js 14.2.35 на порту 3000 — 3000/3001 были заняты другими процессами)
- Сняты 3 HTML-снапшота wizard в `.audit/qa-runs/2026-09-25-f02/`:
  - `constructor-base.html` (43 310 bytes) — `/constructor/` (стартовая)
  - `constructor-with-deep-link.html` (43 495 bytes) — `?exam=ege&subject=math-p&number=15` (режим «По номеру»)
  - `constructor-with-topic-link.html` (43 528 bytes) — `?subject=math&grade=5&topic=smeshannye-chisla` (deep-link в «По теме»)
- Структурная проверка HTML (grep) — title содержит «ЛистAI», H2 «Выберите предмет», `Конструктор` упоминается ≥3 раз
- Программная проверка PresetGrid через исходник — 5 пресетов, тип `Preset` экспортирован, `PRESETS` экспортирован, `PresetMode` экспортирован
- Подтверждено: `trackPresetSelected(presetId)` существует в `src/lib/utils/storage.ts:131-133` и вызывается в `PresetGrid.tsx:122`
- Подтверждено: bundle `/constructor/page.js` содержит все 5 заголовков пресетов (dev-чанк, 5.3 MB unminified)

---

## Что подтверждено

### 5 пресетов с правильными полями

| # | ID | Title | Icon | Count | Difficulty | Type | onlyGrades |
|---|---|---|---|---|---|---|---|
| 1 | `card-15min` | «Карточка на 15 минут» | `Timer` | 5 | easy | worksheet | — |
| 2 | `homework` | «Домашняя работа» | `BookOpen` | 10 | medium | worksheet | — |
| 3 | `test-new-topic` | «Проверочная по новой теме» | `ClipboardCheck` | 8 | medium | test | — |
| 4 | `handout` | «Раздаточный материал к уроку» | `Printer` | 12 | easy | worksheet | — |
| 5 | `oge-ege` | «Подготовка к ОГЭ/ЕГЭ» | `Trophy` | 6 | hard | test | [9, 11] |

Все 5 совпадают со спекой из `docs/04-product-features-q4-2026.md` §F-02 и `docs/05-tasks.md` Task #2.

### Экспорты

- `export type PresetMode = "template" | "custom"` — `PresetGrid.tsx:16`
- `export interface Preset { ... }` — `PresetGrid.tsx:18-30`
- `export const PRESETS: Preset[]` — `PresetGrid.tsx:33`
- `export function PresetGrid({ ... })` — `PresetGrid.tsx:108`

### Аналитика

- `trackPresetSelected(presetId: string)` — `src/lib/utils/storage.ts:131-133` — пишет событие `preset_selected` с `preset_id` в localStorage-историю через `logEvent()`
- Вызывается в `PresetGrid.tsx:122` при клике на карточку

### Интеграция в wizard

- `PresetGrid` импортируется в `src/app/constructor/page.tsx:13`
- Используется на шаге `step === "preset"` в `src/app/constructor/page.tsx:354-378`
- `handleSelectPreset` (line 200-208) корректно заполняет `count`, `difficulty`, `type`, `withAnswers`, `withExplanations` из preset'а и переходит на шаг «Тема»
- `handleSkipPreset` (line 211-214) — для режима «Свой вариант»
- `handleGradeChange` (line 218-228) — сбрасывает `selectedPresetId` при смене класса
- StepHeader включает «Шаблон» в breadcrumb (`page.tsx:578`) — UI-навигация для возврата к preset-grid

### Bundle wizard

- Dev-чанк `/constructor/page.js`: **5 329 163 bytes (≈5.3 MB)** — unminified, dev-режим
- В чанке найдены все 5 заголовков пресетов (текст «Домашняя работа», «Карточка на 15 минут», «Подготовка к ОГЭ/ЕГЭ» (×2 — текст + aria-label), «Проверочная по новой теме», «Раздаточный материал к уроку»)
- README (`/Users/ivanlusnikov/Documents/nameone/README.md`) указывает prod bundle `/constructor` = **11 kB** (последний раз обновлён 2026-09-25 19:16, до того как F-02 был полностью завершён)

---

## Что НЕ сделано / что осталось

1. **Production bundle size не зафиксирован точно** — `npm run build` не запускался (запрещено трогать `.next/`). Текущая цифра в README (11 kB) — pre-F-02 baseline. Фактический размер после F-02 в production-build не известен без отдельного билда.
2. **Визуальные скриншоты через browser** не делались — parent упоминал, что in-app browser зависает. HTML-снапшоты показывают только SSR-статус (шаг «Выберите предмет»), preset-grid рендерится только после client-side выбора класса.
3. **Mobile-визуальная проверка (375×667)** не проводилась — только проверка CSS-классов через grep по исходнику (`grid grid-cols-2 gap-2.5 sm:gap-3` в `PresetGrid.tsx:163` — корректно).
4. **Edge case «preset для неподходящего класса»** — в коде фильтрация работает: `PRESETS.filter((p) => !p.onlyGrades || p.onlyGrades.includes(grade))` (`PresetGrid.tsx:117`), но проверить динамически нельзя без browser.
5. **Реальная аналитика** — `trackPresetSelected` пишет в localStorage, но без browser нельзя подтвердить, что событие реально пишется.

---

## Найденные баги (без правок, только report)

### 🐛 BUG #1: Preset-шаг недостижим в нормальном flow

**Файл:** `src/app/constructor/page.tsx:218-228` (`handleGradeChange`)
**Файл:** `src/app/constructor/page.tsx:343` (`SubjectStep onSelect`)
**Severity:** P1 (фича F-02 не доходит до пользователя)

**Описание:** Нормальный поток wizard'а:
1. Шаг «Предмет» → клик → `setStep("grade")`
2. Шаг «Класс» → клик → `handleGradeChange(g)` → **`setStep("umk")`** или **`setStep("topic")`** — **preset-grid НИКОГДА не показывается**

Единственный способ увидеть preset-grid:
- Сначала переключиться в режим «По номеру ОГЭ/ЕГЭ», затем вернуться обратно в «По теме» — тогда `handleModeChange` (line 195) делает `setStep(subject ? (grade ? "preset" : "grade") : "subject")`

То есть StepHeader показывает «Шаблон» в breadcrumb (line 578), и компонент `PresetGrid` корректно отрисовывается на `step === "preset"` (line 354-378), но пользователь в этот шаг не попадает.

**Доказательство:** все `setStep` вызовы в `page.tsx` — preset как целевой шаг присутствует только в `handleModeChange` (line 195).

**Ожидаемый фикс (НЕ внесён, только рекомендация):** в `handleGradeChange` (line 218-228) добавить шаг `preset` между grade и umk/topic:
```
if (umkList.length > 0) {
  setStep("preset");
} else {
  setStep("preset");
}
```
Либо вынести UMK после preset:
```
setStep("preset"); // всегда после grade
```

**Это блокирует выполнение Acceptance-критерия F-02:** «От выбора preset до PDF — ≤ 5 кликов и ≤ 30 секунд» — пользователь физически не может выбрать preset.

---

## Acceptance

| Критерий | Статус |
|---|---|
| ≥ 3 HTML файлов в `.audit/qa-runs/2026-09-25-f02/` | ✅ 3 файла (43 310 / 43 495 / 43 528 bytes) |
| `closure.md` заполнен | ✅ этот файл |
| Все 5 пресетов найдены в коде с правильными полями | ✅ все совпадают |
| Bundle size wizard зафиксирован | ⚠️ dev-чанк (5.3 MB unminified) + README (11 kB pre-F-02), prod-build после F-02 не зафиксирован |
| Preset-компонент интегрирован в wizard | ⚠️ компонент корректен, но **не достижим из нормального flow** (BUG #1) |
| `trackPresetSelected` в storage.ts | ✅ присутствует и вызывается |
| `Preset` тип + `PRESETS` экспортируются | ✅ |
| Mobile (375px) presets в 2 колонки | ✅ по CSS (`grid grid-cols-2 gap-2.5`), но без browser не подтверждено визуально |
| a11y (`<button>` + `aria-label`) | ✅ (`PresetGrid.tsx:168-178`) |

---

## Артефакты

```
.audit/qa-runs/2026-09-25-f02/
├── closure.md                              (этот файл)
├── constructor-base.html                   43 310 bytes
├── constructor-with-deep-link.html         43 495 bytes
└── constructor-with-topic-link.html        43 528 bytes
```