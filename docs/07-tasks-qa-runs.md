# Tasks — QA-runs: скриншоты + closure docs (Волна 1)

> **Дата:** 2026-09-26
> **Цель:** закрыть «live-проверка + closure doc» из чеклиста «Сделано = end-to-end»
> **Подход:** 3 параллельных worker'а, каждый — своя фича. HTML snapshots + структурная проверка + closure doc.
> **Что НЕ делаем (Волна 2):** research follow-ups (Обучай через браузер, vc.ru TOP-20, вакансии, SimilarWeb, обновление `docs/01-research-naming.md`)

---

## Общий контекст

**Что уже есть:**
- F-01 (таксономия): `src/lib/content/subjects.ts` — 269 тем
- F-02 (presets): `src/components/constructor/PresetGrid.tsx`
- F-03 (превью): `src/app/subject/[subject]/[grade]/[topic]/page.tsx` + `AnswerToggle.tsx`
- F-04 (экзамены): `src/lib/content/exam-taxonomy.ts` (218 номеров) + `src/app/exam/[exam]/[subject]/[number]/page.tsx` + режим «По номеру» в wizard

**Где сохранять артефакты:**
- `.audit/qa-runs/2026-09-25-f01/` — для F-01
- `.audit/qa-runs/2026-09-25-f02/` — для F-02
- `.audit/qa-runs/2026-09-25-f03/` — для F-03
- `.audit/qa-runs/2026-09-26-f04/` — для F-04

**Что использовать:**
- `curl` для HTML snapshots (сохранять в `.audit/qa-runs/<feature>/<slug>.html`)
- Структурный grep для проверки наличия элементов (CTA, breadcrumbs, превью)
- Browser tool — опционально (если не зависает; у parent уже зависал). Если не работает — обойтись HTML evidence.

**Скоуп:**
- 2-3 HTML snapshot'а на фичу
- 1 closure doc на фичу (markdown)
- 0 правок кода (если найдёшь баг — запиши в closure как «найдено, не исправлено»)

---

## Task #1 — QA-runs для F-01 (таксономия 269 тем)

**Owner:** worker (background ok)
**Scope:**
1. **HTML snapshots** (сохранить как `<slug>.html` в `.audit/qa-runs/2026-09-25-f01/`):
   - `/subject/math/5/smeshannye-chisla/` — старая тема (была до F-01)
   - `/subject/physics/7/srednyaya-skorost/` — **новая** тема по физике (F-01)
   - `/subject/english/5/present-perfect-intro/` — **новая** тема по английскому (F-01)
2. **Структурная проверка** (grep по каждому snapshot):
   - Title содержит `{Название темы} — рабочие листы · {Предмет} {Класс} · ЛистAI`
   - Есть breadcrumb chain
   - Есть блок превью заданий (F-03) — `<details>` с «Показать ответ»
   - Есть CTA «Открыть конструктор» с правильным deep-link
3. **Edge cases**:
   - Запросить `/subject/math/1/` — список всех тем 1 класса (snapshot)
   - Проверить что **все** 269 тем имеют ≥2 examples (быстрая проверка через grep subjects.ts)
4. **Closure doc**: `.audit/qa-runs/2026-09-25-f01/closure.md` — короткий отчёт:
   - Что сделано (с путями к HTML)
   - Что подтверждено (структурная проверка)
   - Что НЕ сделано / что осталось
   - Найденные баги (если есть)

**Запрещено:** править код. Только наблюдать и записывать.

---

## Task #2 — QA-runs для F-02 (presets в wizard)

**Owner:** worker
**Scope:**
1. **Запустить dev server** (`npm run dev` в фоне; не забыть `export PATH="/opt/homebrew/opt/node/bin:/opt/homebrew/bin:$PATH"`)
2. **HTML snapshots wizard** (сохранить как `.html` в `.audit/qa-runs/2026-09-25-f02/`):
   - `/constructor/` — стартовая страница wizard
   - `/constructor/` с deep-link `?exam=ege&subject=math-p&number=15` (если возможно через curl — нет, это client-side state; тогда просто snapshot исходного состояния wizard)
3. **Структурная проверка** (grep):
   - В HTML wizard есть упоминания preset (`Preset`, `Карточка`, `Домашк`, `Провероч`, `Раздаточ`, `ОГЭ`) — НЕ обязательно все, т.к. presets видны только после выбора класса (client-side)
   - В сборке есть PresetGrid компонент (grep по `.next/static/chunks/`)
   - Bundle wizard увеличился после F-02 (в README указано было ~11 kB, стало ~15.3 kB)
4. **Программная проверка** PresetGrid (через исходник):
   - 5 пресетов с правильными id/title/icon/count/difficulty
   - Тип Preset экспортируется
   - PRESETS экспортируется
5. **Closure doc**: `.audit/qa-runs/2026-09-25-f02/closure.md`
   - Что сделано
   - Bundle size до/после (если есть способ замерить)
   - Что НЕ сделано (визуальные скриншоты если browser зависает)
   - Найденные баги

**Запрещено:** править код.

---

## Task #3 — QA-runs для F-03 + F-04 (превью на SEO + экзамен-страницы)

**Owner:** worker
**Scope F-03:**
1. **HTML snapshots** в `.audit/qa-runs/2026-09-25-f03/`:
   - `/subject/math/5/smeshannye-chisla/` — пример с превью
   - `/subject/english/5/present-perfect-intro/` — новая тема с английским текстом в превью
2. **Структурная проверка**:
   - Блок превью рендерится (H2 «Примеры заданий из этой темы»)
   - 2-3 `<details>` элемента с текстом «Показать ответ»
   - CTA с правильным deep-link на `/constructor/?subject=X&grade=Y&topic=Z`
   - Mobile-friendly (Tailwind классы `sm:`, `lg:` в HTML)

**Scope F-04:**
3. **HTML snapshots** в `.audit/qa-runs/2026-09-26-f04/`:
   - `/exam/oge/math/1/` — ОГЭ математика номер 1
   - `/exam/ege/math-p/19/` — ЕГЭ профильная математика (то что раньше не работало из-за бага)
   - `/exam/ege/physics/32/` — ЕГЭ физика, последний номер
4. **Структурная проверка F-04**:
   - Title содержит правильное название предмета (Математика / Математика (профильная) / Физика)
   - Есть блок «Что проверяется» с description
   - CTA ведёт на `/constructor/?exam=X&subject=Y&number=Z`
   - Related номера отображаются (±5)

**Scope общее (F-03 + F-04):**
5. **Структурная проверка wizard**:
   - Проверить что в исходнике `src/app/constructor/page.tsx` есть переключатель «По теме / По номеру»
   - Есть импорт из `exam-taxonomy` (а не из заглушки)
   - Режим «По номеру» имеет 4 шага: exam-select, exam-subject, exam-number, configure
6. **Closure docs**:
   - `.audit/qa-runs/2026-09-25-f03/closure.md` — для F-03
   - `.audit/qa-runs/2026-09-26-f04/closure.md` — для F-04

**Запрещено:** править код.

---

## Формат closure doc

```markdown
# Closure — <Feature Name>

**Дата:** 2026-09-26
**DoD статус:** [✅ пройден / ⚠️ частично / ❌ не пройден]

## Что сделано
- <bullet>

## Что подтверждено
- <bullet с evidence — путь к HTML, grep результат, etc.>

## Что НЕ сделано / что осталось
- <bullet>

## Найденные баги (без правок, только report)
- <bullet с file:line и описанием>

## Acceptance
- <какие критерии выполнены>
```

---

## Что НЕ делаем в этой волне

- ❌ Правки кода (только наблюдение)
- ❌ Research follow-ups из конкурентного отчёта (Волна 2)
- ❌ Реальная генерация листов по номерам (нужен бэкенд)
- ❌ Примеры заданий в таксономии экзаменов
