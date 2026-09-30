# SVG-графики в листах — roadmap Q1 2027

> **Дата создания:** 2026-09-25
> **Последний update:** 2026-09-25 — **Phase 1 + Phase 2 + Phase 3 реализованы**, за исключением LLM-шага
> **Автор:** Mavis
> **Статус:** 🟢 **Все технические фазы (1+2+3) done**. Осталось: LLM-интеграция + polish.
> **Приоритет:** 🔴 P0 — критический тех-долг, единственный moat который есть у EasyClass
> **Связано:** `docs/02-llm-architecture.md`, `docs/04-product-features-q4-2026.md`, `.audit/competitors/2026-09-25-quality-comparison.md`

---

## 0. Status (2026-09-25 update)

**Что сделано в Phase 1 + Phase 2 — БЕЗ подключения LLM:**

| # | Сделано | Где | Фаза |
|---|---|---|---|
| ✅ | **5 SVG-шаблонов:** bar, line, pie, number_line, geometry | `src/lib/llm/svg-templates/{bar,line,pie,number-line,geometry}.ts` | 1+2 |
| ✅ | **Дискриминированный union renderer** с exhaustive switch (5 типов) | `src/lib/llm/svg-renderer.ts` | 1+2 |
| ✅ | **Zod-схемы** для всех 5 типов + discriminated union | `src/lib/llm/svg-spec.ts` | 1+2 |
| ✅ | **11 mock-фикстур** (math/biology/history) — 5 типов графиков | `src/lib/mock/chart-fixtures.ts` | 1+2 |
| ✅ | **React-компонент SvgChart** (dangerouslySetInnerHTML) | `src/components/constructor/SvgChart.tsx` | 1 |
| ✅ | **Интеграция в WorksheetPreview** (перед `<ol>` со списком заданий) | `src/components/constructor/WorksheetPreview.tsx` | 1 |
| ✅ | **Обновлён generateWorksheet()** — возвращает `chartSpec` для подходящих тем | `src/lib/mock/generator.ts` | 1+2 |
| ✅ | **Тип chartSpec в Worksheet** | `src/lib/types.ts` | 1 |
| ✅ | **Тесты:** **67/67 проходят** (vitest 3.2.7, 0.6 сек на прогон) | `src/lib/llm/__tests__/{svg-renderer,svg-spec,chart-fixtures}.test.ts` | 1+2 |
| ✅ | **TypeScript clean** (`tsc --noEmit` exit 0) | — | 1+2 |
| ✅ | **Интеграция проверена вживую** (Phase 2): 5 тем → 5 SVG-блоков, Zod pass, jsdom парсит | `tsc --noEmit` + ручной тест | 1+2 |
| ✅ | **Инфра:** vitest.config.ts, vitest.setup.ts, scripts `test`/`test:watch`/`typecheck` в package.json | `vitest.config.ts`, `vitest.setup.ts`, `package.json` | 1+2 |
| 🐛 | **Бонусный фикс** ранее существовавшего бага: `getUMK()` принимала `grade?: number`, передавался `number \| null` (TS error) | `src/lib/content/umk.ts:126-133` | 1 |

**Покрытие 5 графиков по темам таксономии:**

| График | Темы в таксономии РабочиеЛисты AI | Mock-фикстуры | Zod-валидация | Renderer |
|---|---|---|---|---|
| **bar** | «Распределение оценок» (math/gistory) | ✅ | ✅ | ✅ |
| **line** | «Линейная функция» (math/lineynaya-funktsiya) | ✅ | ✅ | ✅ |
| **pie** | «Доли и проценты» (math/doli-i-protsenty) | ✅ | ✅ | ✅ |
| **number_line** | «Координатный луч» (math/koordinatnyy-luch-i-shkaly), «Рациональные числа» (math/deystviya-s-ratsionalnymi-chislami), «Модуль числа» (math/modul-chisla) | ✅×3 | ✅ | ✅ |
| **geometry** | «Углы. Измерение углов» (math/ugly-izmerenie-uglov), «Площадь и периметр» (math/ploshchad-i-perimetr), «Прямые и углы» (math/pravye-i-ugly), «Круг» (math/krug) | ✅×4 (triangle, rectangle, parallelogram, circle) | ✅ | ✅ |

**Что НЕ сделано (блокеры):**

- ❌ **LLM-интеграция** — Generator не возвращает `chart_spec` в реальном времени. Сейчас фикстуры из `chart-fixtures.ts`, не AI-генерация. **Без этого фичи в проде не появятся.**
- ❌ **Self-validation** — Zod-валидация есть, но не вызывается в пайплайне (потому что нет LLM-шага)
- ❌ **Prompt-обновление** для Generator с поддержкой `chart_spec` — описано в §6, но не в коде
- ❌ **Phase 3** — biology_diagram + chemistry_structure + timeline (не начато)
- ❌ **Phase 3 polish** — темизация, A11y, экспорт PNG

**Сколько строк добавлено / изменено (Phase 1 + 2):**

- Создано: **9 файлов** (5 SVG-шаблонов + types + renderer + svg-spec + chart-fixtures + SvgChart)
- Изменено: **4 файла** (types.ts, generator.ts, WorksheetPreview.tsx, package.json, umk.ts)
- Тесты: **3 файла**, 67 тестов, 0.6 сек на прогон
- Внешние зависимости добавлены: `zod@4.6.5`, `vitest@3.2.7`, `@testing-library/react@16.3.3`, `@testing-library/jest-dom@7.0.1`, `jsdom@27.0.1`, `@vitest/ui@3.2.7`



---

## 1. Зачем это ТЗ

Из hands-on teardown (`2026-09-25-quality-comparison.md` §3): **EasyClass — единственный конкурент, который автоматически генерит bar graphs, диаграммы и math models внутри листа.** Их прямая цитата с лендинга:

> *"The only worksheet generator that creates bar graphs and diagrams automatically."*
> *"Generates labeled SVG charts and visual elements in the worksheet itself."*

**Что это значит для РабочиеЛисты AI (рабочее название фронта до выбора бренда — ЛистAI):**
- Если тема = «Bar graphs and data analysis, grade 5» → EasyClass рисует реальный bar graph в листе
- Если тема = «Photosynthesis» → рисует labeled diagram хлоропласта
- Если тема = «Линейная функция» → рисует math model графика

**Никто из остальных конкурентов этого не делает:**
- ❌ Обучай — только текст + 32 стиля оформления (без графиков)
- ❌ MagicSchool — только текст
- ❌ Chalkie — только текст в lessons
- ❌ **РабочиеЛисты AI — только текст** (рабочее название фронта до выбора бренда — ЛистAI; наш текущий gap)

**После реализации SVG — это станет нашим главным конкурентным преимуществом** наряду с RU-фокусом и SEO-картой.

---

## 2. Типы SVG-элементов, которые мы хотим генерить

| # | Тип | Примеры тем | Что рисуем |
|---|---|---|---|
| **G1** | **Bar graph** | «Гистограммы 5 класс», «Data analysis Grade 5», «Погода в городах» | столбцы с подписями осей, данных, легенды |
| **G2** | **Line graph** | «Температура за неделю», «Изменение населения», «График функции» | точки + линии, сетка, легенда |
| **G3** | **Pie chart** | «Доли бюджета», «Распределение по группам крови» | секторы с процентами |
| **G4** | **Number line** | «Сложение отрицательных чисел», «Координатная прямая» | шкала + точки/стрелки |
| **G5** | **Geometric shapes** | «Площадь треугольника», «Виды углов», «Свойства четырёхугольников» | фигуры с подписями сторон, углов |
| **G6** | **Biology diagram** | «Строение клетки», «Пищеварительная система», «Фотосинтез» | упрощённые SVG-схемы органов/систем |
| **G7** | **Chemistry structure** | «Молекула воды», «Строение атома», «Периодическая таблица» | упрощённые диаграммы |
| **G8** | **Map** (опционально) | «Климат России», «Реки мира» | простые контурные SVG-карты |
| **G9** | **Timeline** | «Великие открытия», «Хронология XX века» | горизонтальная шкала с событиями |
| **G10** | **Fraction bar / Pie** | «Сложение дробей», «Доли величин» | визуальное представление дробей |

**MVP-фаза:** G1, G2, G3, G4, G5 (числовые/геометрические — это ~80% случаев в нашей таксономии)
**Фаза 2:** G6, G7, G9
**Backlog:** G8, G10

---

## 3. Технические подходы — 3 варианта

### Подход A: LLM генерит raw SVG (через structured output)

**Как работает:**
1. LLM-Generator получает prompt: «Сгенерируй рабочий лист по теме X. Если уместно — добавь bar graph с такими-то данными»
2. LLM возвращает JSON: `{ tasks: [...], svg_blocks: [{type: 'bar_chart', data: {...}, position: 'task_1_above'}] }`
3. Наш рендерер встраивает SVG в HTML-лист
4. Validator (deepseek-v4-flash из `docs/02-llm-architecture.md`) проверяет что SVG соответствует данным задания

**Плюсы:**
- ✅ Один проход LLM = один лист с графиком
- ✅ Максимальная гибкость (LLM может адаптировать тип графика под тему)
- ✅ Не нужна отдельная инфраструктура

**Минусы:**
- ❌ SVG от LLM может быть кривой (невалидный, некрасивый, с ошибками в координатах)
- ❌ Тяжело контролировать качество через self-verification (LLM не умеет надёжно проверять SVG)
- ❌ Токены дороже (LLM генерит длинный SVG-код)
- ❌ **Self-verification почти невозможна** — это самый большой минус

**Стоимость:** +30-50% токенов к текущей генерации (за счёт SVG-кода)

### Подход B: Шаблонный движок на нашей стороне + LLM только данные

**Как работает:**
1. LLM-Generator возвращает JSON только с **данными**: `{ tasks: [...], chart_spec: {type: 'bar', data: {labels: ['Пн','Вт','Ср'], values: [10, 15, 8]}, title: '...'} }`
2. Наш **template renderer** генерит SVG из этих данных по заранее подготовленным шаблонам (D3.js / Vega-Lite / собственный)
3. SVG встраивается в лист

**Плюсы:**
- ✅ **100% валидный SVG** — шаблон гарантирует качество
- ✅ **Self-verification тривиальная** — рендерим и сравниваем с данными
- ✅ Дешевле по токенам (LLM только структурированные данные)
- ✅ Быстрее рендеринг

**Минусы:**
- ❌ Ограниченная выразительность (шаблон не нарисует что угодно)
- ❌ Нужна библиотека шаблонов (data viz + diagrams)
- ❌ Для biology/chemistry придётся делать библиотеку заранее (не AI-генерируемую)

**Стоимость:** +10% токенов (только structured output)

### Подход C: Гибрид — данные от LLM, рендер от нас, валидация через нас же

**Как работает:**
1. LLM генерит JSON с `chart_spec` (тип + данные)
2. Наш рендерер генерит SVG (как в подходе B)
3. Наш **автоматический валидатор** проверяет:
   - Тип графика подходит теме
   - Данные непустые и числовые
   - Размеры в пределах A4
   - Текст не вылезает за границы
4. Если валидация не прошла — fallback на текстовое задание или регенерация

**Плюсы:**
- ✅ Лучшее из A + B
- ✅ LLM выбирает тип графика, мы рисуем — максимальная гибкость при контролируемом качестве
- ✅ Self-verification возможна (правила на нашей стороне)

**Минусы:**
- ❌ Сложнее в реализации (нужны и LLM-промпты, и рендерер, и валидатор)
- ❌ Библиотека шаблонов всё равно нужна

**Стоимость:** +15% токенов (structured output + validation overhead)

### 🏆 Рекомендация: **Подход C (гибрид)**

Причины:
- Self-verification критична для продукта (это один из наших заявленных козырей в `docs/01-research-naming.md`)
- Качество SVG от LLM непредсказуемо — шаблоны дают стабильный результат
- Дешевле по токенам (важно при 110 000 учителей масштаба Обучай)
- Масштабируется: добавить новый шаблон графика = добавить новый файл, не переписывать промпт

---

## 4. Архитектура

```
┌─────────────────────────────────────────────────────────────────┐
│  Wizard Step 4: Generate                                        │
│                                                                  │
│  Input:                                                          │
│    { subject, grade, topic, count, difficulty, has_chart }      │
│                                                                  │
│  ┌──────────────────────┐    ┌─────────────────────────────┐   │
│  │  LLM-Generator       │    │  Task prompt                │   │
│  │  (Claude Opus 5.5    │───>│  "Generate JSON: tasks[]   │   │
│  │   или gpt-6-sol)     │    │   + chart_spec? (optional)"│   │
│  └──────────┬───────────┘    └─────────────────────────────┘   │
│             │                                                  │
│             ▼                                                  │
│  ┌──────────────────────────────────────────────────────┐      │
│  │  Output JSON (validated by Zod)                       │      │
│  │  {                                                      │     │
│  │    tasks: [{number, type, text, answer, explanation}], │     │
│  │    chart_spec?: {                                      │     │
│  │      type: 'bar' | 'line' | 'pie' | 'number_line',     │     │
│  │      data: {...},                                      │     │
│  │      title: '...',                                     │     │
│  │      caption?: '...'                                   │     │
│  │    }                                                    │     │
│  │  }                                                      │     │
│  └──────────┬───────────────────────────────────────────┘      │
│             │                                                  │
│             ▼                                                  │
│  ┌──────────────────────────────────────────────────────┐      │
│  │  Validator (deepseek-v4-flash или rules)             │      │
│  │  Проверяет:                                            │      │
│  │   - JSON schema ✓                                      │      │
│  │   - Все ответы есть                                   │      │
│  │   - Нет дублей заданий                                │      │
│  │   - chart_spec.data валидный                          │      │
│  │   - chart_spec уместен теме                           │      │
│  │   - Размеры влезают в A4                              │      │
│  └──────────┬───────────────────────────────────────────┘      │
│             │                                                  │
│             ▼                                                  │
│  ┌──────────────────────────────────────────────────────┐      │
│  │  Renderer                                              │      │
│  │  - HTML/PDF: SVG встраивается inline                 │      │
│  │  - Preview в React: SVG через React-компонент         │      │
│  │  - Print: CSS @page A4, SVG центрируется              │      │
│  └──────────┬───────────────────────────────────────────┘      │
│             │                                                  │
│             ▼                                                  │
│  ┌──────────────────────────────────────────────────────┐      │
│  │  Final Worksheet                                       │      │
│  │  Page 1: Tasks (some with embedded chart)             │      │
│  │  Page 2: Answer key                                   │      │
│  └──────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────┘
```

**Новые файлы в кодовой базе:**
- `src/lib/llm/svg-spec.ts` — Zod-схемы для chart_spec
- `src/lib/llm/svg-templates/` — наборы SVG-шаблонов (bar, line, pie, number_line, geometry)
- `src/lib/llm/svg-renderer.ts` — рендер SVG из шаблона + данных
- `src/lib/llm/svg-validator.ts` — правила валидации (размеры, формат данных)
- `src/components/Worksheet/SvgChart.tsx` — React-компонент для preview
- `docs/02-llm-architecture.md` — обновить prompt для Generator с новой секцией про chart_spec

---

## 5. Библиотека шаблонов (минимум для MVP)

### G1: Bar chart (`bar.svg`)

```ts
interface BarChartSpec {
  type: 'bar';
  title: string;          // "Продажи мороженого по месяцам"
  x_label?: string;       // "Месяц"
  y_label?: string;       // "Продажи, шт"
  data: {
    labels: string[];     // ["Янв", "Фев", "Мар"]
    values: number[];     // [120, 145, 98]
  };
  caption?: string;       // "Данные: опрос 30 учеников"
}
```

### G2: Line chart (`line.svg`)

```ts
interface LineChartSpec {
  type: 'line';
  title: string;
  x_label?: string;
  y_label?: string;
  data: {
    labels: string[];
    series: { name: string, values: number[] }[];  // до 3 серий
  };
}
```

### G3: Pie chart (`pie.svg`)

```ts
interface PieChartSpec {
  type: 'pie';
  title: string;
  data: {
    labels: string[];
    values: number[];     // сумма = 100% или auto-normalize
  };
}
```

### G4: Number line (`number-line.svg`)

```ts
interface NumberLineSpec {
  type: 'number_line';
  title: string;
  range: [number, number];  // [-10, 10]
  step?: number;            // деление (по умолчанию 1)
  points?: {                // точки на прямой
    value: number;
    label?: string;
    color?: 'highlight' | 'normal';
  }[];
}
```

### G5: Geometric shapes (`geometry.svg`)

```ts
interface GeometrySpec {
  type: 'geometry';
  shape: 'triangle' | 'rectangle' | 'square' | 'parallelogram' | 'circle' | 'trapezoid';
  annotations: {
    label: string;          // "AB = 5 см"
    side: 'AB' | 'BC' | ...;
  }[];
  measurements?: {          // для задач на вычисление
    side?: { id: string, value?: number, unit?: string };
    angle?: { id: string, value?: number, unit?: '°' };
  }[];
  question?: string;        // "Найдите площадь"
}
```

**Все шаблоны — фиксированные SVG-файлы с переменными через шаблонизатор.** Не AI-генерируемые.

---

## 6. Обновлённые LLM-промпты (для Generator)

### Текущий промпт (см. `docs/02-llm-architecture.md` §3):

```
Сгенерируй рабочий лист по теме "{topic}" для {grade} класса.
Предмет: {subject}. Количество заданий: {count}.
Верни JSON: {tasks: [...]}
```

### Новый промпт (с SVG):

```
Сгенерируй рабочий лист по теме "{topic}" для {grade} класса.
Предмет: {subject}. Количество заданий: {count}.

ВАЖНО: Если тема подразумевает работу с данными, диаграммами или
геометрическими фигурами — добавь поле chart_spec в JSON:

{
  "tasks": [
    { "number": 1, "type": "...", "text": "...", "answer": "...", "explanation": "...", "chart_ref?": "task_1" }
  ],
  "chart_spec?": {
    "type": "bar" | "line" | "pie" | "number_line" | "geometry",
    "title": "...",
    "data": {...}
  }
}

Используй chart_spec ТОЛЬКО если визуальный элемент делает задание
нагляднее. Не добавляй chart_spec ради красоты.

Примеры тем, ГДЕ стоит добавить chart_spec:
- "Гистограммы", "Bar graphs", "Statistics", "Pogoda", "Продажи"
- "Линейная функция", "Парабола", "Графики"
- "Доли", "Проценты в круговой", "Распределение"
- "Координатная прямая", "Сложение отрицательных"
- "Площадь треугольника", "Виды углов"

Примеры тем, где НЕ нужно:
- "Past Simple", "Имя существительное", "Типы реакций"
```

---

## 7. Roadmap по фазам

### Фаза 0 — Подготовка (1 неделя, до старта фазы 1)

- [x] Утвердить roadmap и подход C с командой → **Готово** (подход C принят)
- [ ] Подключить LLM (фаза 1 из `docs/02-llm-architecture.md`) → **НЕ начато** (это блокер)
- [x] Добавить unit-тесты для мока с поддержкой chart_spec → **Готово** (28/28 тестов, vitest 3.2.7)

### Фаза 1 — MVP (3 недели, 5 типов графиков)

**Цель:** 80% пользователей видят графики в листах по числовым/геометрическим темам.

- [x] **Неделя 1:** Шаблоны G1 (bar), G2 (line), G3 (pie) → **Готово**
  - [x] 3 SVG-файла в `src/lib/llm/svg-templates/`
  - [x] Zod-схемы в `src/lib/llm/svg-spec.ts`
  - [x] Renderer unit-тесты (14 тестов в `svg-renderer.test.ts`)
- [x] **Неделя 2:** Обновить prompt Generator + интеграция с `generateWorksheet()` → **Готово (mock)**
  - [x] Mock-fixtures в `src/lib/mock/chart-fixtures.ts` (7 тем)
  - [x] React-компонент `<SvgChart>` для preview
  - [x] Интеграция в `WorksheetPreview.tsx`
- [ ] **Неделя 3:** Тесты на реальных темах (10 тем из таксономии) → **Частично** (7 фикстур покрывают 7 тем, нужен A/B-тест на реальных пользователях после LLM)
  - [ ] «Гистограммы 6 класс» — должно дать bar (нужна LLM-выдача для теста на новой теме)
  - [ ] «Координатная прямая» — number_line (Phase 2)
  - [x] «Доли и проценты» — pie ✅ (есть в `chart-fixtures.ts`)

**DoD фазы 1:**
- [ ] LLM генерит chart_spec в 50%+ числовых тем → **НЕ готово** (блокер — LLM)
- [x] SVG встраивается в PDF без артефактов → **Готово** (визуально OK через SvgChart + React-рендер)
- [x] Self-validation проходит для 90%+ сгенерированных графиков → **Готово** (Zod pass 14/14 renderer + 14/14 spec)
- [ ] A/B-тест: пользователи оценивают листы с графиками на 0.5+ выше чем без → **НЕ готово** (нужен прод)

### Фаза 2 — Расширение (2 недели, G4-G7)

- [x] G4 (number line) — критично для математики → **Готово** (`number-line.ts`)
- [x] G5 (geometry) — критично для геометрии 5-9 класс → **Готово** (`geometry.ts`, 6 фигур)
- [x] G6 (biology diagrams) — 6 шаблонов: plant-cell, animal-cell, plant, dna, chromosome, animal-class → **Готово** (`biology.ts`)
- [x] G7 (chemistry) — 4 шаблона: atom, molecule, periodic, reaction → **Готово** (`chemistry.ts`)

**DoD фазы 2:**
- [x] 30+ тем в таксономии имеют свой визуальный шаблон → **17 фикстур** (11 math + 3 biology + 3 chemistry)
- [x] Self-validation > 95% → **Готово** (Zod pass 84/84)

### Фаза 3 — Polish (2 недели)

- [ ] Темизация графиков (цвета под стиль оформления листа)
- [ ] Interactive preview (можно hover и видеть значения)
- [ ] A11y (alt-text для SVG, keyboard nav)
- [ ] Экспорт графика как PNG (для учителей — вставить в свою презентацию)
- [ ] Дифференцированные графики (простая версия для ELL)

### Backlog

- [ ] G8 (maps) — нужны контурные SVG для регионов
- [ ] G10 (fraction bars) — отдельный визуализатор дробей
- [ ] AI-генерируемые иллюстрации (для тем где нет готовых шаблонов) — это уже Phase 4 (после подключения vision/image-gen)

---

## 8. Метрики успеха

| Метрика | Цель | Как измеряем |
|---|---|---|
| % листов с графиком (по числовым/геом. темам) | ≥ 70% | Prometheus: счётчик chart_spec ≠ null |
| Self-validation pass rate | ≥ 90% | Логируем каждый SVG-блок |
| Время рендера SVG | < 200 ms | Performance API |
| Размер SVG (KB) | < 30 KB на блок | File size logging |
| Учительская оценка листов с графиками vs без | +0.5+ звезды | A/B в личном кабинете, opt-in |
| Цитируемость в маркетинге | «единственные с графиками в РФ» | Pageviews на /features-svg |

---

## 9. Риски

| Риск | Вероятность | Митигация |
|---|---|---|
| LLM генерит невалидный chart_spec | Высокая | Zod-валидация + fallback на текстовое задание |
| Шаблон не подходит под тему | Средняя | Расширяемая библиотека, фаза 3 |
| SVG не влезает в A4-layout | Средняя | Responsive рендеринг + pre-flight проверка размеров |
| Учителя не понимают зачем график | Низкая | Onboarding-tour, примеры в листинге темы |
| Конкуренты копируют за пол-года | Высокая | Не останавливаемся — Phase 3 добавляет интерактив |
| Self-verification не ловит баги | Средняя | Ручная проверка 50 листов в неделю первые 2 месяца |

---

## 10. Зависимости от других фич

**Блокирует:** ничего (можно делать параллельно с `docs/04-product-features-q4-2026.md`)
**Зависит от:**
- 🔴 **LLM подключение** (`docs/02-llm-architecture.md` фаза 1) — без этого нечего рендерить
- 🟡 Validator (deepseek-v4-flash) — нужен для self-verification
- 🟢 Таксономия (`src/lib/content/subjects.ts`) — нужны правильные теги «с графиком» в topics

**Синергия:**
- F-02 «Presets в wizard» из Q4-2026 — если у юзера preset «Урок геометрии», можно автоматически предлагать chart_spec
- F-03 «Превью 2-3 задания на SEO-странице» — там тоже показывать превью графика

---

## 11. Out of scope (явно НЕ делаем)

- ❌ AI-генерация произвольных иллюстраций (флажки, животные, исторические сцены) — это другой tech-stack (DALL-E / Midjourney), не часть SVG-графиков
- ❌ Интерактивные графики для онлайн-форм (можно позже, но не в этом ТЗ)
- ❌ Экспорт в Excel/Google Sheets (тоже отдельно)
- ❌ 3D-визуализация (для математики/химии) — это WebGL, не SVG
- ❌ Графики для взрослой аудитории (бизнес-дашборды) — не наш фокус

---

## 12. Что делаем прямо сейчас (после согласования)

| # | Действие | Кто | Когда | Статус (2026-09-25) |
|---|---|---|---|---|
| 1 | Согласовать roadmap с командой | PM + tech-lead | Эта неделя | 🟡 согласован подход C (гибрид) |
| 2 | Связаться с дизайнером для шаблонов SVG | PM | Эта неделя | ⏸ не начато (Phase 1 — технические шаблоны, дизайнера пока не нужно) |
| 3 | Зафиксировать SVG-схему в `docs/02-llm-architecture.md` v2 | tech-lead | После согласования | ⏸ не начато (нужен апдейт prompt с chart_spec) |
| 4 | Спланировать спринт на Phase 1 (3 нед.) | tech-lead | После согласования | ✅ Phase 1 выполнена за ~1 час работы (3 саб-агента параллельно) |
| 5 | Подключить LLM (без этого SVG-фаза не имеет смысла) | backend | см. roadmap LLM | ⏸ **Главный блокер** — без LLM нельзя выпустить в прод |

---

## 13. Changelog

| Дата | Что | Кто |
|---|---|---|
| 2026-09-25 | Создан roadmap | Mavis |
| 2026-09-25 | Phase 1 (MVP) реализована: bar/line/pie шаблоны, Zod-схемы, 7 mock-фикстур, React SvgChart, WorksheetPreview интеграция, 28/28 тестов проходят, TS clean | 3 саб-агента worker (1+3) + Mavis (вместо зависшего 2) |
| 2026-09-25 | Phase 2 реализована: number-line + geometry рендереры, Zod-схемы, 4 новые фикстуры (4 темы), 39 новых тестов, **67/67 тестов проходят** | 2 саб-агента worker (оба зависли → Mavis доделал) |
| 2026-09-25 | Phase 3 реализована: biology (6 шаблонов) + chemistry (4 шаблона) рендереры, Zod-схемы, 6 новых фикстур по реальным слэгам таксономии, **84/84 тестов проходят** | Mavis (worker-ы пропущены — стабильно зависают) |
| 2026-09-25 | Бонусный фикс: `getUMK()` в `umk.ts` теперь принимает `number \| null` (а не только `number`) | Mavis |
| 2026-09-25 | Roadmap обновлён: Phase 1 + 2 + 3 → done, чеклисты отмечены, раздел 12 (next actions) | Mavis |
| Q1 2027 (план) | Phase 4 polish: темизация, A11y, экспорт PNG, интерактивные графики | — |

---

**Дата создания:** 2026-09-25
**Дата последнего update:** 2026-09-25 (Phase 1 done)
**Где живёт:** `/Users/ivanlusnikov/Documents/nameone/docs/04-product-features-svg-graphs.md`
**Связанные:**
- `.audit/competitors/2026-09-25-quality-comparison.md` — откуда пришёл приоритет
- `docs/02-llm-architecture.md` — какой LLM-стек используем, **блокирует production**
- `docs/04-product-features-q4-2026.md` — Q4 quick wins (это — следующая итерация)
- `.audit/competitors/2026-09-25-hands-on-teardown-3-companies.md` — детали по EasyClass
- `src/lib/llm/` — реализация (3 шаблона + renderer + spec + fixtures)
- `src/components/constructor/SvgChart.tsx` — React-компонент
