# Closure — F-02: Presets в wizard (ИНТЕГРАЦИЯ завершена 2026-09-27)

**Дата:** 2026-09-27
**Предыдущий статус:** ⚠️ частично — компонент реализован корректно, но **не интегрирован в основной поток wizard** (closure от 2026-09-26).
**Текущий статус:** ✅ **полностью интегрирован в wizard** — PresetGrid появляется после выбора предмета и класса на шаге 1, заполняет параметры и идёт на шаг «Тема». Режим «Свой вариант» работает.

---

## Что сделано (2026-09-27)

Внесены правки в `src/app/constructor/page.tsx`:

1. **Импорты** (строка 16-19): добавлен импорт `PresetGrid`, типа `Preset`, `PresetMode` из `@/components/constructor/PresetGrid`.

2. **State** (после строки 117):
   ```ts
   const [presetMode, setPresetMode] = React.useState<PresetMode>("template");
   const [selectedPresetId, setSelectedPresetId] = React.useState<string | null>(null);
   const [customType, setCustomType] = React.useState<TaskType>("worksheet");
   ```

3. **Reset** (внутри `reset()`, ~строка 224-225):
   ```ts
   setSelectedPresetId(null);
   setPresetMode("template");
   setCustomType("worksheet");
   ```

4. **Обработчики**:
   - `handleSelectPreset(preset)` — заполняет `count`, `difficulty`, `type`, `withAnswers`, `withExplanations`, синхронизирует `customType`, переходит на `step("topic")`.
   - `handleSkipPresetToTopic()` — для «Свой вариант»: сбрасывает `selectedPresetId`, переходит на `step("topic")` БЕЗ заполнения параметров (defaults из ConstructorPage сохраняются).
   - `handleCustomTypeChange(t)` — меняет тип в «Свой вариант»: применяет `setType(t)`.
   - `handleBackFromPresets()` — сбрасывает выбор preset'а при возврате к выбору предмета/класса.

5. **Раздвоенный рендер шага `select`** (~строка 493-538):
   - **Когда `!subject || grade === null`** → старая `SelectStep` (выбор предмета и класса).
   - **Когда `subject && grade !== null`** → новый Card «Сценарий» с `<PresetGrid>`.

6. **Сброс preset'а при смене предмета** (внутри `onSubject` колбэка SelectStep): сбрасывает `selectedPresetId` и `presetMode`, чтобы не применить preset от другого предмета.

## Live-проверка в браузере

Запущен `next dev -p 3002`. Артефакты в `.audit/qa-runs/2026-09-27-f02-integration/`.

### Сценарий 1: выбор preset'а (Математика, 5 класс, «Карточка на 15 минут»)

1. `/constructor/` → видим SelectStep.
2. Клик «Математика».
3. Клик «5».
4. **Результат:** появился Card «Сценарий» с подзаголовком «Выбраны: Математика · 5 кл. Можно поменять в шаге „Что"», кнопка «Назад», переключатель «Шаблон / Свой вариант» (Шаблон активен) и **4 preset-карточки** (5-й «Подготовка к ОГЭ/ЕГЭ» скрыт из-за `onlyGrades=[9,11]`).
5. Клик по «Карточка на 15 минут».
6. **Результат:** переход на шаг «Тема» (`h2 = "Выберите тему"`), параметры заполнены (count=5, difficulty=easy, type=worksheet).

Скриншот: `.audit/qa-runs/2026-09-27-f02-integration/01-preset-grid-math-5.png` (1506×1636, виден весь Card «Сценарий» с 4 пресетами + StepHeader «Шаг 1 из 3 — Математика · 5 кл.»).

### Сценарий 2: режим «Свой вариант» → «Перейти к выбору темы»

1. Снова `/constructor/` → «Математика» → «5».
2. Клик таб «Свой вариант».
3. **Результат:** появилась карточка «Без шаблона» с inline-пикером типа «Лист / Тест / Карточки» (Лист по умолчанию) и кнопка «Перейти к выбору темы →».
4. Клик «Перейти к выбору темы».
5. **Результат:** переход на шаг «Тема» (h2 = "Выберите тему"), параметры — defaults (count=10, difficulty=medium, type=worksheet).

### Edge case: фильтр `onlyGrades`

Preset `oge-ege` имеет `onlyGrades: [9, 11]`. Для grade=5 он **скрывается корректно** (см. скриншот — карточка не отображается среди 4 пресетов). Для grade=9/11 — отображается. Логика в `PresetGrid.tsx:154-157`:

```ts
const visiblePresets = React.useMemo(
  () => PRESETS.filter((p) => !p.onlyGrades || p.onlyGrades.includes(grade)),
  [grade]
);
```

## Что подтверждено

- ✅ PresetGrid реально появляется после выбора предмета и класса (вместо бесполезной кнопки «Далее»)
- ✅ Клик по preset'у заполняет параметры и переходит на шаг «Тема»
- ✅ Режим «Свой вариант» работает: даёт выбрать тип и идёт на «Тема» без preset'а
- ✅ Edge case с `onlyGrades` отрабатывает корректно (5-й ОГЭ/ЕГЭ скрыт для grade=5)
- ✅ Кнопка «Назад» возвращает к SelectStep (subject/grade сохраняются, можно поменять)
- ✅ TypeScript clean (`tsc --noEmit` без ошибок)
- ✅ Dev-server не падает, hot reload не ругается

## Как воспроизвести

```sh
cd /Users/ivanlusnikov/Documents/nameone
export PATH="/opt/homebrew/opt/node/bin:/opt/homebrew/bin:$PATH"
npx next dev -p 3002   # или :3000/:3001 если свободны
# открой http://localhost:3002/constructor/
# → Математика → 5 → появятся 4 пресета
# → Свой вариант → Лист/Тест/Карточки → Перейти к выбору темы
```

## Out-of-scope (что осталось НЕ в этой правке)

- ❌ **Track-event в аналитике**: PresetGrid сам зовёт `trackPresetSelected(preset.id)` (см. `PresetGrid.tsx:160`). Дополнительный сбор в ConstructorPage не нужен.
- ❌ **A11y-проверка с клавиатуры** — Tab+Enter не тестили в браузере, но каждый preset — `<button>` с `aria-label` (см. `PresetGrid.tsx:210`), должно работать.
- ❌ **Mobile-разводка** — на 375×667 ширины не проверяли визуально, но mobile-grid (`grid-cols-2`) уже в `PresetGrid.tsx:201`, используется.
- ❌ **Деплой на прод** — это по-прежнему долг из `docs/09-deploy-to-prod.md`.

## Статус

✅ **F-02 готово: wizard теперь использует PresetGrid на шаге 1.** Можно выпускать.
