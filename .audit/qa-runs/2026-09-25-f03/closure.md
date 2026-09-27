# Closure — F-03. Превью 2-3 задания на SEO-странице темы

**Дата:** 2026-09-26
**DoD статус:** ✅ пройден

## Что сделано

- Запущен dev server (`npm run dev`, порт 3000) в фоне, лог в `/tmp/listai-dev-qa.log`.
- Сделано 2 HTML snapshot'а в `.audit/qa-runs/2026-09-25-f03/` через `curl`:
  - `math-5-smeshannye-chisla.html` — `/subject/math/5/smeshannye-chisla/` (старая тема, math 5)
  - `english-5-present-perfect-intro.html` — `/subject/english/5/present-perfect-intro/` (новая тема, F-01)
- Прогнаны структурные grep-проверки по обоим snapshot'ам.
- Wizard проверен на наличие переключателя «По теме / По номеру» (F-04-C, часть задания).

## Что подтверждено

**Структура F-03 страницы (`src/app/subject/[subject]/[grade]/[topic]/page.tsx:189-236`):**

- ✅ Title корректный — формат `{Тема} — рабочие листы · {Предмет} {Класс} класс · ЛистAI`:
  - `math-5-smeshannye-chisla`: `Смешанные числа — рабочие листы · Математика 5 класс · ЛистAI`
  - `english-5-present-perfect-intro`: `Present Perfect: введение — рабочие листы · Английский 5 класс · ЛистAI`
- ✅ H2 «Примеры заданий из этой темы» присутствует на обеих страницах (page.tsx:193-195).
- ✅ 2 `<details>` элемента с текстом «Показать ответ» (по одному на каждое задание-образец) — компонент `AnswerToggle` в `src/app/subject/[subject]/[grade]/[topic]/AnswerToggle.tsx:19`.
  - `smeshannye-chisla`: 2 examples → 2 `<details>`, текст «Показать ответ» × 4 (group-open:hidden дублирует для toggle).
  - `present-perfect-intro`: 2 examples → 2 `<details>`, текст «Показать ответ» × 4.
- ✅ CTA «Открыть конструктор» с deep-link на `/constructor/?subject=X&grade=5&topic=Z`:
  - `math`: `/constructor?subject=math&grade=5&topic=smeshannye-chisla`
  - `english`: `/constructor?subject=english&grade=5&topic=present-perfect-intro`
  - Источник: `page.tsx:225-227`.
- ✅ Mobile-friendly: в HTML присутствуют классы `sm:` и `lg:` (grid-cols, py, text-size — адаптивная вёрстка).
- ✅ Бейдж «Соответствует ФГОС 2021» рендерится на обеих страницах (`page.tsx:111-114`).
- ✅ Breadcrumbs работают: Главная → Математика → 5 класс → Смешанные числа (страница SEO-friendly, h1 с ключом).

## Что НЕ сделано / что осталось

- ❌ Не делал скриншоты через Browser tool (зависал у parent сессии — обошлись HTML evidence).
- ❌ Не проверял edge case `examples.length === 0` визуально (можно сделать отдельно — обе тестовые темы имеют по 2 примера).
- ❌ Не делал Lighthouse SEO-score замер (требует запущенного build + lighthouse CLI; вне скоупа QA-runner'а).

## Найденные баги (без правок, только report)

- **Никаких блокирующих багов не найдено.**
- Минор-наблюдение: у обеих тестовых тем (`smeshannye-chisla`, `present-perfect-intro`) **отсутствует поле `fgosRef`** в `subjects.ts` (это опциональное поле, `types.ts:47` — `fgosRef?: string`). Соответственно, бейдж «Раздел программы» не рендерится (`page.tsx:105` — условный рендер). Это нормальное поведение, но стоит заполнить fgosRef в следующих итерациях F-01, чтобы SEO-страницы были полнее.

## Acceptance

- ✅ Блок «Примеры заданий из этой темы» рендерится в `src/app/subject/[subject]/[grade]/[topic]/page.tsx` (page.tsx:189).
- ✅ CTA-ссылка ведёт на `/constructor?subject=X&grade=Y&topic=Z` (deep-link подтверждён).
- ✅ HTML mobile-friendly (Tailwind `sm:`/`lg:` в выдаче).
- ✅ Соответствие ФГОС явно указано в HTML (бейдж + keywords в metadata).
- ✅ Подсказки про ФГОС/соответствие присутствуют.

## Артефакты

```
.audit/qa-runs/2026-09-25-f03/
├── math-5-smeshannye-chisla.html         (81 790 bytes)
├── english-5-present-perfect-intro.html  (80 843 bytes)
└── closure.md
```
