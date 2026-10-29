# ТЗ-34: критерии оценивания в контрольной и тесте — отчёт реализации

**Дата:** 29 октября 2026
**Исполнитель:** Coder (ведущий инженер-продуктовик)
**ТЗ:** `docs/tz/34-evaluation-criteria.md`
**Ветка:** `feat/teacher-gaps-w1-criteria` (worktree `.worktrees/impl-criteria`, база — `feat/teacher-gaps-w1`, коммит `0425e3f`)

---

## 1. Что сделано

_(заполняется по ходу; сначала — план)_

### План (написан до кода)

| # | Файл | Что делаем | Где тест |
|---|------|-------------|-----------|
| 1 | `src/lib/content/grading.ts` (НОВЫЙ) | Пороги отметок 85/70/50/0, `markForPercent`, `marksScale`, стоп-лист общих формулировок, `isConcreteCriterion`, сборка `evaluation` из заданий | `tests/grading-criteria.test.ts` |
| 2 | `src/lib/content/task-types.ts` | Поле `weight` у `TaskTypeSpec` + значения всем 17 типам. Лимиты разнообразия и блок промпта — не трогаем | `tests/grading-criteria.test.ts`, `tests/task-type-registry.test.ts` (не правлю) |
| 3 | `backend/src/llm/prompts/worksheet-gen.ts` | Правило 17 переписано (критерии — в `criteria`, не в `answer`); блок `evaluation` (типичные ошибки + рекомендация) для control/test; требование «хотя бы одно задание с критериями» | `backend/tests/unit/tz34-criteria.test.ts` |
| 4 | `backend/src/llm/validation/quality-filter.ts` | (1) `requireAnswer` не выкидывает задание с `answerKind === "criteria"` и непустыми конкретными критериями; (2) чистка критериев (пустые и общие) с отчётом | `backend/tests/unit/tz34-criteria.test.ts` |
| 5 | `backend/src/llm/validation/type-diversity.ts` (НОВЫЙ) | Гистограмма типов, проверка против `diversityLimits`, выбор задания на замену | `backend/tests/unit/tz34-criteria.test.ts` |
| 6 | `backend/src/llm/index.ts` | Сборка `evaluation` в ответе; проверка разнообразия после генерации с заменой задания (≤2 попытки) и `quality.typeDiversityViolations` | `backend/tests/unit/tz34-criteria.test.ts` |
| 7 | `backend/src/types.ts`, `backend/src/routes/worksheets.ts`, `backend/src/lib/zod.ts` | Тип `EvaluationPart`, поле `evaluation` в ответе, схема контракта | `backend/tests/unit/tz34-criteria.test.ts` |
| 8 | `src/lib/types.ts`, `src/lib/client/llm.ts` | Тип `EvaluationPart` на фронте, приём `evaluation` из ответа | `tests/grading-criteria.test.ts` |
| 9 | `src/lib/utils/docx.ts` | Новая страница «Критерии оценивания» ПОСЛЕ ключа | `tests/tz34-criteria-print.test.ts` |
| 10 | `src/components/constructor/WorksheetPreview.tsx`, `src/app/constructor/page.tsx` | Блок критериев в превью, передача `evaluation` в печать и превью | `tests/tz34-criteria-print.test.ts` |

---

## 2. Как проверено

### 2.1. «До — падает» (проверено владельцем, независимо от кодера)

Проверка выполнялась так: реализация (`src/lib/content/grading.ts`, поле `weight`
в реестре) убиралась, тесты оставались.

```
$ mv src/lib/content/grading.ts /tmp/grading.ts.keep
$ git checkout -- src/lib/content/task-types.ts
$ npx vitest run tests/grading-criteria.test.ts

Error: Failed to resolve import "@/lib/content/grading" from
       "tests/grading-criteria.test.ts". Does the file exist?
 Test Files  1 failed (1)
      Tests  no tests
```

После возврата реализации:

```
$ npx vitest run tests/grading-criteria.test.ts
 Test Files  1 passed (1)
      Tests  22 passed (22)
```

### 2.2. Точечные тесты новой функциональности

```
$ npx vitest run tests/grading-criteria.test.ts tests/tz34-criteria-print.test.ts \
    tests/task-type-registry.test.ts tests/task-type-diversity.test.ts \
    tests/task-type-print.test.ts
 Test Files  5 passed (5)
      Tests  65 passed (65)
```

```
$ cd backend && npx vitest run tests/unit/tz34-criteria.test.ts \
    tests/unit/tz32TaskNumbering.test.ts tests/unit/qualityFilter.test.ts
 Test Files  3 passed (3)
      Tests  59 passed (59)
```

### 2.3. Полный набор бэка (регрессия)

```
$ cd backend && npx vitest run
 Test Files  74 passed (74)
      Tests  1126 passed (1126)
 Duration  290.68s
```

### 2.4. Typecheck

```
$ npx tsc --noEmit                    # фронт
(без ошибок)
$ cd backend && npx tsc --noEmit      # бэк
(без ошибок)
```

### 2.5. Ключевые требования — проверено по коду

| Требование | Как проверено | Итог |
|---|---|---|
| Отметки считает КОД, а не модель | `src/lib/content/grading.ts:60-64` — `MARK_THRESHOLDS` = 85/70/50/0 в одном месте; `buildEvaluationPart` подставляет `marks: marksScale()` | ✓ |
| Модель не может прислать свои отметки | `taskMaxPoints` (`grading.ts:255`) берёт вес из реестра по ТИПУ задания; модельное поле `points` игнорируется | ✓ |
| Критерии — отдельный ключ API | `backend/src/routes/worksheets.ts:276` — `evaluation: result.evaluation ?? []` рядом с `quality` | ✓ |
| Страница критериев в DOCX ПОСЛЕ ключа | `src/lib/utils/docx.ts:71` — заголовок «Критерии оценивания» отдельной страницей после блока `withAnswers` | ✓ |
| Разнообразие проверяет код | новый модуль `backend/src/llm/validation/type-diversity.ts`: `typeHistogram`, `findTypeDiversityViolations`, `pickReplacementIndex` | ✓ |
| Шкала звёзд интерактивов не смешана | `src/lib/interactives/scoring.ts:58` (`PERCENT_STARS`) не тронут; отметки живут только в `grading.ts` | ✓ |

---

## 3. Живая проверка

**Не выполнена, и это ограничение, а не пропуск.** Код задеплоен на боевой
воркер только после мержа в `main` (правило репозитория: «Не пушить в main.
Публикует владелец»), а до мержа бой показывает СТАРОЕ поведение — в ответе не
будет ключа `evaluation`.

Что проверено ДО мержа, чтобы зафиксировать базу сравнения: боевой воркер
отдаёт контрольную без слова «критери» вовсе (замер 28.10.2026, ноль
вхождений в 4 109 байтах ответа).

Команда для проверки после выката (готова, ждёт мержа):

```bash
curl -s -X POST https://rabochielisty-api.ivanlusnikov159.workers.dev/api/worksheets/generate \
  -H "Content-Type: application/json" \
  -d '{"request":{"subject":"math","grade":5,"topic":"drobi-obyknovennye","difficulty":"medium",
       "count":4,"type":"control","withAnswers":true,"withExplanations":false},"bypassCache":true}'
```

Проверять: (1) в ответе есть `evaluation` — массив длиной 2 (по вариантам);
(2) `evaluation[0].marks` — четыре записи 5/4/3/2 с `fromPercent` 85/70/50/0;
(3) `evaluation[0].totalMaxPoints` равен сумме `maxPoints` по заданиям;
(4) `typicalMistakes` — непустой массив, `recommendation` — непустая строка.

---

## 4. Что не удалось доказать

1. **Живой вызов на бою с новым поведением** — код не смержен в `main`, бой
   показывает старое. См. §3.
2. **Полный прогон фронтовых тестов** (`npx vitest run` в корне) не доведён
   до конца: прогон занимает ~13 минут, а задача была убита по таймауту 30 минут.
   Точечные тесты новой функциональности и реестра зелёные (65 проверок),
   typecheck обоих пакетов чист, полный бэк зелёный (1 126 проверок).
3. **Как модель отреагирует на требование «хотя бы одно задание с критериями»**
   для контрольной — не измерено, требует живого вызова.
4. **Поведение при обрыве ответа по `finish_reason=length`**: потолок для
   `control`/`test` поднимался (AD-1), но обрыв на длинном ответе с блоком
   `evaluation` живьём не проверен.
5. **Полный `npm run build` (Next) не выполнялся** — сборка 13 884 страниц
   занимает ~13 минут и не влезала в таймаут задачи. Typecheck фронта чист.

---

## 5. Что сломалось по ходу

1. **Обход jsdom в /tmp не был нужен.** Кодер потратил ~5 минут, собирая
   собственный vitest-конфиг и патч `setup-jsdom-patch.ts` из-за ошибки
   `await import("node:buffer")`. Штатный `vitest.setup.ts` в корне репозитория
   работает — проверено владельцем:
   `npx vitest run tests/task-type-registry.test.ts` → 20 passed. Обход удалён.
2. **Правило 17 промпта переписано, значит изменился и чужой тест.**
   `backend/tests/unit/tz32TaskNumbering.test.ts` проверял ТЕКСТ правила
   («КРИТЕРИИ, по которым учитель принимает» в поле `answer`). Критерии теперь
   живут в поле `criteria` (AD-4), поэтому текст правила другой, и тест
   обновлён. Проверка при этом НЕ ослаблена: запрет ответа-заглушки
   («индивидуальный ответ») остался в тесте, добавлена проверка, что у типа с
   критериями `answer` пустой.
3. **Задача убита по таймауту 30 минут** — код к этому моменту был готов,
   закоммичен и запушен, но отчёт остался недописанным. Дописан владельцем по
   фактическим прогонам (см. §2).

---

## 6. Пакет вопросов

1. **Дозапрос критериев, если модель не дала ни одного.** Сейчас при отсутствии
   критериев работа отдаётся без блока, а на печати пишется честная строка
   «критерии не удалось сформировать — оценивайте по ключу». Дозапрос (ещё один
   вызов модели) стоит денег и времени. (А) Оставить как есть — дёшево, но
   обещание тарифа снова может не выполниться. (Б) Дозапросить один раз —
   цена контрольной растёт.
2. **Замена задания при нарушении разнообразия** — сейчас до 2 попыток.
   Каждая попытка — ещё один вызов модели. (А) 2 попытки, как сейчас.
   (Б) 1 попытка — дешевле, но лист может остаться однообразным с пометкой
   в `quality`.
3. **Критерий длиной менее 15 символов отбрасывается.** Это сработает на
   коротких, но конкретных критериях («назван оттенок»). (А) Оставить порог.
   (Б) Снизить до 10 символов и тогда полагаться на стоп-лист.
4. **Полный прогон фронтовых тестов и `npm run build`** не выполнены (не
   влезали в таймаут). Прогнать их владельцем перед мержем? (А) Да, обязательно
   перед выкаткой. (Б) Достаточно typecheck + точечных тестов.

---

## 7. `git status --short` и коммиты

Коммит:
```
89c1871 feat(ТЗ-34): критерии оценивания в ответе API и печати
```
Ветка запушена: `feat/teacher-gaps-w1-criteria` (база — `feat/teacher-gaps-w1`,
коммит `0425e3f`).

Рабочее дерево чистое после коммита:
```
$ git status --porcelain --untracked-files=all
(пусто)
```

Изменённые файлы (18): `src/lib/content/grading.ts` (новый),
`src/lib/content/task-types.ts`, `backend/src/llm/prompts/worksheet-gen.ts`,
`backend/src/llm/validation/quality-filter.ts`,
`backend/src/llm/validation/type-diversity.ts` (новый),
`backend/src/llm/validation/task-numbering.ts`, `backend/src/llm/index.ts`,
`backend/src/types.ts`, `backend/src/lib/zod.ts`, `backend/src/routes/worksheets.ts`,
`src/lib/types.ts`, `src/lib/client/llm.ts`, `src/lib/utils/docx.ts`,
`src/components/constructor/WorksheetPreview.tsx`,
`src/app/constructor/page.tsx`, `backend/tests/unit/tz32TaskNumbering.test.ts`,
`tests/grading-criteria.test.ts` (новый), `tests/tz34-criteria-print.test.ts`
(новый), `backend/tests/unit/tz34-criteria.test.ts` (новый).

Коммит сделан явным списком путей, без `git add -A`. Ветка `main` не тронута.
